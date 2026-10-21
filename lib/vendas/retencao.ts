/**
 * Os dados da pessoa nas vendas (payload cru, `venda`, e-mail, telefone) saem em
 * 30 dias (spec §1 "payload guardado com prazo de limpeza"; Divergência D11). A
 * linha fica — evento, produto, pedido e desfecho continuam na tela. Quem limpa
 * é `fn_vendas_limpar_dados_vencidos` (fork 9003), em lotes, pela ponta mais velha.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export const DIAS_DOS_DADOS_DA_VENDA = 30;

export async function limparDadosDasVendas(admin: SupabaseClient, lote: number): Promise<number> {
  const { data, error } = await admin.rpc("fn_vendas_limpar_dados_vencidos", {
    p_dias: DIAS_DOS_DADOS_DA_VENDA,
    p_lote: lote,
  });
  if (error) throw new Error(`sales_events: ${error.message}`);
  return typeof data === "number" ? data : Number(data ?? 0);
}
