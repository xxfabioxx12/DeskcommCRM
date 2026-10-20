import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * GET  /api/v1/channels/templates — o espelho local + o CONTRATO derivado de cada um.
 * POST /api/v1/channels/templates — sem corpo (ou sem `acao`): força um sync com a
 *   Graph API; com `acao` criar/editar/apagar: gerencia o template na conta oficial.
 * PATCH /api/v1/channels/templates — salva (ou esquece) o link da mídia de um modelo.
 *
 * O contrato vai derivado no payload, e não guardado no banco, de propósito: guardar
 * o derivado criaria a segunda fonte da verdade que esta fase inteira existe para
 * eliminar. A tela e o montador de envio chamam a MESMA `deriveTemplateContract`.
 *
 * Nenhum campo aqui é "quantidade de parâmetros". O número é consequência dos slots;
 * se algum dia aparecer um campo editável com esse nome, o desenho vazou.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { resolveMetaCreds } from "@/lib/channels/meta/credentials";
import { metaSessionForOrg } from "@/lib/channels/meta/session";
import { normalizeRejectedReason } from "@/lib/channels/meta/webhook";
import { deriveTemplateContract, describeAddress } from "@/lib/channels/meta/template-contract";
import { slotKey } from "@/lib/channels/meta/build-components";
import { syncTemplates, templatesToRows } from "@/lib/channels/meta/template-sync";
import { mesclarValoresSalvos } from "@/lib/channels/meta/valores-salvos";
import { filtrarLinhasDaConexao, wabaDoOficial } from "@/lib/channels/linha-do-espelho";
import { traduzir } from "@/lib/i18n/dicionario";
import type { Idioma } from "@/lib/i18n/idiomas";
import { createAdminClient } from "@/lib/supabase/admin";
import { audit } from "@/lib/audit";
import { acaoDoModeloOficialSchema, componentsDoFormulario } from "@/lib/channels/criacao-de-modelo";
import { executarGestao, ROTULO_DO_USO } from "@/lib/channels/gestao-de-modelos";
import { ehErroDaPlataformaNoModelo, explicarErroDaCriacao } from "@/lib/channels/meta/erros-para-operador";
import { opsDeModelosDaContaOficial } from "@/lib/channels/modelos-do-canal";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Um template pronto para a tela: o que a Meta diz + o contrato derivado. */
export interface TemplateView {
  name: string;
  language: string;
  status: string;
  category: string | null;
  rejectedReason: string | null;
  qualityScore: string | null;
  parameterFormat: string;
  contractHash: string;
  syncedAt: string;
  slots: Array<{
    key: string;
    expects: string;
    onde: string;
    /**
     * A chave de `template_values` para ESTE slot, montada por `slotKey` — a
     * mesma função que o montador do payload de envio usa.
     *
     * A `key` sozinha não endereça: um carrossel de dois cards tem dois slots
     * com a mesma `key`, e um cabeçalho de mídia colide com o `{{1}}` do corpo.
     * A tela teria de remontar o prefixo a partir de `onde`, que é rótulo
     * humano ("cabeçalho", "botão 1 (url)") e não sobrevive a isso. Montar a
     * chave de dois jeitos é o mismatch voltando pela porta dos fundos.
     */
    valueKey: string;
  }>;
  /**
   * Texto de cada componente que carrega parâmetro, INTEIRO e uma vez só.
   * Antes a tela mostrava o corpo repetido a cada slot, cada linha destacando o
   * seu e deixando o vizinho cru — correto e ilegível. A UI marca os `{{n}}`.
   */
  previews: Array<{ onde: string; text: string }>;
  /** A definição crua — de onde sai o texto que vai no corpo do envio. */
  components: unknown[];
  /**
   * Links de mídia que o operador salvou para este modelo, na chave de
   * `template_values`. O painel da janela fechada pré-preenche com eles.
   */
  savedValues: Record<string, string>;
}

/** Textos com placeholder, achatados (inclui os de dentro de card de carrossel). */
function textPreviews(components: unknown): Array<{ onde: string; text: string }> {
  const out: Array<{ onde: string; text: string }> = [];
  const visita = (lista: unknown, prefixo: string) => {
    if (!Array.isArray(lista)) return;
    for (const c of lista as Array<Record<string, unknown>>) {
      const tipo = String(c.type ?? "").toUpperCase();
      if (Array.isArray(c.cards)) {
        (c.cards as Array<Record<string, unknown>>).forEach((card, i) =>
          visita(card.components, `card ${i + 1} › `),
        );
        continue;
      }
      const texto = typeof c.text === "string" ? c.text : "";
      if (!texto.includes("{{")) continue;
      out.push({ onde: `${prefixo}${tipo === "HEADER" ? "cabeçalho" : "corpo"}`, text: texto });
    }
  };
  visita(components, "");
  return out;
}

type OrgGate =
  | { autorizado: true; orgId: string; userId: string; idioma: Idioma }
  | { autorizado: false; resposta: NextResponse };

/**
 * Quem pode ──────────────────────────────────────────────────────────────────
 *
 * Ler (`agent`): esta lista é a que alimenta o seletor da janela fechada no
 * inbox, e quem atende é quem precisa dela — a rota do canal intermediado já
 * funciona assim (`partner/templates`: "Ler (agent): é a lista que o seletor do
 * inbox usa"). Aqui ela pedia `admin` em TODOS os métodos, e o `agent` levava
 * `403 forbidden_role`: o `useQuery` do painel ficava sem `data`, a lista
 * filtrada por `APPROVED` virava `[]` e o seletor aparecia VAZIO — a #2328.
 *
 * Escrever (`admin`): sincronizar modelos e gravar link de mídia mexem na
 * configuração do canal da empresa (e por isso seguem bloqueados em sessão de
 * suporte). Mesmo recorte do canal intermediado.
 */
async function orgOrFail(requestId: string, papel: "agent" | "admin"): Promise<OrgGate> {
  const authz = await requireRole(papel, { requestId, resource: "channels_templates" });
  if (!authz.ok) return { autorizado: false, resposta: authz.response };
  return { autorizado: true, orgId: authz.org.orgId, userId: authz.user.id, idioma: authz.user.idioma };
}

/** `?channel_session_id=` — opcional. Ausente, a rota responde como sempre. */
const consultaSchema = z.object({ channel_session_id: z.string().uuid().optional() });

export async function GET(req: NextRequest): Promise<NextResponse> {
  const requestId = randomUUID();
  const r = await orgOrFail(requestId, "agent");
  if (!r.autorizado) return r.resposta;
  const t = (texto: string) => traduzir(texto, r.idioma);

  const consulta = consultaSchema.safeParse(Object.fromEntries(new URL(req.url).searchParams.entries()));
  if (!consulta.success) {
    return fail("validation_failed", t("channel_session_id inválido"), 422, { requestId });
  }
  const conexao = consulta.data.channel_session_id ?? null;

  const sessao = await metaSessionForOrg(r.orgId);
  const admin = createAdminClient();

  // Os modelos de UM número (a campanha escolhe pelo número que vai enviar): a
  // mesma regra do envio, `linhaDoEspelho`. A sessão é conferida CONTRA A
  // ORGANIZAÇÃO — id de outro tenant é 404, nunca a lista dele.
  let wabaDaConexao: string | null = null;
  if (conexao) {
    const { data: s, error: erroDaSessao } = await admin
      .from("channel_sessions")
      .select("provider, meta_waba_id")
      .eq("organization_id", r.orgId)
      .eq("id", conexao)
      .maybeSingle();
    if (erroDaSessao) return fail("internal_error", erroDaSessao.message, 500, { requestId });
    if (!s) return fail("not_found", t("conexão não encontrada"), 404, { requestId });
    wabaDaConexao = wabaDoOficial(s as { provider?: string | null; meta_waba_id?: string | null });
  }

  const { data, error } = await admin
    .from("meta_templates")
    .select(
      "name, language, status, category, rejected_reason, quality_score, parameter_format, contract_hash, components, synced_at, saved_values, channel_session_id, waba_id",
    )
    .eq("organization_id", r.orgId)
    .order("status")
    .order("name");

  if (error) return fail("internal_error", error.message, 500, { requestId });

  const linhas = conexao
    ? filtrarLinhasDaConexao(data ?? [], { channelSessionId: conexao, wabaDoOficial: wabaDaConexao })
    : (data ?? []);

  const templates: TemplateView[] = linhas.map((row) => {
    const contrato = deriveTemplateContract({
      name: row.name,
      language: row.language,
      parameter_format: row.parameter_format,
      components: row.components as never,
    });
    return {
      name: row.name,
      language: row.language,
      status: row.status,
      category: row.category,
      // Normaliza na LEITURA também: o "NONE" da Meta pode ter sido gravado por
      // uma versão anterior ao conserto, e um clone atualizado ainda o carrega.
      rejectedReason: normalizeRejectedReason(row.rejected_reason),
      qualityScore: row.quality_score,
      parameterFormat: contrato.parameterFormat,
      contractHash: row.contract_hash,
      syncedAt: row.synced_at,
      slots: contrato.slots.map((s) => ({
        key: s.key,
        expects: s.expects,
        onde: describeAddress(s.address),
        valueKey: slotKey(s.address, s.key),
      })),
      previews: textPreviews(row.components),
      // A DEFINIÇÃO crua, como a rota do canal intermediado já devolve.
      //
      // `previews` não serve para isto: ele filtra por `{{` (só interessa
      // mostrar o que tem variável), então um modelo SEM variável sai com a
      // lista vazia — e são exatamente esses que o operador consegue disparar
      // sem preencher nada. O seletor da janela fechada monta o corpo da
      // mensagem a partir daqui; sem o campo, ele caía no NOME TÉCNICO do
      // modelo e era isso que o cliente recebia.
      components: (row.components as unknown[]) ?? [],
      // Filtrado pelo contrato de HOJE: link salvo para um cabeçalho que deixou
      // de ser mídia não pode pré-preencher nada.
      savedValues: (() => {
        const r = mesclarValoresSalvos(contrato, (row.saved_values ?? {}) as Record<string, unknown>, {});
        return r.ok ? r.valores : {};
      })(),
    };
  });

  return ok({
    // `null` aqui não é "erro": é o estado de quem não tem canal oficial ATIVO —
    // nunca conectou, ou conectou e excluiu —, e a tela precisa distingui-lo de
    // "conectado, porém sem template".
    waba: sessao?.wabaId ?? null,
    // A tela mostra "Criar template" só quando o canal GERENCIA definições pela
    // API (capacidade + operações no adapter) e a conexão tem conta e número.
    podeGerenciar: !!sessao?.wabaId && !!sessao.phoneNumberId && opsDeModelosDaContaOficial() !== null,
    templates,
  });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const r = await orgOrFail(requestId, "admin");
  if (!r.autorizado) return r.resposta;
  const t = (texto: string) => traduzir(texto, r.idioma);

  // Corpo ausente (ou sem `acao`) = sincronizar: é o que o botão "Sincronizar com
  // a Meta" manda, e o que toda integração que já chamava esta rota continua mandando.
  const bruto = (await req.json().catch(() => null)) as unknown;
  const comAcao = bruto && typeof bruto === "object" && "acao" in bruto ? bruto : { acao: "sincronizar" };
  const pedido = acaoDoModeloOficialSchema.safeParse(comAcao);
  if (!pedido.success) {
    return fail("validation_failed", t("Confira o formulário do template."), 422, {
      requestId,
      details: pedido.error.flatten().fieldErrors as Record<string, unknown>,
    });
  }
  const corpo = pedido.data;

  const sessao = await metaSessionForOrg(r.orgId);
  if (!sessao?.wabaId) {
    return fail("invalid_request", "no_meta_channel", 400, { requestId });
  }

  // A credencial vem da SESSÃO que o operador conectou na tela, com o ambiente só
  // como RESERVA — a mesma porta que `send`, `checkHealth` e `fetchInboundMedia` já
  // usam. (Ver o histórico deste bloco na v1.86.0: a ORDEM dos desfechos não muda —
  // sem canal oficial `no_meta_channel`; com canal e sem credencial `missing_meta_token`.)
  const creds = await resolveMetaCreds(createAdminClient(), {
    organizationId: r.orgId,
    phoneNumberId: sessao.phoneNumberId ?? "",
  });
  if (!creds) return fail("invalid_request", "missing_meta_token", 400, { requestId });

  if (corpo.acao === "sincronizar") {
    try {
      const counts = await syncTemplates({
        organizationId: r.orgId,
        wabaId: sessao.wabaId,
        token: creds.token,
        graphVersion: creds.graphVersion,
      });
      return ok(counts);
    } catch (err) {
      // A falha da Graph API vira mensagem legível na tela, não 500 mudo — o
      // operador precisa saber se é token vencido, WABA errada ou rede.
      return fail("internal_error", err instanceof Error ? err.message : "sync_failed", 502, {
        requestId,
      });
    }
  }

  // ─── Criar, editar, apagar: só se o canal GERENCIA definições pela API ───
  const ops = opsDeModelosDaContaOficial();
  if (!ops || !sessao.phoneNumberId) {
    return fail("not_implemented", t("Este canal não gerencia definições."), 501, { requestId });
  }
  const admin = createAdminClient();
  const escopo = {
    orgId: r.orgId,
    sessionId: sessao.id,
    sessionRef: sessao.phoneNumberId,
    wabaDoOficial: sessao.wabaId,
  };

  try {
    if (corpo.acao === "criar") {
      const components = componentsDoFormulario(corpo) as Record<string, unknown>[];
      const criado = await ops.create({
        organizationId: r.orgId,
        sessionRef: escopo.sessionRef,
        draft: { name: corpo.name, language: corpo.language, category: corpo.category, components },
      });
      // O espelho NA HORA, com o estado que a revisão devolveu (PENDING): a tela
      // mostra "Em análise" sem esperar sincronizar. A linha é a da CONTA (sem
      // conexão), a mesma que o sync e o webhook de status atualizam depois.
      const status = criado.status && criado.status !== "UNKNOWN" ? criado.status : "PENDING";
      const [linha] = templatesToRows(
        { data: [{ name: corpo.name, language: corpo.language, status, category: corpo.category, components }] },
        r.orgId,
        sessao.wabaId,
      );
      const agora = new Date().toISOString();
      const { error: erroDoEspelho } = await admin
        .from("meta_templates")
        .upsert({ ...linha, synced_at: agora, updated_at: agora }, { onConflict: "organization_id,waba_id,name,language" });
      if (erroDoEspelho) {
        // O template EXISTE na Meta: falhar aqui faria o operador criar de novo
        // (e levar "nome repetido"). O sync seguinte o espelha.
        logger.warn("[templates] espelho do template criado falhou", { requestId, detail: erroDoEspelho.message });
      }
      await audit({
        action: "template.created",
        actorUserId: r.userId,
        organizationId: r.orgId,
        resourceType: "channel_session",
        resourceId: sessao.id,
        requestId,
        metadata: { name: corpo.name, language: corpo.language, category: corpo.category },
      });
      return ok({ acao: "criar", status }, { requestId, status: 201 });
    }

    const gestao = await executarGestao(
      ops,
      admin,
      escopo,
      corpo.acao === "editar"
        ? {
            acao: "editar",
            name: corpo.name,
            language: corpo.language,
            components: componentsDoFormulario(corpo) as Record<string, unknown>[],
          }
        : corpo,
    );
    if (!gestao.ok) {
      // Apagar um modelo em uso faria o passo do follow-up pular e o agente errar
      // o envio, em silêncio. A tela mostra ONDE e pede a confirmação.
      return fail("template_in_use", t("Este modelo está em uso. Confirme para apagar assim mesmo."), 409, {
        requestId,
        details: { usos: gestao.usos.map((u) => `${t(ROTULO_DO_USO[u.tipo])} «${u.nome}»`) },
      });
    }
    if (gestao.acao === "editar") {
      // A edição volta o template para revisão na Meta; o sync traz o estado novo.
      // Falha do sync não desfaz a edição, que já aconteceu.
      try {
        await syncTemplates({ organizationId: r.orgId, wabaId: sessao.wabaId, token: creds.token, graphVersion: creds.graphVersion });
      } catch (err) {
        logger.warn("[templates] sync depois de editar falhou", { requestId, detail: err instanceof Error ? err.message : String(err) });
      }
    }
    await audit({
      action: gestao.acao === "editar" ? "template.updated" : "template.deleted",
      actorUserId: r.userId,
      organizationId: r.orgId,
      resourceType: "channel_session",
      resourceId: sessao.id,
      requestId,
      metadata: { name: corpo.name, language: corpo.language },
    });
    return ok({ acao: gestao.acao }, { requestId });
  } catch (err) {
    const mensagem = err instanceof Error ? err.message : String(err);
    if (!ehErroDaPlataformaNoModelo(mensagem)) {
      // Falha NOSSA (banco do espelho, leitura dos usos, configuração, rede): não
      // é recusa da Meta, e o texto cru do banco não vai para a tela.
      logger.error("[templates] falha local ao gerenciar template", { requestId, detail: mensagem });
      return fail("internal_error", t("Não foi possível concluir a operação com o template. Tente de novo."), 500, {
        requestId,
      });
    }
    const explicada = explicarErroDaCriacao(mensagem);
    logger.warn("[templates] a Meta recusou", { requestId, detail: explicada.originalDaMeta ?? explicada.frase });
    // A frase é a nossa LEITURA do texto da Meta; o original vai junto para a tela
    // mostrar "<frase> (Meta: <original>)" — uma leitura errada nunca fica
    // silenciosa. Sem frase conhecida, a mensagem já é o texto da Meta.
    return fail("upstream_error", explicada.traduzivel ? t(explicada.frase) : explicada.frase, 502, {
      requestId,
      ...(explicada.originalDaMeta ? { details: { originalDaMeta: explicada.originalDaMeta } } : {}),
    });
  }
}

/**
 * Salva o link da mídia de um modelo, para o painel da janela fechada
 * pré-preencher no próximo disparo. Valor vazio esquece o link.
 *
 * Só slot de mídia e só `https://` — ver `lib/channels/meta/valores-salvos.ts`.
 * Mesmo papel do sync (`admin`), e bloqueado em sessão de suporte, porque
 * escreve na configuração do canal.
 *
 * Grava em TODAS as linhas do mesmo nome e idioma da organização: a tela lista
 * o modelo uma vez só, e dois números oficiais com a mesma definição
 * divergiriam em silêncio se só um recebesse o link.
 */
export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const r = await orgOrFail(requestId, "admin");
  if (!r.autorizado) return r.resposta;

  const body = (await req.json().catch(() => null)) as {
    name?: unknown;
    language?: unknown;
    values?: unknown;
  } | null;
  const valores = body?.values;
  if (
    typeof body?.name !== "string" ||
    typeof body?.language !== "string" ||
    !valores ||
    typeof valores !== "object" ||
    Array.isArray(valores) ||
    !Object.values(valores).every((v) => typeof v === "string")
  ) {
    return fail("validation_failed", "esperado { name, language, values: { chave: link } }", 422, {
      requestId,
    });
  }

  const admin = createAdminClient();
  const { data: linhas, error } = await admin
    .from("meta_templates")
    .select("id, name, language, parameter_format, components, saved_values")
    .eq("organization_id", r.orgId)
    .eq("name", body.name)
    .eq("language", body.language);
  if (error) return fail("internal_error", error.message, 500, { requestId });
  if (!linhas || linhas.length === 0) {
    return fail("not_found", "modelo não encontrado", 404, { requestId });
  }

  // Confere TUDO antes de escrever qualquer linha: recusar a segunda depois de
  // gravar a primeira deixaria os números divergindo.
  const planos: Array<{ id: string; valores: Record<string, string> }> = [];
  for (const linha of linhas) {
    const contrato = deriveTemplateContract({
      name: linha.name,
      language: linha.language,
      parameter_format: linha.parameter_format,
      components: linha.components as never,
    });
    const m = mesclarValoresSalvos(
      contrato,
      (linha.saved_values ?? {}) as Record<string, unknown>,
      valores as Record<string, string>,
    );
    if (!m.ok) {
      return fail("validation_failed", m.motivo, 422, { requestId, details: { chave: m.chave } });
    }
    planos.push({ id: linha.id, valores: m.valores });
  }

  for (const plano of planos) {
    const { error: erro } = await admin
      .from("meta_templates")
      .update({ saved_values: plano.valores })
      .eq("organization_id", r.orgId)
      .eq("id", plano.id);
    if (erro) return fail("internal_error", erro.message, 500, { requestId });
  }

  return ok({ savedValues: planos[0]!.valores });
}
