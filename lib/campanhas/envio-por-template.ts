/**
 * O ENVIO POR TEMPLATE de um destinatário, montado na RODADA.
 *
 * ═══ Por que conferir de novo, a cada envio ═══
 *
 * A definição é da plataforma e muda sem avisar: pode ser pausada por qualidade,
 * desativada, ou editada (contrato novo). Conferida só ao iniciar, a campanha
 * seguiria mandando — e cada envio viraria um destinatário `failed` a mais. Aqui
 * o vínculo (`conferirLinhaDoModelo`, a mesma conferência da gravação) é
 * conferido ANTES da reserva do destinatário: falhou, a CAMPANHA pausa com o
 * motivo e a pessoa continua na fila.
 *
 * ═══ O link do cabeçalho vai junto ═══
 *
 * A porta de saída das mensagens repassa `template_values` como veio, sem mesclar
 * `meta_templates.saved_values`. Template com cabeçalho de imagem sem o link no
 * payload é recusado para todo mundo — então o link salvo entra aqui.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { missingSlots } from "@/lib/channels/meta/build-components";
import { acessoNegadoPelaMeta, falhaDeTemplate, problemaNaContaDoNumero } from "@/lib/channels/meta/erros-para-operador";
import { renderTemplateBody } from "@/lib/channels/meta/render-template";
import { logger } from "@/lib/logger";

import { conferirLinhaDoModelo, type LinhaDoModelo } from "./conferir-template";
import { finalizarValores } from "./template-da-campanha";
import type { FalhaDeTemplateDaCampanha, FalhaQuePausaACampanha } from "./tipos";

/** O pedaço do input da porta de saída que muda em template (o resto é o de sempre). */
export interface EnvioDoTemplate {
  type: "template";
  template_name: string;
  template_language: string;
  template_values: Record<string, string>;
  /** O texto que a pessoa lê — vai para o histórico da conversa e para o contexto da IA. */
  body: string;
}

/**
 * A frase gravada em `last_error_detail` quando faltou valor para UMA pessoa. É
 * prefixo reconhecido por `explicarFalhaDoEnvio` (frase traduzível) e não pausa.
 */
export const FALTAM_VALORES_DA_PESSOA = "Faltam valores do template para esta pessoa";

/**
 * `alcance: "campanha"` = vale para a lista inteira (pausa); `"pessoa"` = só este
 * destinatário não tem como receber (ele falha, a campanha segue).
 */
export type MontagemDoEnvio =
  | { ok: true; envio: EnvioDoTemplate }
  | { ok: false; alcance: "campanha"; falha: FalhaDeTemplateDaCampanha; detalhe: string }
  | { ok: false; alcance: "pessoa"; detalhe: string };

export function montarEnvioDoTemplate(entrada: {
  campanha: {
    templateName: string | null;
    templateLanguage: string | null;
    templateContractHash: string | null;
    /** O mapa de slots da campanha: as chaves que a preparação pode preencher. */
    slotMap: Readonly<Record<string, string>>;
  };
  linha: LinhaDoModelo | null;
  preparados: Readonly<Record<string, string>>;
  nome: string | null;
  quando: { agora: Date; fuso: string };
}): MontagemDoEnvio {
  const name = entrada.campanha.templateName ?? "";
  const language = entrada.campanha.templateLanguage ?? "";
  const alvo = `${name} (${language})`;
  const conferida = conferirLinhaDoModelo(entrada.campanha, entrada.linha);
  if (!conferida.ok) {
    return {
      ok: false,
      alcance: "campanha",
      falha: conferida.estado === "stale" ? "template_mudou" : "template_nao_aprovado",
      detalhe: `${alvo}: ${conferida.estado}`,
    };
  }
  const { linha, contrato, salvos } = conferida;

  // Lacuna de CONTRATO (vale para todos): nem o link salvo nem tudo o que o mapa
  // da campanha pode preencher cobre o slot — link de mídia apagado depois da
  // preparação, ou mapa que não cobre mais o template. Pausa.
  const cobertos: Record<string, string> = { ...salvos };
  for (const chave of Object.keys(entrada.campanha.slotMap)) cobertos[chave] ??= "-";
  const doContrato = missingSlots(contrato, cobertos).map((s) => s.key);
  if (doContrato.length > 0) {
    return {
      ok: false,
      alcance: "campanha",
      falha: "template_mudou",
      detalhe: `${alvo}: faltam valores (${doContrato.join(", ")})`,
    };
  }

  // Lacuna da PESSOA: o valor dela não foi preparado ou não resolveu agora. Só
  // ela não recebe — nunca sai com o slot em branco, e a campanha segue.
  const finais = finalizarValores(entrada.preparados, entrada.nome, entrada.quando);
  const valores = { ...salvos, ...finais.valores };
  const faltando = [...new Set([...missingSlots(contrato, valores).map((s) => s.key), ...finais.faltando])];
  if (faltando.length > 0) {
    return { ok: false, alcance: "pessoa", detalhe: `${FALTAM_VALORES_DA_PESSOA}: ${faltando.join(", ")}`.slice(0, 300) };
  }
  const body = renderTemplateBody(linha.components, valores, {
    name,
    language,
    parameterFormat: contrato.parameterFormat,
  }).trim();
  return {
    ok: true,
    envio: { type: "template", template_name: name, template_language: language, template_values: valores, body: body || name },
  };
}

/**
 * Pausa a campanha sozinha (template, conta do número ou falhas seguidas), em
 * compare-and-set (só quem está `running`). Nunca lança: a rodada não pode cair
 * por uma campanha.
 */
export async function pausarACampanha(
  admin: SupabaseClient,
  campanhaId: string,
  falha: FalhaQuePausaACampanha,
  detalhe: string,
  agora: Date,
): Promise<boolean> {
  const { data, error } = await admin
    .from("campaigns")
    .update({
      status: "paused",
      paused_at: agora.toISOString(),
      failure_code: falha,
      failure_detail: detalhe.slice(0, 500),
    })
    .eq("id", campanhaId)
    .eq("status", "running")
    .select("id");
  if (error) {
    logger.warn("[campanha] pausa automática falhou", { campanha: campanhaId, falha, motivo: error.message });
    return false;
  }
  return (data ?? []).length > 0;
}

/**
 * A falha síncrona do envio vale para a lista inteira (pausa a campanha) ou só
 * para a pessoa (`null`)? Do template ou da CONTA do número (`numero_com_problema`).
 */
export function falhaDoEnvioParaACampanha(codigo: string | null, detalhe: string | null): FalhaQuePausaACampanha | null {
  // Caminho 1 do número oficial: sem autorização ou chave vencida vale para a lista
  // inteira desde a 1ª pessoa — esperar 5 falhas só queimaria mais 4.
  if (acessoNegadoPelaMeta(codigo, detalhe)) return "sem_autorizacao";
  if (problemaNaContaDoNumero(codigo, detalhe)) return "numero_com_problema";
  const falha = falhaDeTemplate(codigo, detalhe);
  if (falha === "template_parado") return "template_nao_aprovado";
  if (falha === "template_desatualizado") return "template_mudou";
  return null;
}
