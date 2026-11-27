import { randomUUID } from "node:crypto";

import type { VendaTraduzida } from "../eventos";
import { telefoneDeDddENumero, telefoneE164 } from "../telefone";
import { emailNormalizado, objeto, reaisEmCentavos, texto, verdadeiroDoPhp } from "../valores";
import { doMapa, sha1, sha256, type EntregaDaVenda, type Identificacao } from "./tipos";

const MAPA: Readonly<Record<string, string>> = {
  PURCHASE_COMPLETE: "compra.completa",
  PURCHASE_CANCELED: "compra.cancelada",
  PURCHASE_REFUNDED: "compra.reembolsada",
  PURCHASE_CHARGEBACK: "compra.chargeback",
  PURCHASE_EXPIRED: "compra.expirada",
  PURCHASE_DELAYED: "assinatura.atrasada",
};

export function identificarHotmart(e: EntregaDaVenda): Identificacao {
  return {
    chave: (texto(e.payload.id) ?? sha256(e.corpo)).slice(0, 128),
    eventoOriginal: (texto(e.payload.event) ?? "desconhecido").slice(0, 100),
    teste: false,
  };
}

export function traduzirHotmart(e: EntregaDaVenda): VendaTraduzida | null {
  const evento = texto(e.payload.event);
  const data = objeto(e.payload.data);
  if (evento === "PURCHASE_OUT_OF_SHOPPING_CART") return carrinho(data);
  if (evento === "SUBSCRIPTION_CANCELLATION") return cancelamentoDeAssinatura(data);
  const purchase = objeto(data.purchase);
  if (evento === "PURCHASE_APPROVED") {
    // Renovação de assinatura chega como PURCHASE_APPROVED com recurrence_number > 1.
    const recorrencia = Number(purchase.recurrence_number ?? 1);
    return compra(recorrencia > 1 ? "assinatura.renovada" : "compra.aprovada", data);
  }
  if (evento === "PURCHASE_BILLET_PRINTED") {
    // Um evento só para "aguardando pagamento": pix_code presente = Pix.
    return compra(texto(objeto(purchase.payment).pix_code) ? "compra.pix_gerado" : "compra.boleto_gerado", data);
  }
  const canonico = doMapa(MAPA, evento);
  return canonico ? compra(canonico, data) : null;
}

function compra(evento: string, data: Record<string, unknown>): VendaTraduzida {
  const buyer = objeto(data.buyer);
  const purchase = objeto(data.purchase);
  const produto = objeto(data.product);
  const oferta = objeto(purchase.offer);
  const preco = objeto(purchase.price);
  // BR: DDD em checkout_phone_code + número sem DDI; internacional pode embutir o DDI.
  const regiao = (texto(objeto(purchase.checkout_country).iso) ?? texto(objeto(buyer.address).country_iso) ?? "BR").toUpperCase();
  const transacao = texto(purchase.transaction);
  return {
    evento,
    entidade: `hotmart:${transacao ?? sha256(JSON.stringify(purchase))}`,
    orderBump: verdadeiroDoPhp(objeto(purchase.order_bump).is_order_bump),
    nome: texto(buyer.name),
    email: emailNormalizado(buyer.email),
    telefone: telefoneDeDddENumero(buyer.checkout_phone_code, buyer.checkout_phone, regiao),
    produtoId: texto(produto.id),
    produto: texto(produto.name),
    ofertaCodigo: texto(oferta.code),
    ofertaNome: texto(oferta.name),
    valorCentavos: reaisEmCentavos(preco.value),
    moeda: texto(preco.currency_value) ?? "BRL",
    checkoutUrl: null,
    pedido: transacao,
    extras: {},
  };
}

function carrinho(data: Record<string, unknown>): VendaTraduzida {
  const buyer = objeto(data.buyer);
  const produto = objeto(data.product);
  const email = emailNormalizado(buyer.email);
  const produtoId = texto(produto.id);
  return {
    evento: "carrinho.abandonado",
    entidade: `hotmart:cart:${sha1(`${email ?? "?"}|${produtoId ?? "?"}`)}`,
    orderBump: false,
    nome: texto(buyer.name),
    email,
    // No abandono o phone já vem COM DDI ("5531999999999").
    telefone: telefoneE164(texto(buyer.phone)),
    produtoId,
    produto: texto(produto.name),
    ofertaCodigo: texto(objeto(data.offer).code),
    ofertaNome: null,
    valorCentavos: null,
    moeda: "BRL",
    checkoutUrl: null,
    pedido: null,
    extras: {},
  };
}

function cancelamentoDeAssinatura(data: Record<string, unknown>): VendaTraduzida {
  const assinante = objeto(data.subscriber);
  const fone = objeto(assinante.phone);
  const produto = objeto(data.product);
  return {
    evento: "assinatura.cancelada",
    entidade: `hotmart:sub:${texto(objeto(data.subscription).id) ?? texto(assinante.code) ?? randomUUID()}`,
    orderBump: false,
    nome: texto(assinante.name),
    email: emailNormalizado(assinante.email),
    telefone: telefoneDeDddENumero(fone.dddCell, fone.cell) ?? telefoneDeDddENumero(fone.dddPhone, fone.phone),
    produtoId: texto(produto.id),
    produto: texto(produto.name),
    ofertaCodigo: null,
    ofertaNome: null,
    valorCentavos: reaisEmCentavos(data.actual_recurrence_value),
    moeda: "BRL",
    checkoutUrl: null,
    pedido: null,
    extras: {},
  };
}
