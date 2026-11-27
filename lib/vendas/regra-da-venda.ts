/**
 * O que o motor de automação faz a mais no gatilho `sale.received`:
 *
 *  - `reservarRegraDaVenda`: a mesma regra roda no máximo UMA vez por (conexão,
 *    pedido/entidade, evento) — proteção 2 da spec, o `DispatchDedupe` do
 *    integrador (`DispatchDestinoJob.php:230-244`). O índice de `sales_rule_runs`
 *    (fork 9003) é a trava; o MESMO evento do log reprocessado passa (worker
 *    derrubado antes de marcar o consumo), como na 0692.
 *  - `regrasQueJaRodaramAVenda`: a mesma pergunta só lendo, para o motor tirar
 *    essas regras ANTES da pré-checagem de adiamento (senão uma reentrega
 *    ficaria "adiada" na Atividade por uma regra que nunca roda).
 *  - `vendaDoEvento`: o contexto `venda` das ações (`{{venda.*}}`): `venda` e o
 *    payload cru da plataforma, lidos da linha de `sales_events` — o payload do
 *    evento não leva dado pessoal (o `event_log` não é podado, D11).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { EventRow } from "@/lib/event-log/dispatcher";
import { logger } from "@/lib/logger";

const texto = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

/** A chave do negócio do evento; `null` = evento que não nasceu de `receberVenda`. */
function chaveDaVenda(row: EventRow): { conexao: string; entidade: string; evento: string } | null {
  const p = row.payload ?? {};
  const conexao = texto(p.conexao_id);
  const entidade = texto(p.entidade);
  const evento = texto(p.evento);
  return conexao && entidade && evento ? { conexao, entidade, evento } : null;
}

export async function reservarRegraDaVenda(admin: SupabaseClient, row: EventRow, ruleId: string): Promise<boolean> {
  const chave = chaveDaVenda(row);
  // Evento sem a chave do negócio não nasce de `receberVenda` (o emit é reservado ao servidor): roda como qualquer outro.
  if (!chave) return true;
  const { conexao, entidade, evento } = chave;

  const { error } = await admin.from("sales_rule_runs").insert({
    organization_id: row.organization_id,
    rule_id: ruleId,
    webhook_source_id: conexao,
    entidade,
    evento,
    event_id: row.id,
  });
  if (!error) return true;
  if (error.code === "23503") return false; // a conexão (ou a regra) foi apagada no meio do caminho
  if (error.code !== "23505") throw new Error(`sales_rule_runs: ${error.message}`);

  const { data, error: erroDaLeitura } = await admin
    .from("sales_rule_runs")
    .select("event_id")
    .eq("rule_id", ruleId)
    .eq("webhook_source_id", conexao)
    .eq("entidade", entidade)
    .eq("evento", evento)
    .maybeSingle();
  // Sem saber de quem é a reserva, pular seria perder a regra para sempre: o dispatcher tenta de novo.
  if (erroDaLeitura) throw new Error(`sales_rule_runs: ${erroDaLeitura.message}`);
  const mesmoEvento = (data as { event_id?: string | null } | null)?.event_id === row.id;
  if (!mesmoEvento) {
    logger.info("[vendas] regra já rodou para este pedido e evento", { ruleId, entidade, evento, eventId: row.id });
  }
  return mesmoEvento;
}

/** As regras que já rodaram este pedido+evento por OUTRO evento do log. Só lê; a trava é a reserva. */
export async function regrasQueJaRodaramAVenda(admin: SupabaseClient, row: EventRow): Promise<Set<string>> {
  const chave = chaveDaVenda(row);
  if (!chave) return new Set();
  const { data, error } = await admin
    .from("sales_rule_runs")
    .select("rule_id, event_id")
    .eq("organization_id", row.organization_id)
    .eq("webhook_source_id", chave.conexao)
    .eq("entidade", chave.entidade)
    .eq("evento", chave.evento);
  if (error) {
    // Sem a leitura, a reserva do laço continua segurando a repetição.
    logger.warn("[vendas] não foi possível ler as regras que já rodaram", { eventId: row.id, error: error.message });
    return new Set();
  }
  const linhas = (data ?? []) as Array<{ rule_id: string; event_id: string | null }>;
  return new Set(linhas.filter((l) => l.event_id !== row.id).map((l) => l.rule_id));
}

export async function vendaDoEvento(admin: SupabaseClient, row: EventRow): Promise<Record<string, unknown>> {
  const id = texto(row.payload?.sales_event_id);
  if (!id) return {};
  const { data, error } = await admin
    .from("sales_events")
    .select("venda, payload")
    .eq("id", id)
    .eq("organization_id", row.organization_id)
    .maybeSingle();
  // Venda ilegível não roda a regra (gravaria `{{venda.*}}` vazio no contato): o dispatcher tenta de novo.
  // Linha ausente ou redigida (sem erro) segue com a venda vazia.
  if (error) throw new Error(`sales_events: ${error.message}`);
  const linha = data as { venda?: unknown; payload?: unknown } | null;
  const venda =
    linha?.venda && typeof linha.venda === "object" && !Array.isArray(linha.venda)
      ? (linha.venda as Record<string, unknown>)
      : {};
  return { ...venda, payload: linha?.payload ?? null };
}
