/**
 * "RECEBE, MAS NÃO TEM AUTORIZAÇÃO PARA MANDAR" (caminho 1 do número oficial, item 4).
 *
 * O vigia (`checkHealth`) pergunta `GET /{phone_number_id}`, que responde mesmo
 * quando todo envio é recusado por permissão — a tela dizia "WORKING". O status da
 * conexão NÃO muda (CHECK de 5 valores, e o envio enfileira o que não está
 * WORKING: pararia até o envio manual que testa se a autorização chegou). Esta
 * leitura olha a última saída que CHEGOU à Meta — as barradas antes dela (modo de
 * teste, resposta automática desligada) não têm código da plataforma e são puladas.
 *
 * Leitura de tela: erro devolve `null` (a tela mostra o status de sempre). Sem
 * índice dedicado em `messages` por conexão; `limit` pequeno e janela de 7 dias,
 * para uma recusa antiga não virar selo eterno.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { codigoDaPlataforma, semAutorizacaoParaMandar } from "./erros-para-operador";

export interface RecusaPorAutorizacao {
  /** O texto guardado: código, subcódigo e fbtrace (o que o suporte da Meta pede). */
  detalhe: string;
  em: string;
}

interface Saida {
  status: string;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
}

const JANELA = 10;
const DIAS = 7;

export async function ultimaRecusaPorAutorizacao(
  admin: SupabaseClient,
  input: { organizationId: string; channelSessionId: string },
): Promise<RecusaPorAutorizacao | null> {
  const desde = new Date(Date.now() - DIAS * 86_400_000).toISOString();
  const { data, error } = await admin
    .from("messages")
    .select("status, error_code, error_message, created_at")
    .eq("organization_id", input.organizationId)
    .eq("channel_session_id", input.channelSessionId)
    .eq("direction", "outbound")
    .in("status", ["sent", "delivered", "read", "failed"])
    .gte("created_at", desde)
    .order("created_at", { ascending: false })
    .limit(JANELA);
  if (error || !data) return null;
  const chegou = (data as Saida[]).find(
    (m) => m.status !== "failed" || codigoDaPlataforma(m.error_code, m.error_message) !== null,
  );
  if (!chegou || chegou.status !== "failed") return null;
  if (!semAutorizacaoParaMandar(chegou.error_code, chegou.error_message)) return null;
  return { detalhe: (chegou.error_message ?? chegou.error_code ?? "").slice(0, 300), em: chegou.created_at };
}
