/**
 * "RESPONDER AUTOMATICAMENTE POR ESTE NÚMERO" (fork 9005, caminho 1 do número oficial).
 *
 * Desligado, a IA, as regras, os follow-ups e os avisos não mandam nada sozinhos
 * pelo número: só sai o que uma PESSOA digita. Existe para a virada do número
 * oficial — a chave liberada na Meta não pode fazer a IA começar a responder
 * cliente junto com o ManyChat sem o Fabio querer.
 *
 * `channel_sessions.responde_sozinho` nulo = padrão do provedor: o oficial nasce
 * (e as conexões oficiais que já existem ficam) desligado; os demais, ligados — o
 * comportamento de antes. Mora em `lib/channels/` porque é aqui que se pode falar
 * o nome do provedor (lint:channels).
 *
 * Campanha NÃO é resposta automática: é ato de quem mandou começar (Divergência D3
 * do plano). O teste da campanha também. Resposta APROVADA por uma pessoa
 * (approved_reply) e o rascunho do assistido também não (ruling F2): contam como
 * ação de pessoa.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { CHANNEL_PROVIDER_META } from "./capabilities";

export const RESPOSTA_AUTOMATICA_DESLIGADA = "resposta_automatica_desligada";
export const FRASE_DA_RESPOSTA_AUTOMATICA_DESLIGADA =
  "Resposta automática desligada neste número: só sai o que alguém digita no Inbox.";

export function respondeSozinho(provider: string | null | undefined, valor: boolean | null | undefined): boolean {
  return typeof valor === "boolean" ? valor : provider !== CHANNEL_PROVIDER_META;
}

export function ehEnvioDeCampanha(actor: { type: string; id?: string }): boolean {
  return actor.type === "webhook_source" && /^campaign(-test)?:/.test(actor.id ?? "");
}

/**
 * O interruptor desta conexão, numa consulta PRÓPRIA e tolerante: é chamada na
 * porta de saída de todos os canais, e uma coluna ausente (imagem nova antes da
 * 9005) ou uma leitura que falha não pode derrubar o envio dos números por QR Code.
 * Na dúvida, o padrão do provedor — que para o oficial é desligado (fecha).
 */
export async function canalRespondeSozinho(
  db: SupabaseClient,
  input: { organizationId: string; channelSessionId: string; provider: string | null | undefined },
): Promise<boolean> {
  try {
    const { data, error } = await db
      .from("channel_sessions")
      .select("responde_sozinho")
      .eq("organization_id", input.organizationId)
      .eq("id", input.channelSessionId)
      .maybeSingle();
    if (error) return respondeSozinho(input.provider, null);
    return respondeSozinho(input.provider, (data as { responde_sozinho?: boolean | null } | null)?.responde_sozinho ?? null);
  } catch {
    return respondeSozinho(input.provider, null);
  }
}
