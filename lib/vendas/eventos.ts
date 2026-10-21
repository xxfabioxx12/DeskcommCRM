/**
 * O vocabulário da entrada das vendas (Parte 2 da migração do ManyChat): as
 * plataformas, o evento padrão, os estados de um evento de venda e os campos de
 * `{{venda.*}}`. Porte de `app/Support/CanonicalEvents.php` do integrador.
 *
 * Sem dependência de servidor: a tela, o schema das regras e o renderizador
 * importam daqui.
 */

/** O gatilho das Automações emitido quando uma venda chega e o contato existe. */
export const GATILHO_DA_VENDA = "sale.received";

export const PLATAFORMAS_DE_VENDA = ["hotmart", "kiwify", "kookie", "personalizada"] as const;
export type PlataformaDeVenda = (typeof PLATAFORMAS_DE_VENDA)[number];

export const EVENTOS_DA_VENDA = [
  "compra.aprovada",
  "compra.completa",
  "compra.recusada",
  "compra.cancelada",
  "compra.expirada",
  "compra.reembolsada",
  "compra.chargeback",
  "compra.pix_gerado",
  "compra.boleto_gerado",
  "carrinho.abandonado",
  "assinatura.renovada",
  "assinatura.atrasada",
  "assinatura.cancelada",
  "acesso.criado",
] as const;
export type EventoDaVenda = (typeof EVENTOS_DA_VENDA)[number];

/** Recuperação: não roda regra se a pessoa já comprou (`CanonicalEvents::SUPRIMIVEIS`). */
export const EVENTOS_DE_RECUPERACAO: readonly string[] = [
  "compra.pix_gerado",
  "compra.boleto_gerado",
  "carrinho.abandonado",
];

/** Cadastro sem compra numa conexão personalizada (`CanonicalEvents::LEAD_CAPTURADO`, Divergência D9). */
export const EVENTO_LEAD_CAPTURADO = "lead.capturado";

/** `CanonicalEvents::REGEX_CUSTOM`: eventos livres da personalizada. */
const EVENTO_LIVRE = /^(custom|acesso)\.[a-z0-9_.-]+$/;

export function eventoValido(evento: string, plataforma: PlataformaDeVenda): boolean {
  if ((EVENTOS_DA_VENDA as readonly string[]).includes(evento)) return true;
  return plataforma === "personalizada" && (evento === EVENTO_LEAD_CAPTURADO || EVENTO_LIVRE.test(evento));
}

/** O evento que o filtro de uma regra aceita: o padrão ou um livre da personalizada. */
export function eventoDoFiltroValido(evento: string): boolean {
  return eventoValido(evento, "personalizada");
}

export const STATUS_DO_EVENTO_DE_VENDA = ["recebido", "ignorado", "sem_contato", "processado", "falhou", "recusado"] as const;
export type StatusDoEventoDeVenda = (typeof STATUS_DO_EVENTO_DE_VENDA)[number];

/** `{{venda.x}}` fixos (spec §2 "Dados da venda"). `extra.<nome>` e `payload.<caminho>` são abertos. */
export const CAMPOS_DA_VENDA = [
  "nome",
  "primeiro_nome",
  "email",
  "telefone",
  "produto_id",
  "produto",
  "oferta",
  "valor",
  "moeda",
  "pedido",
  "evento",
  "plataforma",
  "checkout_url",
  "order_bump",
] as const;

export function ehPlataformaDeVenda(valor: unknown): valor is PlataformaDeVenda {
  return typeof valor === "string" && (PLATAFORMAS_DE_VENDA as readonly string[]).includes(valor);
}

export function ehEventoPadrao(valor: unknown): valor is EventoDaVenda {
  return typeof valor === "string" && (EVENTOS_DA_VENDA as readonly string[]).includes(valor);
}

export const ROTULO_DA_PLATAFORMA: Record<PlataformaDeVenda, string> = {
  hotmart: "Hotmart",
  kiwify: "Kiwify",
  kookie: "Kookie",
  personalizada: "Personalizada",
};

export const ROTULO_DO_EVENTO: Record<EventoDaVenda, string> = {
  "compra.aprovada": "Compra aprovada",
  "compra.completa": "Compra completa (garantia encerrada)",
  "compra.recusada": "Compra recusada",
  "compra.cancelada": "Compra cancelada",
  "compra.expirada": "Compra expirada",
  "compra.reembolsada": "Compra reembolsada",
  "compra.chargeback": "Chargeback",
  "compra.pix_gerado": "Pix gerado",
  "compra.boleto_gerado": "Boleto gerado",
  "carrinho.abandonado": "Carrinho abandonado",
  "assinatura.renovada": "Assinatura renovada",
  "assinatura.atrasada": "Assinatura atrasada",
  "assinatura.cancelada": "Assinatura cancelada",
  "acesso.criado": "Acesso criado",
};

export const ROTULO_DO_STATUS: Record<StatusDoEventoDeVenda, string> = {
  recebido: "Recebido",
  ignorado: "Ignorado",
  sem_contato: "Sem contato",
  processado: "Processado",
  falhou: "Falhou",
  recusado: "Recusado",
};

/** A venda traduzida — o "normalizado" do integrador (`PlatformAdapter.php:15-27`), achatado. */
export interface VendaTraduzida {
  evento: string;
  /** Chave do evento de negócio (pedido, carrinho, assinatura): a "uma vez por pedido" e a supressão. */
  entidade: string;
  orderBump: boolean;
  nome: string | null;
  email: string | null;
  telefone: string | null;
  produtoId: string | null;
  produto: string | null;
  ofertaCodigo: string | null;
  ofertaNome: string | null;
  valorCentavos: number | null;
  moeda: string;
  checkoutUrl: string | null;
  pedido: string | null;
  extras: Record<string, string>;
}
