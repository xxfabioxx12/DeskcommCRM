import type { VendaTraduzida } from "../eventos";
import { telefoneE164 } from "../telefone";
import { emailNormalizado, objeto, texto } from "../valores";
import { doMapa, sha1, sha256, type EntregaDaVenda, type Identificacao } from "./tipos";

const MAPA: Readonly<Record<string, string>> = {
  order_approved: "compra.aprovada",
  pix_created: "compra.pix_gerado",
  billet_created: "compra.boleto_gerado",
  order_rejected: "compra.recusada",
  order_refunded: "compra.reembolsada",
  chargeback: "compra.chargeback",
  subscription_renewed: "assinatura.renovada",
  subscription_late: "assinatura.atrasada",
  subscription_canceled: "assinatura.cancelada",
};

/** Carrinho abandonado da Kiwify NÃO traz webhook_event_type, order_id nem order_status. */
function ehCarrinho(p: Record<string, unknown>): boolean {
  return p.webhook_event_type == null && p.order_id == null && p.order_status == null;
}

export function identificarKiwify(e: EntregaDaVenda): Identificacao {
  // A Kiwify não manda id de evento: o hash do corpo cru deduplica as reentregas.
  const original = texto(e.payload.webhook_event_type) ?? (e.payload.order_id != null ? "order" : "carrinho_abandonado");
  return { chave: sha256(e.corpo), eventoOriginal: original.slice(0, 100), teste: false };
}

export function traduzirKiwify(e: EntregaDaVenda): VendaTraduzida | null {
  if (ehCarrinho(e.payload)) return carrinho(e.payload);
  const canonico = doMapa(MAPA, texto(e.payload.webhook_event_type));
  return canonico ? pedido(canonico, e.payload) : null;
}

function pedido(evento: string, p: Record<string, unknown>): VendaTraduzida {
  const cliente = objeto(p.Customer);
  const produto = objeto(p.Product);
  const comissoes = objeto(p.Commissions);
  // Dinheiro da Kiwify já vem em CENTAVOS (às vezes como texto).
  const bruto = comissoes.charge_amount;
  const centavos = bruto != null && bruto !== "" && Number.isFinite(Number(bruto)) ? Math.trunc(Number(bruto)) : null;
  return {
    evento,
    entidade: `kiwify:${texto(p.order_id) ?? sha256(JSON.stringify(p))}`,
    orderBump: false,
    nome: texto(cliente.full_name) ?? texto(cliente.first_name),
    email: emailNormalizado(cliente.email),
    telefone: telefoneE164(texto(cliente.mobile)),
    produtoId: texto(produto.product_id),
    produto: texto(produto.product_name),
    ofertaCodigo: texto(p.checkout_link),
    ofertaNome: null,
    valorCentavos: centavos,
    moeda: texto(comissoes.currency) ?? "BRL",
    checkoutUrl: null,
    pedido: texto(p.order_ref) ?? texto(p.order_id),
    extras: {},
  };
}

/** Forma NÃO documentada pela Kiwify — leitura defensiva das chaves relatadas por integradores. */
function carrinho(p: Record<string, unknown>): VendaTraduzida {
  const cliente = p.Customer != null ? objeto(p.Customer) : p.customer != null ? objeto(p.customer) : p;
  const email = emailNormalizado(cliente.email ?? p.email);
  const telefone = cliente.mobile ?? cliente.phone ?? p.phone ?? p.cellphone;
  const produtoNome = texto(p.product_name) ?? texto(objeto(p.Product).product_name) ?? texto(p.product);
  const produtoId = texto(p.product_id) ?? texto(objeto(p.Product).product_id);
  return {
    evento: "carrinho.abandonado",
    entidade: `kiwify:cart:${sha1(`${email ?? "?"}|${produtoId ?? produtoNome ?? "?"}`)}`,
    orderBump: false,
    nome: texto(cliente.full_name) ?? texto(cliente.name) ?? texto(p.name),
    email,
    telefone: typeof telefone === "string" ? telefoneE164(telefone) : null,
    produtoId,
    produto: produtoNome,
    ofertaCodigo: null,
    ofertaNome: null,
    valorCentavos: null,
    moeda: "BRL",
    checkoutUrl: texto(p.checkout_link) ?? texto(p.cart_link) ?? texto(p.link),
    pedido: null,
    extras: {},
  };
}
