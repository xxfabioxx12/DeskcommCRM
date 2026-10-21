/**
 * Ação `set_field` — grava UMA chave de campo personalizado no contato ou no
 * card (Parte 1 do motor de fluxo; no ManyChat é "Set Custom Field").
 *
 * O `valor` aceita o vocabulário da campanha (`renderizar`): `{{nome}}`,
 * `{{primeiro_nome}}`, `{{saudacao}}`, `{{contato.x}}`, `{{lead.x}}`. Variável
 * sem valor FALHA com `falta o dado: …` e não grava nada — gravar texto pela
 * metade é pior que não gravar. A escrita é atômica e só daquela chave
 * (`fn_contato_anotar_campos` da 9002 / `fn_lead_anotar_campos` da 0502).
 *
 * Destino `card` sem card é ignorado: campo é dado do negócio, e cair no
 * contato misturaria as fontes (Divergência D1 do plano).
 */
import { registerAction } from "@/lib/automation/actions";
import { fusoDaOrganizacao } from "@/lib/automation/cron-de-data";
import { alvoDaEscrita, anotarCampo, campoValido, destinoDe } from "@/lib/automation/etiquetas-e-campos";
import type { ActionCtx, ActionResultDetail } from "@/lib/automation/types";
import { renderizarValorDoCampo } from "@/lib/campanhas/valores-do-contexto";

const TIPO = "set_field";
const USA_SAUDACAO = /\{\{\s*saudacao\s*\}\}/i;

async function fusoDaOrg(ctx: ActionCtx): Promise<string> {
  const { data } = await ctx.admin
    .from("organizations")
    .select("timezone")
    .eq("id", ctx.organizationId)
    .maybeSingle();
  return fusoDaOrganizacao((data as { timezone?: string | null } | null)?.timezone);
}

async function execute(ctx: ActionCtx, config: Record<string, unknown>): Promise<ActionResultDetail> {
  const destino = destinoDe(config.destino);
  const campo = typeof config.campo === "string" ? config.campo.trim() : "";
  const valor = typeof config.valor === "string" ? config.valor : "";
  if (!campoValido(campo) || valor.trim() === "") {
    return { type: TIPO, status: "skipped", detail: { reason: "missing_config" } };
  }
  const semAlvo = { type: TIPO, status: "skipped" as const, detail: { reason: destino === "contato" ? "no_contact" : "no_lead" } };
  const alvo = alvoDaEscrita(ctx.context, destino, { cardSemNegocioUsaContato: false });
  if (!alvo) return semAlvo;

  // O fuso só é lido quando o valor pede a saudação: as outras variáveis não
  // dependem da hora, e uma leitura a mais por execução não compraria nada.
  const fuso = USA_SAUDACAO.test(valor) ? await fusoDaOrg(ctx) : fusoDaOrganizacao(null);
  const renderizado = renderizarValorDoCampo(valor, ctx.context, { agora: new Date(), fuso });
  if (!renderizado.ok) {
    return { type: TIPO, status: "failed", error: `falta o dado: ${renderizado.faltando.join(", ")}` };
  }

  const gravado = await anotarCampo(ctx.admin, { organizationId: ctx.organizationId, alvo, campo, valor: renderizado.valor });
  if (!gravado.ok) return gravado.motivo === "sem_linha" ? semAlvo : { type: TIPO, status: "failed", error: gravado.erro };
  return { type: TIPO, status: "success", detail: { destino, campo } };
}

registerAction({ type: TIPO, execute });
