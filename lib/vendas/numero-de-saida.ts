/**
 * Número de saída por rodízio (spec Parte 2 §4). Quando o gatilho de venda
 * inicia um fluxo para um contato SEM conversa, a conversa nasce no número de
 * maior folga entre os marcados na conexão — `escolherNumero` + `lerNumero`
 * da campanha, a mesma régua do "Falar também por estes números".
 *
 * Contato que já conversa com a empresa segue no número da conversa (o padrão
 * do `fn_service_observe_command`). Nenhum número marcado = como hoje.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Queryable } from "@/lib/agent-engine/queue/queue";
import { lerNumero, type LeituraDoNumero } from "@/lib/campanhas/numero-disponivel";
import { escolherNumero, type NumeroDisponivel } from "@/lib/campanhas/rodizio";

export type SaidaDaVenda = { tipo: "como_hoje" } | { tipo: "numero"; sessionId: string } | { tipo: "nenhum_livre" };

/** Os números de saída que a conexão mandou no payload do gatilho (Tarefa 9): só textos, sem repetir. */
export function numerosDeSaidaDoEvento(payload: Readonly<Record<string, unknown>>): string[] {
  const lista = payload.numeros_de_saida;
  if (!Array.isArray(lista)) return [];
  return [...new Set(lista.filter((v): v is string => typeof v === "string" && v !== ""))];
}

/**
 * Para ABRIR a conversa contam: no ar (`lerNumero` já tira o fora do ar), folga
 * no teto do dia e aquecimento não estourado. A janela e o intervalo entre
 * envios são do passo que envia, que já adia sozinho. Divergência D16 + F3:
 * sem isto, a venda das 23h não iniciaria fluxo nenhum.
 */
export function livreParaOFluxo(l: Pick<LeituraDoNumero, "numero" | "aquecimentoEstourado">): NumeroDisponivel {
  // shortcut: teto e aquecimento contam o `sentToday` de HOJE (à noite o envio real é amanhã, contagem zerada); trocar pela conta do dia do envio se vendas fora da janela começarem a cair em sem_numero_de_saida_livre.
  const n = l.numero;
  return { ...n, podeAgora: !l.aquecimentoEstourado && (n.folgaDoDia === null || n.folgaDoDia > 0) };
}

export async function saidaDaVenda(deps: {
  admin: SupabaseClient;
  pool: () => Queryable;
  organizationId: string;
  contactId: string;
  numeros: readonly string[];
  agora: Date;
}): Promise<SaidaDaVenda> {
  if (deps.numeros.length === 0) return { tipo: "como_hoje" };

  const { data, error } = await deps.admin
    .from("conversations")
    .select("id")
    .eq("organization_id", deps.organizationId)
    .eq("contact_id", deps.contactId)
    .eq("is_group", false)
    .limit(1);
  if (error) throw new Error(`conversations: ${error.message}`);
  if ((data ?? []).length > 0) return { tipo: "como_hoje" };

  const pool = deps.pool();
  const disponiveis: NumeroDisponivel[] = [];
  for (const sessionId of deps.numeros) {
    const leitura = await lerNumero(deps.admin, pool, deps.organizationId, sessionId, deps.agora);
    if (leitura) disponiveis.push(livreParaOFluxo(leitura));
  }
  const escolha = escolherNumero(disponiveis, null);
  return escolha ? { tipo: "numero", sessionId: escolha.sessionId } : { tipo: "nenhum_livre" };
}
