import { randomUUID } from "node:crypto";

import type { VendaTraduzida } from "../eventos";
import { telefoneE164 } from "../telefone";
import { emailNormalizado, objeto, reaisEmCentavos, texto, verdadeiroDoPhp } from "../valores";
import { doMapa, sha256, type EntregaDaVenda, type Identificacao } from "./tipos";

const MAPA: Readonly<Record<string, string>> = {
  "venda.aprovada": "compra.aprovada",
  "venda.completa": "compra.completa",
  "venda.recusada": "compra.recusada",
  "venda.cancelada": "compra.cancelada",
  "venda.reembolsada": "compra.reembolsada",
  "venda.chargeback": "compra.chargeback",
  "venda.expirada": "compra.expirada",
  // Produto gratuito: a Kookie remapeia venda.aprovada para este evento.
  "acesso_gratis.liberado": "compra.aprovada",
  "assinatura.renovada": "assinatura.renovada",
  // Documentado mas nunca enviado; o que chega é suspensa/expirada (confirmado no integrador em 2026-08-17).
  "assinatura.pagamento_atrasado": "assinatura.atrasada",
  "assinatura.suspensa": "assinatura.atrasada",
  "assinatura.cancelada": "assinatura.cancelada",
  "assinatura.expirada": "assinatura.cancelada",
};

export function identificarKookie(e: EntregaDaVenda): Identificacao {
  const chave = e.cabecalho("x-webhook-event-id") ?? texto(e.payload.event_id) ?? sha256(e.corpo);
  const original = e.cabecalho("x-webhook-event") ?? texto(e.payload.evento) ?? "desconhecido";
  return { chave: chave.slice(0, 128), eventoOriginal: original.slice(0, 100), teste: verdadeiroDoPhp(e.payload.test) };
}

export function traduzirKookie(e: EntregaDaVenda, chave: string): VendaTraduzida | null {
  const evento = texto(e.payload.evento) ?? e.cabecalho("x-webhook-event");
  const data = objeto(e.payload.data);
  if (evento === "checkout.abandonado") return checkout(data, chave);
  if (evento === "venda.criada") {
    // A Kookie não tem evento de pix/boleto gerado: o sinal é venda.criada aguardando pagamento.
    const venda = objeto(data.venda);
    if (venda.status !== "aguardando_pagamento") return null;
    const canonico =
      venda.metodo_pagamento === "pix" ? "compra.pix_gerado" : venda.metodo_pagamento === "boleto" ? "compra.boleto_gerado" : null;
    return canonico ? vendaDaKookie(canonico, data, chave) : null;
  }
  const canonico = doMapa(MAPA, evento);
  if (!canonico) return null;
  return evento?.startsWith("assinatura.") ? assinatura(canonico, data) : vendaDaKookie(canonico, data, chave);
}

function vendaDaKookie(evento: string, data: Record<string, unknown>, chave: string): VendaTraduzida {
  const venda = objeto(data.venda);
  const cliente = objeto(data.cliente);
  const produto = objeto(data.produto);
  const oferta = objeto(data.oferta);
  return {
    evento,
    entidade: `venda:${texto(venda.id) ?? texto(venda.codigo_venda) ?? chave}`,
    // Order bump/upsell viram linhas de venda separadas na Kookie.
    orderBump: (texto(venda.tipo_venda) ?? "principal") !== "principal",
    nome: texto(cliente.nome),
    email: emailNormalizado(cliente.email),
    telefone: telefoneE164(texto(cliente.telefone)),
    produtoId: texto(produto.id),
    produto: texto(produto.nome),
    ofertaCodigo: texto(oferta.codigo),
    ofertaNome: texto(oferta.nome),
    valorCentavos: reaisEmCentavos(venda.valor_pago ?? venda.valor_final),
    moeda: texto(objeto(data.comissoes).moeda) ?? "BRL",
    checkoutUrl: null,
    pedido: texto(venda.codigo_venda),
    extras: {},
  };
}

function checkout(data: Record<string, unknown>, chave: string): VendaTraduzida {
  const lead = objeto(data.lead);
  const produto = objeto(data.produto);
  return {
    evento: "carrinho.abandonado",
    entidade: `lead:${texto(lead.id) ?? chave}`,
    orderBump: false,
    nome: texto(lead.nome),
    email: emailNormalizado(lead.email),
    // Telefone de lead NÃO vem normalizado da Kookie.
    telefone: telefoneE164(texto(lead.telefone)),
    produtoId: texto(produto.id),
    produto: texto(produto.nome),
    ofertaCodigo: null,
    ofertaNome: null,
    valorCentavos: produto.preco != null ? reaisEmCentavos(produto.preco) : null,
    moeda: "BRL",
    checkoutUrl: texto(data.checkout_url),
    pedido: null,
    extras: {},
  };
}

function assinatura(evento: string, data: Record<string, unknown>): VendaTraduzida {
  const a = objeto(data.assinatura);
  const cliente = objeto(data.cliente);
  const produto = objeto(data.produto);
  const oferta = objeto(data.oferta);
  return {
    evento,
    entidade: `assinatura:${texto(a.id) ?? randomUUID()}:${texto(a.ciclo) ?? evento}`,
    orderBump: false,
    nome: texto(cliente.nome),
    email: emailNormalizado(cliente.email),
    // Eventos de assinatura da Kookie NÃO trazem telefone: o contato resolve pelo e-mail.
    telefone: null,
    produtoId: texto(produto.id),
    produto: texto(produto.nome),
    ofertaCodigo: texto(oferta.codigo),
    ofertaNome: texto(oferta.nome),
    valorCentavos: a.valor != null ? reaisEmCentavos(a.valor) : null,
    moeda: "BRL",
    checkoutUrl: null,
    pedido: texto(objeto(data.venda).codigo_venda),
    extras: {},
  };
}
