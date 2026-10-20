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
import { falhaDeTemplate } from "@/lib/channels/meta/erros-para-operador";
import { renderTemplateBody } from "@/lib/channels/meta/render-template";
import { logger } from "@/lib/logger";

import { conferirLinhaDoModelo, type LinhaDoModelo } from "./conferir-template";
import { finalizarValores } from "./template-da-campanha";
import type { FalhaDeTemplateDaCampanha } from "./tipos";

/** O pedaço do input da porta de saída que muda em template (o resto é o de sempre). */
export interface EnvioDoTemplate {
  type: "template";
  template_name: string;
  template_language: string;
  template_values: Record<string, string>;
  /** O texto que a pessoa lê — vai para o histórico da conversa e para o contexto da IA. */
  body: string;
}

export type MontagemDoEnvio =
  | { ok: true; envio: EnvioDoTemplate }
  | { ok: false; falha: FalhaDeTemplateDaCampanha; detalhe: string };

export function montarEnvioDoTemplate(entrada: {
  campanha: { templateName: string | null; templateLanguage: string | null; templateContractHash: string | null };
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
      falha: conferida.estado === "stale" ? "template_mudou" : "template_nao_aprovado",
      detalhe: `${alvo}: ${conferida.estado}`,
    };
  }
  const { linha, contrato, salvos } = conferida;

  const finais = finalizarValores(entrada.preparados, entrada.nome, entrada.quando);
  const valores = { ...salvos, ...finais.valores };
  const faltando = [...missingSlots(contrato, valores).map((s) => s.key), ...finais.faltando];
  if (faltando.length > 0) {
    return { ok: false, falha: "template_mudou", detalhe: `${alvo}: faltam valores (${faltando.join(", ")})` };
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
 * Pausa a campanha por causa do template, em compare-and-set (só quem está
 * `running`). Nunca lança: a rodada não pode cair por uma campanha.
 */
export async function pausarPorTemplate(
  admin: SupabaseClient,
  campanhaId: string,
  falha: FalhaDeTemplateDaCampanha,
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
    logger.warn("[campanha] pausa por template falhou", { campanha: campanhaId, motivo: error.message });
    return false;
  }
  return (data ?? []).length > 0;
}

/** A falha síncrona do envio é do TEMPLATE (pausa a campanha) ou da pessoa (`null`)? */
export function falhaDoEnvioParaACampanha(codigo: string | null, detalhe: string | null): FalhaDeTemplateDaCampanha | null {
  const falha = falhaDeTemplate(codigo, detalhe);
  if (falha === "template_parado") return "template_nao_aprovado";
  if (falha === "template_desatualizado") return "template_mudou";
  return null;
}
