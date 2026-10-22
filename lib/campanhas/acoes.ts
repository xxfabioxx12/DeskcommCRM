/**
 * As AÇÕES da campanha — preparar, iniciar, agendar, pausar, retomar, cancelar,
 * duplicar e testar.
 *
 * Moram aqui, e não em oito rotas, porque as oito fazem a mesma coisa em volta:
 * carregar a campanha da organização certa, perguntar à máquina de estados se a
 * transição vale, escrever, auditar. Espalhado, esse "em volta" diverge — e o
 * dia em que uma rota esquecer de conferir o estado é o dia em que uma campanha
 * cancelada volta a enviar.
 *
 * Cada função devolve `{ ok: false, codigo, mensagem, status }` em vez de lançar:
 * a rota traduz para `fail()` sem interpretar exceção, e o motivo chega ao
 * operador com o texto real (Regra nº 1).
 */
import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { ApiErrorCode } from "@/lib/api/errors";
import { sendMessageHandler } from "@/app/api/v1/messages/_handler";
import { beginServiceAtOrigin } from "@/lib/atendimento/origem";
import { renderTemplateBody } from "@/lib/channels/meta/render-template";

import { baseLegalValida, motivoParaExcluir, recusouMarketing } from "./elegibilidade";
import { ehStatusDaCampanha, podeTransitar } from "./maquina-de-estados";
import { prepararCampanha } from "./preparacao";
import { problemaNoTexto } from "./valores-do-contexto";
import { nomeDoContato } from "@/lib/contacts/rotulo-do-contato";
import { camposDoDestinatario } from "./consulta-de-audiencia";
import { renderizar } from "./renderizador";
import { conferirConteudoDaCampanha, conteudoDaLinha, type DefinicaoDaCampanha } from "./conferir-template";
import { lerPoolExtra } from "./pool-de-numeros";
import { resolverSlots, textoDasExpressoes } from "./template-da-campanha";
import {
  TEXTO_DA_FALHA_DA_CAMPANHA,
  ehFalhaQuePausaACampanha,
  type ModoDaMensagem,
  type StatusDaCampanha,
} from "./tipos";

export interface CampanhaCarregada {
  id: string;
  organization_id: string;
  name: string;
  status: StatusDaCampanha;
  channel_session_id: string;
  message_body: string | null;
  base_legal: string;
  lia_ref: string | null;
  audience_filter: unknown;
  audience_version: number;
  content_version: number;
  scheduled_at: string | null;
  intervalo_segundos: number | null;
  janela_inicio_hora: number | null;
  janela_fim_hora: number | null;
  teto_diario: number | null;
  teto_horario: number | null;
  description: string | null;
  /** Migration 9001. Base sem a migration devolve `undefined`, lido como texto. */
  message_mode: ModoDaMensagem;
  template_name: string | null;
  template_language: string | null;
  template_contract_hash: string | null;
  template_slot_map: Record<string, string> | null;
  failure_code: string | null;
  /** Migration 9001: a campanha de onde esta cópia saiu (Duplicar), ou `null`. */
  duplicated_from_campaign_id?: string | null;
}

export type Recusa = { ok: false; codigo: ApiErrorCode; mensagem: string; status: number };
export type Desfecho<T = unknown> = ({ ok: true } & T) | Recusa;

const COLUNAS =
  "id, organization_id, name, status, channel_session_id, message_body, base_legal, lia_ref, " +
  "audience_filter, audience_version, content_version, scheduled_at, description, " +
  "intervalo_segundos, janela_inicio_hora, janela_fim_hora, teto_diario, teto_horario, " +
  "message_mode, template_name, template_language, template_contract_hash, template_slot_map, failure_code, " +
  "duplicated_from_campaign_id";

export async function carregarCampanha(
  admin: SupabaseClient,
  organizationId: string,
  campanhaId: string,
): Promise<Desfecho<{ campanha: CampanhaCarregada }>> {
  const { data } = await admin
    .from("campaigns")
    .select(COLUNAS)
    .eq("organization_id", organizationId)
    .eq("id", campanhaId)
    .maybeSingle();
  if (!data) {
    return {
      ok: false,
      codigo: "campanha_nao_encontrada",
      mensagem: "Campanha não encontrada.",
      status: 404,
    };
  }
  const campanha = data as unknown as CampanhaCarregada;
  if (!ehStatusDaCampanha(campanha.status)) {
    return {
      ok: false,
      codigo: "campanha_estado_invalido",
      mensagem: `A campanha está num estado que este sistema não conhece ("${campanha.status}").`,
      status: 409,
    };
  }
  return { ok: true, campanha };
}

function recusaDeTransicao(de: StatusDaCampanha, para: StatusDaCampanha): Recusa | null {
  const r = podeTransitar(de, para);
  return r.pode ? null : { ok: false, codigo: "campanha_estado_invalido", mensagem: r.motivo, status: 409 };
}

/** O que toda campanha precisa ter antes de qualquer envio — inclusive o de teste. */
function faltaParaEnviar(c: CampanhaCarregada): Recusa | null {
  // Em template a mensagem é a definição aprovada; quem confere é `conferirMensagem`.
  if (c.message_mode !== "template" && (c.message_body ?? "").trim() === "") {
    return {
      ok: false,
      codigo: "campanha_conteudo_invalido",
      mensagem: "Escreva a mensagem antes de preparar a campanha.",
      status: 422,
    };
  }
  if (!baseLegalValida({ baseLegal: c.base_legal, liaRef: c.lia_ref })) {
    return {
      ok: false,
      codigo: "campanha_base_legal_invalida",
      mensagem:
        "Interesse legítimo exige a referência da avaliação (LIA). Sem ela não há como responder " +
        "a quem perguntar com base em quê recebeu a mensagem.",
      status: 422,
    };
  }
  return null;
}

/**
 * O número aceita esta mensagem? Texto num número que exige template, template
 * num número de QR Code, template pausado/mudado/ausente em algum número do
 * rodízio — tudo recusado aqui, ANTES de qualquer escrita, com a frase do motivo.
 * A conferência em si mora em `conferir-template.ts`; aqui só se chama.
 */
async function conferirMensagem(
  admin: SupabaseClient,
  c: CampanhaCarregada,
): Promise<Desfecho<{ definicao: DefinicaoDaCampanha | null }>> {
  try {
    const extras = await lerPoolExtra(admin, c.organization_id, c.id);
    const r = await conferirConteudoDaCampanha(admin, {
      organizationId: c.organization_id,
      channelSessionIds: [c.channel_session_id, ...extras],
      conteudo: conteudoDaLinha(c),
    });
    if (!r.ok) {
      // Campanha que já começou não se edita: "escolha outro template" seria um
      // beco sem saída. A frase da falha manda cancelar, duplicar e escolher na cópia.
      const mensagem = r.falha && c.status !== "draft" ? TEXTO_DA_FALHA_DA_CAMPANHA[r.falha] : r.mensagem;
      return { ok: false, codigo: r.codigo, mensagem, status: r.status };
    }
    return { ok: true, definicao: r.definicao };
  } catch (err) {
    // Exceção inesperada (banco fora etc.) não é recusa de negócio: 500.
    return {
      ok: false,
      codigo: "internal_error",
      mensagem: err instanceof Error ? err.message : String(err),
      status: 500,
    };
  }
}

/** Já saiu alguma mensagem desta campanha? Reconstruir snapshot depois disso é proibido. */
async function jaEnviou(admin: SupabaseClient, campanhaId: string): Promise<boolean> {
  const { count } = await admin
    .from("campaign_recipients")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campanhaId)
    .not("sent_at", "is", null);
  return (count ?? 0) > 0;
}

export async function prepararAcao(
  admin: SupabaseClient,
  c: CampanhaCarregada,
  agora: Date,
): Promise<Desfecho<{ resumo: { total: number; elegiveis: number; excluidos: number } }>> {
  const recusa = recusaDeTransicao(c.status, "preparing") ?? faltaParaEnviar(c);
  if (recusa) return recusa;
  // Só aqui (não em iniciar/testar): campanha já preparada com variável torta segue rodando.
  const problemaDoTexto = c.message_mode !== "template" ? problemaNoTexto(c.message_body ?? "") : null;
  if (problemaDoTexto) {
    return { ok: false, codigo: "campanha_conteudo_invalido", mensagem: problemaDoTexto, status: 422 };
  }
  const mensagem = await conferirMensagem(admin, c);
  if (!mensagem.ok) return mensagem;
  if (await jaEnviou(admin, c.id)) {
    return {
      ok: false,
      codigo: "campanha_nao_editavel",
      mensagem: "Esta campanha já enviou mensagens; refazer a lista mudaria o que já foi dito.",
      status: 409,
    };
  }

  // Compare-and-set: dois cliques simultâneos, e só um entra em `preparing`.
  const { data: entrou } = await admin
    .from("campaigns")
    .update({ status: "preparing" })
    .eq("id", c.id)
    .eq("status", "draft")
    .select("id");
  if ((entrou ?? []).length === 0) {
    return {
      ok: false,
      codigo: "campanha_preparando",
      mensagem: "A preparação desta campanha já está em andamento.",
      status: 409,
    };
  }

  try {
    const resumo = await prepararCampanha(admin, {
      campanhaId: c.id,
      organizationId: c.organization_id,
      filtro: c.audience_filter,
      corpo: c.message_body ?? "",
      contentVersion: c.content_version,
      agora,
      template: mensagem.definicao
        ? {
            slotMap: conteudoDaLinha(c).slotMap,
            modelo: {
              name: mensagem.definicao.name,
              language: mensagem.definicao.language,
              parameterFormat: mensagem.definicao.parameterFormat,
              components: mensagem.definicao.components,
            },
          }
        : null,
    });
    if (resumo.total === 0) {
      await voltarAoRascunho(admin, c.id, "audiencia_vazia");
      return {
        ok: false,
        codigo: "campanha_sem_audiencia",
        mensagem: "O recorte não encontrou nenhum contato. Ajuste o filtro.",
        status: 422,
      };
    }
    if (resumo.elegiveis === 0) {
      await voltarAoRascunho(admin, c.id, "sem_elegiveis");
      return {
        ok: false,
        codigo: "campanha_sem_elegiveis",
        mensagem:
          "O recorte encontrou contatos, mas nenhum pode receber — veja os motivos na prévia.",
        status: 422,
      };
    }

    await admin
      .from("campaigns")
      .update({
        status: "ready",
        prepared_at: agora.toISOString(),
        snapshot_total: resumo.total,
        snapshot_eligible: resumo.elegiveis,
        snapshot_excluded: resumo.excluidos,
        audience_version: c.audience_version + 1,
      })
      .eq("id", c.id)
      .eq("status", "preparing");

    return { ok: true, resumo };
  } catch (err) {
    // A campanha não pode ficar presa em `preparing`: quem tentou preparar
    // precisa poder corrigir o filtro e tentar de novo.
    await voltarAoRascunho(admin, c.id, "erro_na_preparacao");
    return {
      ok: false,
      codigo: "campanha_sem_audiencia",
      mensagem: err instanceof Error ? err.message : String(err),
      status: 422,
    };
  }
}

async function voltarAoRascunho(admin: SupabaseClient, id: string, codigo: string): Promise<void> {
  await admin
    .from("campaigns")
    .update({ status: "draft", failure_code: codigo })
    .eq("id", id)
    .eq("status", "preparing");
}

export async function iniciarAcao(
  admin: SupabaseClient,
  c: CampanhaCarregada,
  agora: Date,
): Promise<Desfecho<{ retomada: boolean }>> {
  const recusa = recusaDeTransicao(c.status, "running") ?? faltaParaEnviar(c);
  if (recusa) return recusa;
  // Retomar uma campanha pausada por template exige o template em dia de novo.
  const mensagem = await conferirMensagem(admin, c);
  if (!mensagem.ok) return mensagem;

  const { count } = await admin
    .from("campaign_recipients")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", c.id)
    .eq("eligibility_status", "eligible");
  if ((count ?? 0) === 0) {
    return {
      ok: false,
      codigo: "campanha_sem_elegiveis",
      mensagem: "Nenhum destinatário elegível. Prepare a campanha antes de iniciar.",
      status: 422,
    };
  }

  const retomada = c.status === "paused";
  const { data } = await admin
    .from("campaigns")
    .update({
      status: "running",
      started_at: agora.toISOString(),
      paused_at: null,
      scheduled_at: null,
      // O motivo da pausa automática (template, conta do número, falhas seguidas)
      // sai junto com a pausa; outro motivo fica.
      ...(ehFalhaQuePausaACampanha(c.failure_code) ? { failure_code: null, failure_detail: null } : {}),
    })
    .eq("id", c.id)
    .eq("status", c.status)
    .select("id");
  if ((data ?? []).length === 0) return conflitoDeCorrida();
  return { ok: true, retomada };
}

export async function agendarAcao(
  admin: SupabaseClient,
  c: CampanhaCarregada,
  quando: Date,
  agora: Date,
): Promise<Desfecho> {
  const recusa = recusaDeTransicao(c.status, "scheduled") ?? faltaParaEnviar(c);
  if (recusa) return recusa;
  const mensagem = await conferirMensagem(admin, c);
  if (!mensagem.ok) return mensagem;
  if (quando.getTime() <= agora.getTime()) {
    return {
      ok: false,
      codigo: "campanha_agenda_invalida",
      mensagem: "Escolha uma data no futuro — para enviar agora, use Iniciar.",
      status: 422,
    };
  }
  const { data } = await admin
    .from("campaigns")
    .update({ status: "scheduled", scheduled_at: quando.toISOString(), paused_at: null })
    .eq("id", c.id)
    .eq("status", c.status)
    .select("id");
  if ((data ?? []).length === 0) return conflitoDeCorrida();
  return { ok: true };
}

export async function pausarAcao(
  admin: SupabaseClient,
  c: CampanhaCarregada,
  agora: Date,
): Promise<Desfecho> {
  const recusa = recusaDeTransicao(c.status, "paused");
  if (recusa) return recusa;
  const { data } = await admin
    .from("campaigns")
    .update({ status: "paused", paused_at: agora.toISOString() })
    .eq("id", c.id)
    .eq("status", c.status)
    .select("id");
  if ((data ?? []).length === 0) return conflitoDeCorrida();
  // Quem já estava `sending` NÃO é desfeito: a mensagem pode estar na borda
  // externa neste instante, e prometer cancelamento do que já saiu é mentir.
  return { ok: true };
}

export async function cancelarAcao(
  admin: SupabaseClient,
  c: CampanhaCarregada,
  agora: Date,
): Promise<Desfecho<{ cancelados: number }>> {
  const recusa = recusaDeTransicao(c.status, "cancelled");
  if (recusa) return recusa;
  const { data } = await admin
    .from("campaigns")
    .update({ status: "cancelled", cancelled_at: agora.toISOString() })
    .eq("id", c.id)
    .eq("status", c.status)
    .select("id");
  if ((data ?? []).length === 0) return conflitoDeCorrida();

  // A campanha já está cancelada quando esta linha roda: a rodada não escolhe
  // mais esta campanha, então não há corrida com o worker por estes pendentes.
  const { data: cancelados } = await admin
    .from("campaign_recipients")
    .update({ status: "cancelled", cancelled_at: agora.toISOString() })
    .eq("campaign_id", c.id)
    .in("status", ["pending", "queued"])
    .select("id");
  return { ok: true, cancelados: (cancelados ?? []).length };
}

export async function duplicarAcao(
  admin: SupabaseClient,
  c: CampanhaCarregada,
  autorId: string,
): Promise<Desfecho<{ id: string }>> {
  const { data, error } = await admin
    .from("campaigns")
    .insert({
      organization_id: c.organization_id,
      name: `${c.name} (cópia)`.slice(0, 160),
      description: c.description,
      channel_session_id: c.channel_session_id,
      message_body: c.message_body,
      message_mode: c.message_mode ?? "text",
      template_name: c.template_name ?? null,
      template_language: c.template_language ?? null,
      template_contract_hash: c.template_contract_hash ?? null,
      template_slot_map: c.template_slot_map ?? {},
      base_legal: c.base_legal,
      lia_ref: c.lia_ref,
      audience_filter: c.audience_filter,
      intervalo_segundos: c.intervalo_segundos,
      janela_inicio_hora: c.janela_inicio_hora,
      janela_fim_hora: c.janela_fim_hora,
      teto_diario: c.teto_diario,
      teto_horario: c.teto_horario,
      created_by: autorId,
      // A cópia pula quem já recebeu esta campanha (`contatosQueJaReceberamNaOrigem`,
      // na preparação): é a saída de uma campanha pausada por template.
      duplicated_from_campaign_id: c.id,
      // Nada de destinatário, resultado, agenda ou carimbo de execução: a cópia
      // é uma INTENÇÃO nova, e herdar números faria a tela mostrar entrega de
      // mensagem que esta campanha nunca mandou.
    })
    .select("id")
    .single();
  if (error || !data) {
    return {
      ok: false,
      codigo: "campanha_estado_invalido",
      mensagem: error?.message ?? "Não foi possível duplicar a campanha.",
      status: 422,
    };
  }
  return { ok: true, id: (data as { id: string }).id };
}

/**
 * O teste: a MESMA conexão, a MESMA resolução de variáveis, a MESMA camada de envio.
 *
 * Um teste que passasse por outro caminho provaria o outro caminho. E ele não
 * toca nos contadores da execução oficial — não cria destinatário, não gasta
 * fila —, mas gasta o ritmo do número, porque para o WhatsApp é uma mensagem
 * como qualquer outra.
 */
export async function testarAcao(
  admin: SupabaseClient,
  c: CampanhaCarregada,
  contactId: string,
  agora: Date,
  fuso: string,
): Promise<Desfecho<{ status: string }>> {
  const recusa = faltaParaEnviar(c);
  if (recusa) return recusa;

  const { data: contato } = await admin
    .from("contacts")
    .select("id, name, display_name, phone_number, is_blocked, is_personal, is_anonymized, consent")
    .eq("organization_id", c.organization_id)
    .eq("id", contactId)
    .maybeSingle();
  if (!contato) {
    return {
      ok: false,
      codigo: "campanha_nao_encontrada",
      mensagem: "Contato de teste não encontrado nesta organização.",
      status: 404,
    };
  }
  const linha = contato as {
    id: string;
    name: string | null;
    display_name: string | null;
    phone_number: string | null;
    is_blocked: boolean;
    is_personal: boolean;
    is_anonymized: boolean;
    consent: unknown;
  };

  // O teste respeita os MESMOS vetos: mandar teste para quem pediu para parar
  // seria furar o opt-out pela porta dos fundos.
  const motivo = motivoParaExcluir({
    contactId: linha.id,
    telefone: linha.phone_number,
    bloqueado: linha.is_blocked,
    pessoal: linha.is_personal === true,
    anonimizado: linha.is_anonymized,
    recusouMarketing: recusouMarketing(linha.consent),
  });
  if (motivo) {
    return {
      ok: false,
      codigo: "campanha_conteudo_invalido",
      mensagem: `Este contato não pode receber: ${motivo}.`,
      status: 422,
    };
  }

  const conferida = await conferirMensagem(admin, c);
  if (!conferida.ok) return conferida;

  // Template: valores do contato pelo mesmo `resolverSlots` da preparação, link
  // salvo do cabeçalho e corpo pelo mesmo montador do envio.
  let entradaDoEnvio: { type: "text" | "template"; body: string } & Record<string, unknown>;
  if (c.message_mode === "template") {
    const definicao = conferida.definicao;
    if (!definicao) {
      return {
        ok: false,
        codigo: "internal_error",
        mensagem: "A conferência do template não devolveu a definição.",
        status: 500,
      };
    }
    const mapa = conteudoDaLinha(c).slotMap;
    const campos = await camposDoDestinatario(admin, {
      organizationId: c.organization_id,
      contactId: linha.id,
      corpo: textoDasExpressoes(mapa),
    });
    const r = resolverSlots(mapa, { nome: nomeDoContato(linha), ...campos }, { agora, fuso });
    if (r.faltando.length > 0) {
      return {
        ok: false,
        codigo: "campanha_conteudo_invalido",
        mensagem: `Falta ${r.faltando.join(", ")} no cadastro deste contato — escolha outro para o teste.`,
        status: 422,
      };
    }
    const valores = { ...definicao.salvos, ...r.valores };
    const corpo = renderTemplateBody(definicao.components, valores, {
      name: definicao.name,
      language: definicao.language,
      parameterFormat: definicao.parameterFormat,
    }).trim();
    entradaDoEnvio = {
      type: "template",
      template_name: definicao.name,
      template_language: definicao.language,
      template_values: valores,
      body: corpo || definicao.name,
    };
  } else {
    // Os campos personalizados que o TEXTO usa entram aqui pelo MESMO caminho da
    // prévia: teste que não resolvia `{{lead.gancho}}` reprovaria o texto que o
    // envio manda certo.
    const campos = await camposDoDestinatario(admin, {
      organizationId: c.organization_id,
      contactId: linha.id,
      corpo: c.message_body ?? "",
    });
    const render = renderizar(
      c.message_body ?? "",
      { nome: nomeDoContato(linha), ...campos },
      { agora, fuso },
    );
    if (render.faltando.length > 0) {
      return {
        ok: false,
        codigo: "campanha_conteudo_invalido",
        mensagem: `Falta ${render.faltando.join(", ")} no cadastro deste contato — escolha outro para o teste.`,
        status: 422,
      };
    }
    entradaDoEnvio = { type: "text", body: render.texto };
  }

  const boundary = await beginServiceAtOrigin(admin, c.organization_id, linha.id, c.channel_session_id);
  const mensagem = await sendMessageHandler(
    admin,
    {
      organization_id: c.organization_id,
      serviceBoundary: boundary,
      proactiveContext: { organizationId: c.organization_id, contactId: linha.id },
      actor: { type: "webhook_source", id: `campaign-test:${c.id}` },
      requestId: `campaign-test:${c.id}:${randomUUID()}`,
    } as Parameters<typeof sendMessageHandler>[1],
    {
      conversation_id: boundary.conversation_id,
      ...entradaDoEnvio,
      metadata: { source: "campaign_test", campaign_id: c.id },
    } as Parameters<typeof sendMessageHandler>[2],
  );

  const status = (mensagem as { status?: string }).status ?? "desconhecido";
  if (status === "failed") {
    return {
      ok: false,
      codigo: "campanha_canal_indisponivel",
      mensagem: "O envio de teste falhou no canal. Verifique a conexão antes de iniciar a campanha.",
      status: 409,
    };
  }
  return { ok: true, status };
}

function conflitoDeCorrida(): Recusa {
  return {
    ok: false,
    codigo: "campanha_estado_invalido",
    mensagem: "O estado da campanha mudou enquanto esta ação era processada. Recarregue a tela.",
    status: 409,
  };
}
