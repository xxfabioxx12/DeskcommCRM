/**
 * EDITAR E APAGAR uma definição aprovada, pela tela — o que o adapter já sabia
 * fazer desde que o canal entrou (`templates.update` / `templates.remove`) e a
 * tela não oferecia. Quem opera tinha de ir à plataforma do provedor para trocar
 * uma vírgula ou tirar um modelo velho da lista.
 *
 * As duas rotas de modelos do canal intermediado (`partner` e `graph-partner`)
 * usam este módulo: a regra é uma só, e duas cópias envelheceriam separadas.
 *
 * ─── Apagar pergunta antes: onde o modelo está em uso ──────────────────────
 *
 * Um modelo aprovado é referenciado por id no grafo dos follow-ups
 * (`template_id` / `fallback_template_id`) e por NOME no prompt do agente
 * (`send_template`). Apagar sem avisar faria o passo do fluxo pular e o agente
 * errar o envio — em silêncio, dias depois. Por isso o apagar sem
 * `confirmado: true` devolve a lista de usos, e a tela pede a confirmação com
 * ela à vista.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { STATUS_DA_CAMPANHA, type StatusDaCampanha } from "@/lib/campanhas/tipos";

import type { ChannelTemplateOps } from "./types";

/**
 * Campanha que ainda pode enviar (ou voltar a enviar) o modelo: tudo menos os
 * estados finais. Apagar o modelo de uma campanha pausada faria a retomada
 * pausar de novo por `template_nao_aprovado` — em silêncio para quem apagou.
 */
const ESTADOS_FINAIS_DA_CAMPANHA: ReadonlySet<StatusDaCampanha> = new Set(["completed", "cancelled", "failed"]);
const CAMPANHA_AINDA_USA = STATUS_DA_CAMPANHA.filter((s) => !ESTADOS_FINAIS_DA_CAMPANHA.has(s));

export type TipoDeUso = "fluxo" | "agente" | "campanha";

/** O rótulo (pt) de cada tipo de uso; a rota passa por `traduzir`. */
export const ROTULO_DO_USO: Record<TipoDeUso, string> = {
  fluxo: "Follow-up",
  agente: "Agente",
  campanha: "Campanha",
};

export const acaoEditarSchema = z.object({
  acao: z.literal("editar"),
  name: z.string().trim().min(1).max(512),
  language: z.string().trim().min(2).max(15),
  components: z.array(z.record(z.string(), z.unknown())).min(1).max(10),
});

export const acaoApagarSchema = z.object({
  acao: z.literal("apagar"),
  name: z.string().trim().min(1).max(512),
  language: z.string().trim().min(2).max(15),
  /** `true` = quem opera já viu os usos e decidiu apagar assim mesmo. */
  confirmado: z.boolean().default(false),
});

export type AcaoDeGestao = z.infer<typeof acaoEditarSchema> | z.infer<typeof acaoApagarSchema>;

export interface EscopoDaGestao {
  orgId: string;
  sessionId: string;
  sessionRef: string;
  /**
   * Conta oficial: as linhas do espelho são da WABA e não têm conexão
   * (`channel_session_id IS NULL`, ver `meta/template-sync.ts`). Ausente = canal
   * intermediado, linhas da conexão (como sempre foi).
   */
  wabaDoOficial?: string | null;
}

/** O mínimo do construtor do PostgREST que o filtro do espelho usa. */
interface FiltroDoEspelho {
  eq(coluna: string, valor: unknown): FiltroDoEspelho;
  is(coluna: string, valor: null): FiltroDoEspelho;
}

/** As linhas do espelho DESTA conexão (ou desta conta oficial). */
function daConexao<T>(consulta: T, escopo: EscopoDaGestao): T {
  const q = consulta as unknown as FiltroDoEspelho;
  const filtrada = escopo.wabaDoOficial
    ? q.is("channel_session_id", null).eq("waba_id", escopo.wabaDoOficial)
    : q.eq("channel_session_id", escopo.sessionId);
  return filtrada as unknown as T;
}

/**
 * Onde o modelo é usado, em frases para a tela (pt; a rota traduz os rótulos).
 * Lê só o que VALE hoje: a versão ativa e o rascunho de cada follow-up, e a
 * versão publicada de cada agente.
 */
export async function usosDoModelo(
  admin: SupabaseClient,
  orgId: string,
  alvo: { name: string; language: string; ids: string[] },
): Promise<{ tipo: TipoDeUso; nome: string }[]> {
  const usos: { tipo: TipoDeUso; nome: string }[] = [];

  if (alvo.ids.length > 0) {
    const { data: ponteiros, error } = await admin
      .from("followup_flow_pointers")
      .select("name, active_version_id, draft_graph")
      .eq("organization_id", orgId);
    if (error) throw new Error(`usos_fluxos: ${error.message}`);
    const lista = (ponteiros ?? []) as { name: string; active_version_id: string | null; draft_graph: unknown }[];
    const ativas = lista.map((p) => p.active_version_id).filter((v): v is string => !!v);
    const grafos = new Map<string, string>();
    if (ativas.length > 0) {
      const { data: versoes, error: ev } = await admin
        .from("followup_flow_versions")
        .select("id, graph")
        .eq("organization_id", orgId)
        .in("id", ativas);
      if (ev) throw new Error(`usos_versoes: ${ev.message}`);
      for (const v of (versoes ?? []) as { id: string; graph: unknown }[]) grafos.set(v.id, JSON.stringify(v.graph));
    }
    for (const p of lista) {
      const textos = [JSON.stringify(p.draft_graph ?? null), p.active_version_id ? (grafos.get(p.active_version_id) ?? "") : ""];
      if (alvo.ids.some((id) => textos.some((t) => t.includes(id)))) usos.push({ tipo: "fluxo", nome: p.name });
    }
  }

  const { data: agentes, error: ea } = await admin
    .from("ai_agents")
    .select("name, published_version_id")
    .eq("organization_id", orgId)
    .not("published_version_id", "is", null);
  if (ea) throw new Error(`usos_agentes: ${ea.message}`);
  const publicados = (agentes ?? []) as { name: string; published_version_id: string }[];
  if (publicados.length > 0) {
    const { data: versoes, error: ev } = await admin
      .from("ai_agent_versions")
      .select("id, system_prompt")
      .eq("organization_id", orgId)
      .in("id", publicados.map((a) => a.published_version_id));
    if (ev) throw new Error(`usos_prompts: ${ev.message}`);
    const prompt = new Map(((versoes ?? []) as { id: string; system_prompt: string | null }[]).map((v) => [v.id, v.system_prompt ?? ""]));
    for (const a of publicados) {
      if ((prompt.get(a.published_version_id) ?? "").includes(alvo.name)) usos.push({ tipo: "agente", nome: a.name });
    }
  }

  // Campanha com template guarda NOME e IDIOMA (`campaigns.template_name`/`template_language`).
  const { data: campanhas, error: ec } = await admin
    .from("campaigns")
    .select("name")
    .eq("organization_id", orgId)
    .eq("message_mode", "template")
    .eq("template_name", alvo.name)
    .eq("template_language", alvo.language)
    .in("status", CAMPANHA_AINDA_USA);
  if (ec) throw new Error(`usos_campanhas: ${ec.message}`);
  for (const c of (campanhas ?? []) as { name: string }[]) usos.push({ tipo: "campanha", nome: c.name });
  return usos;
}

export type ResultadoDaGestao =
  | { ok: true; acao: "editar" | "apagar" }
  | { ok: false; codigo: "em_uso"; usos: { tipo: TipoDeUso; nome: string }[] };

/**
 * Executa a edição ou o apagamento. Erro da plataforma SOBE com o texto dela —
 * é ele que diz "editado demais nesta semana" ou "nome inválido", e a rota o
 * entrega inteiro à tela, como no criar.
 */
export async function executarGestao(
  ops: ChannelTemplateOps,
  admin: SupabaseClient,
  escopo: EscopoDaGestao,
  corpo: AcaoDeGestao,
): Promise<ResultadoDaGestao> {
  if (corpo.acao === "editar") {
    await ops.update({
      organizationId: escopo.orgId,
      sessionRef: escopo.sessionRef,
      name: corpo.name,
      language: corpo.language,
      patch: { components: corpo.components },
    });
    return { ok: true, acao: "editar" };
  }

  const { data: linhas, error } = await daConexao(
    admin.from("meta_templates").select("id").eq("organization_id", escopo.orgId),
    escopo,
  )
    .eq("name", corpo.name)
    .eq("language", corpo.language);
  if (error) throw new Error(`modelo_espelho: ${error.message}`);
  const ids = ((linhas ?? []) as { id: string }[]).map((l) => l.id);

  if (!corpo.confirmado) {
    const usos = await usosDoModelo(admin, escopo.orgId, { name: corpo.name, language: corpo.language, ids });
    if (usos.length > 0) return { ok: false, codigo: "em_uso", usos };
  }

  await ops.remove({
    organizationId: escopo.orgId,
    sessionRef: escopo.sessionRef,
    name: corpo.name,
    language: corpo.language,
  });
  // O sincronizar só ACRESCENTA modelos desta conta (ausência na lista pode ser
  // erro transitório); o apagado sai do espelho aqui, porque aqui sabemos que
  // ele deixou de existir.
  const { error: ed } = await daConexao(
    admin.from("meta_templates").delete().eq("organization_id", escopo.orgId),
    escopo,
  )
    .eq("name", corpo.name)
    .eq("language", corpo.language);
  if (ed) throw new Error(`modelo_espelho_apagar: ${ed.message}`);
  return { ok: true, acao: "apagar" };
}
