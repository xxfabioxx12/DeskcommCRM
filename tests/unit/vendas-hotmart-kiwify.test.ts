import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { identificarHotmart, traduzirHotmart } from "@/lib/vendas/plataformas/hotmart";
import { identificarKiwify, traduzirKiwify } from "@/lib/vendas/plataformas/kiwify";
import type { EntregaDaVenda } from "@/lib/vendas/plataformas/tipos";

const fixture = (nome: string) =>
  JSON.parse(readFileSync(join(__dirname, "..", "fixtures", "vendas", `${nome}.json`), "utf8"));

function entrega(payload: Record<string, unknown>): EntregaDaVenda {
  return { payload, corpo: JSON.stringify(payload), cabecalho: () => null, config: {} };
}

describe("Hotmart", () => {
  it("compra aprovada (fixture)", () => {
    const v = traduzirHotmart(entrega(fixture("hotmart_purchase_approved")))!;
    expect(v).toMatchObject({
      evento: "compra.aprovada",
      entidade: "hotmart:HP0001",
      orderBump: false,
      nome: "João Comprador",
      email: "joao@email.com",
      telefone: "+5531999998888",
      produtoId: "4455",
      produto: "Curso Hotmart",
      ofertaCodigo: "of123",
      ofertaNome: "Oferta X",
      valorCentavos: 29790,
      moeda: "BRL",
      pedido: "HP0001",
    });
  });

  it("recorrência > 1 vira assinatura renovada", () => {
    const p = fixture("hotmart_purchase_approved");
    p.data.purchase.recurrence_number = 2;
    expect(traduzirHotmart(entrega(p))!.evento).toBe("assinatura.renovada");
  });

  it("boleto impresso: com pix_code é pix, sem é boleto", () => {
    const p = fixture("hotmart_purchase_approved");
    p.event = "PURCHASE_BILLET_PRINTED";
    expect(traduzirHotmart(entrega(p))!.evento).toBe("compra.pix_gerado");
    p.data.purchase.payment = { type: "BILLET", billet_url: "https://boleto/x" };
    expect(traduzirHotmart(entrega(p))!.evento).toBe("compra.boleto_gerado");
  });

  it("order bump é item secundário", () => {
    const p = fixture("hotmart_purchase_approved");
    p.data.purchase.order_bump = { is_order_bump: true };
    expect(traduzirHotmart(entrega(p))!.orderBump).toBe(true);
  });

  it("carrinho abandonado: telefone com DDI, entidade por e-mail + produto", () => {
    const p = fixture("hotmart_cart_abandonment");
    const v = traduzirHotmart(entrega(p))!;
    expect(v).toMatchObject({ evento: "carrinho.abandonado", telefone: "+5531988887777", email: "maria.lead@email.com", produtoId: "4455" });
    expect(v.entidade).toMatch(/^hotmart:cart:[0-9a-f]{40}$/);
    expect(traduzirHotmart(entrega({ ...p, id: "outro-id" }))!.entidade).toBe(v.entidade);
  });

  it("cancelamento de assinatura", () => {
    const v = traduzirHotmart(
      entrega({
        id: "hm-sub-1",
        event: "SUBSCRIPTION_CANCELLATION",
        data: {
          subscriber: { code: "SUB9", name: "Rui Assinante", email: "Rui@Email.com", phone: { dddCell: "21", cell: "988887777" } },
          subscription: { id: 777 },
          product: { id: 4455, name: "Clube" },
          actual_recurrence_value: 49.9,
        },
      }),
    )!;
    expect(v).toMatchObject({ evento: "assinatura.cancelada", entidade: "hotmart:sub:777", telefone: "+5521988887777", email: "rui@email.com", valorCentavos: 4990 });
  });

  it("evento desconhecido é ignorado, inclusive nome de protótipo", () => {
    expect(traduzirHotmart(entrega({ event: "PURCHASE_PROTEST", data: {} }))).toBeNull();
    expect(traduzirHotmart(entrega({ event: "constructor", data: {} }))).toBeNull();
  });

  it("identificação: a chave é o id; sem id, sha256 do corpo", () => {
    const p = fixture("hotmart_purchase_approved");
    expect(identificarHotmart(entrega(p))).toEqual({ chave: "hm-evt-0001", eventoOriginal: "PURCHASE_APPROVED", teste: false });
    delete p.id;
    expect(identificarHotmart(entrega(p)).chave).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("Kiwify", () => {
  it("compra aprovada: dinheiro já em centavos (fixture)", () => {
    const v = traduzirKiwify(entrega(fixture("kiwify_order_approved")))!;
    expect(v).toMatchObject({
      evento: "compra.aprovada",
      entidade: "kiwify:kw-0001-uuid",
      valorCentavos: 19700,
      telefone: "+5541999997777",
      email: "ana@email.com",
      nome: "Ana Cliente",
      produtoId: "prod-uuid-1",
      produto: "Curso Kiwify",
      ofertaCodigo: "Xy12Ab",
      pedido: "AbCdE",
    });
  });

  it("pix gerado", () => {
    const p = fixture("kiwify_order_approved");
    p.webhook_event_type = "pix_created";
    expect(traduzirKiwify(entrega(p))!.evento).toBe("compra.pix_gerado");
  });

  it("carrinho = sem webhook_event_type, order_id nem order_status (fixture)", () => {
    const v = traduzirKiwify(entrega(fixture("kiwify_cart_abandonment")))!;
    expect(v).toMatchObject({
      evento: "carrinho.abandonado",
      telefone: "+5541988885555",
      email: "leo.lead@email.com",
      checkoutUrl: "https://pay.kiwify.com.br/abc123",
      produto: "Curso Kiwify",
    });
    expect(v.entidade).toMatch(/^kiwify:cart:[0-9a-f]{40}$/);
  });

  it("tipo desconhecido é ignorado", () => {
    expect(traduzirKiwify(entrega({ webhook_event_type: "order_paused", order_id: "x" }))).toBeNull();
  });

  it("identificação: sem id de evento, a chave é o sha256 do corpo cru", () => {
    const pedido = entrega(fixture("kiwify_order_approved"));
    expect(identificarKiwify(pedido).eventoOriginal).toBe("order_approved");
    expect(identificarKiwify(pedido).chave).toMatch(/^[0-9a-f]{64}$/);
    expect(identificarKiwify(entrega(fixture("kiwify_cart_abandonment"))).eventoOriginal).toBe("carrinho_abandonado");
  });
});
