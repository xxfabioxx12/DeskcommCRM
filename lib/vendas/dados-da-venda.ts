/**
 * Os `{{venda.*}}` de uma venda traduzida — porte de `Placeholders::contexto`
 * (`app/Support/Placeholders.php:15-50` do integrador). Valor em reais com
 * vírgula ("297,90"); pedido cai na entidade; order bump é "sim"/"não".
 * Nulo continua nulo: o renderizador trata como FALTA, nunca texto vazio.
 */
import type { PlataformaDeVenda, VendaTraduzida } from "./eventos";
import { valorEmReais } from "./valores";

export interface DadosDaVenda {
  nome: string | null;
  primeiro_nome: string | null;
  email: string | null;
  telefone: string | null;
  produto_id: string | null;
  produto: string | null;
  oferta: string | null;
  valor: string | null;
  moeda: string;
  pedido: string;
  evento: string;
  plataforma: PlataformaDeVenda;
  checkout_url: string | null;
  order_bump: "sim" | "não";
  extra: Record<string, string>;
}

export function dadosDaVenda(v: VendaTraduzida, plataforma: PlataformaDeVenda): DadosDaVenda {
  const nome = v.nome?.trim() ? v.nome : null;
  return {
    nome,
    primeiro_nome: nome ? (nome.trim().split(/\s+/)[0] ?? null) : null,
    email: v.email,
    telefone: v.telefone,
    produto_id: v.produtoId,
    produto: v.produto,
    oferta: v.ofertaNome ?? v.ofertaCodigo,
    valor: valorEmReais(v.valorCentavos),
    moeda: v.moeda,
    pedido: v.pedido ?? v.entidade,
    evento: v.evento,
    plataforma,
    checkout_url: v.checkoutUrl,
    order_bump: v.orderBump ? "sim" : "não",
    extra: v.extras,
  };
}
