/**
 * Os filtros da regra "Venda recebida" (`trigger_config` de `sale.received`):
 * conexão, plataforma, produto, evento e "ignorar order bump" — os campos da
 * `DispatchRule` do integrador (`casaCom`, `ignorar_itens_secundarios`). Sem
 * servidor: o schema da regra e a tela importam daqui.
 */
import { z } from "zod";

import { PLATAFORMAS_DE_VENDA, eventoDoFiltroValido } from "./eventos";

export const configDaVendaSchema = z.object({
  conexao_id: z.string().uuid().nullish(),
  plataforma: z.enum(PLATAFORMAS_DE_VENDA).nullish(),
  produto_id: z.string().trim().min(1).max(200).nullish(),
  evento: z.string().max(100).refine(eventoDoFiltroValido).nullish(),
  ignorar_order_bump: z.boolean().optional(),
});
export type ConfigDaVenda = z.infer<typeof configDaVendaSchema>;

/** A venda do evento casa com os filtros da regra? Config torta não casa (falha fechada). */
export function vendaCasaComARegra(payload: Readonly<Record<string, unknown>>, config: unknown): boolean {
  const lida = configDaVendaSchema.safeParse(config ?? {});
  if (!lida.success) return false;
  const c = lida.data;
  if (c.conexao_id && payload.conexao_id !== c.conexao_id) return false;
  if (c.plataforma && payload.plataforma !== c.plataforma) return false;
  if (c.produto_id && String(payload.produto_id ?? "").trim() !== c.produto_id) return false;
  if (c.evento && payload.evento !== c.evento) return false;
  if (c.ignorar_order_bump && payload.order_bump === true) return false;
  return true;
}

/** O que a tela edita. `""` = qualquer. */
export interface ConfigDaVendaNaTela {
  conexao_id: string;
  plataforma: string;
  produto_id: string;
  evento: string;
  ignorar_order_bump: boolean;
}

export const CONFIG_DA_VENDA_VAZIA: ConfigDaVendaNaTela = {
  conexao_id: "",
  plataforma: "",
  produto_id: "",
  evento: "",
  ignorar_order_bump: false,
};

export function configDaVendaNaTela(config: unknown): ConfigDaVendaNaTela {
  const lida = configDaVendaSchema.safeParse(config ?? {});
  if (!lida.success) return CONFIG_DA_VENDA_VAZIA;
  return {
    conexao_id: lida.data.conexao_id ?? "",
    plataforma: lida.data.plataforma ?? "",
    produto_id: lida.data.produto_id ?? "",
    evento: lida.data.evento ?? "",
    ignorar_order_bump: lida.data.ignorar_order_bump === true,
  };
}

export function configDaVendaAoSalvar(tela: ConfigDaVendaNaTela): Record<string, unknown> {
  return {
    conexao_id: tela.conexao_id || null,
    plataforma: tela.plataforma || null,
    produto_id: tela.produto_id.trim() || null,
    evento: tela.evento || null,
    ignorar_order_bump: tela.ignorar_order_bump,
  };
}
