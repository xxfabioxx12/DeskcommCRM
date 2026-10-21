/**
 * Ação `remove_tag` — TIRA etiquetas do contato ou do card (Parte 1 do motor de
 * fluxo; no ManyChat é "Remove Tag").
 *
 * A escrita é a função atômica da migration 9002 (`fn_*_remover_etiquetas`): a
 * lista é refeita DENTRO do `UPDATE`, então duas automações ao mesmo tempo não
 * devolvem a etiqueta que a outra tirou. O destino tem a semântica da `add_tag`
 * (Divergência D1 do plano): `card` é o card, e sem card o contato; `contato` é
 * o contato do card. Tirar NÃO emite evento — o ManyChat só dispara no pôr, e um
 * `tag_removed` sem gatilho que o consuma seria evento à toa.
 */
import { registerAction } from "@/lib/automation/actions";
import {
  MENSAGEM_ETIQUETA_LONGA_DO_CONTATO,
  alvoDaEscrita,
  destinoDe,
  etiquetaLongaDoContato,
  etiquetasDoDestino,
  removerEtiquetas,
} from "@/lib/automation/etiquetas-e-campos";
import type { ActionCtx, ActionResultDetail } from "@/lib/automation/types";

const TIPO = "remove_tag";

/** Motivos literais (a guarda de frases varre literais, não ternários). */
function semAlvo(destino: "card" | "contato"): ActionResultDetail {
  if (destino === "contato") return { type: TIPO, status: "skipped", detail: { reason: "no_contact" } };
  return { type: TIPO, status: "skipped", detail: { reason: "no_target" } };
}

async function execute(ctx: ActionCtx, config: Record<string, unknown>): Promise<ActionResultDetail> {
  const destino = destinoDe(config.destino);
  const cruas = Array.isArray(config.tags) ? config.tags.map(String) : [];
  if (!cruas.length) return { type: TIPO, status: "skipped", detail: { reason: "no_tags" } };

  const alvo = alvoDaEscrita(ctx.context, destino, { cardSemNegocioUsaContato: true });
  if (!alvo) return semAlvo(destino);

  // Regra de etiqueta decidida pela TABELA resolvida (ruling R1): no contato —
  // inclusive quando o destino `card` cai no contato por falta de card — a
  // etiqueta é normalizada e maior que 40 é recusada; no card, como sempre.
  const doContato = alvo.tabela === "contacts";
  if (doContato && etiquetaLongaDoContato(cruas) !== null) {
    return { type: TIPO, status: "failed", error: MENSAGEM_ETIQUETA_LONGA_DO_CONTATO };
  }
  const tags = etiquetasDoDestino(cruas, doContato ? "contato" : "card");
  if (!tags.length) return { type: TIPO, status: "skipped", detail: { reason: "no_tags" } };

  const r = await removerEtiquetas(ctx.admin, { organizationId: ctx.organizationId, alvo, tags });
  if (!r.ok) {
    if (r.motivo === "sem_linha") return semAlvo(destino);
    return { type: TIPO, status: "failed", error: r.erro };
  }
  if (alvo.foto) alvo.foto.tags = r.tags;
  return { type: TIPO, status: "success", detail: { removed: r.removidas } };
}

registerAction({ type: TIPO, execute });
