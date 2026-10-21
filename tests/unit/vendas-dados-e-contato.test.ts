import { describe, expect, it } from "vitest";

import { camposParaCompletar, fraseDaOrigem } from "@/lib/vendas/contato";
import { dadosDaVenda } from "@/lib/vendas/dados-da-venda";
import type { VendaTraduzida } from "@/lib/vendas/eventos";

const VENDA: VendaTraduzida = {
  evento: "compra.aprovada",
  entidade: "hotmart:HP0001",
  orderBump: false,
  nome: "João  Comprador",
  email: "joao@email.com",
  telefone: "+5531999998888",
  produtoId: "4455",
  produto: "Curso Hotmart",
  ofertaCodigo: "of123",
  ofertaNome: "Oferta X",
  valorCentavos: 29790,
  moeda: "BRL",
  checkoutUrl: null,
  pedido: "HP0001",
  extras: { link_magico_de_acesso: "https://area/x" },
};

describe("dadosDaVenda — os {{venda.*}} (Placeholders.php do integrador)", () => {
  it("monta todos os campos", () => {
    expect(dadosDaVenda(VENDA, "hotmart")).toEqual({
      nome: "João  Comprador",
      primeiro_nome: "João",
      email: "joao@email.com",
      telefone: "+5531999998888",
      produto_id: "4455",
      produto: "Curso Hotmart",
      oferta: "Oferta X",
      valor: "297,90",
      moeda: "BRL",
      pedido: "HP0001",
      evento: "compra.aprovada",
      plataforma: "hotmart",
      checkout_url: null,
      order_bump: "não",
      extra: { link_magico_de_acesso: "https://area/x" },
    });
  });

  it("pedido cai na entidade; oferta cai no código; nome vazio fica nulo", () => {
    const d = dadosDaVenda({ ...VENDA, pedido: null, ofertaNome: null, nome: "  ", orderBump: true }, "kiwify");
    expect(d.pedido).toBe("hotmart:HP0001");
    expect(d.oferta).toBe("of123");
    expect(d.nome).toBeNull();
    expect(d.primeiro_nome).toBeNull();
    expect(d.order_bump).toBe("sim");
  });
});

describe("contato: completar sem sobrescrever (spec §2)", () => {
  it("só preenche o que falta", () => {
    expect(camposParaCompletar({ id: "c", name: "Já Tinha", email: null, phone_number: "+5531999998888" }, VENDA)).toEqual({
      email: "joao@email.com",
    });
    expect(camposParaCompletar({ id: "c", name: null, email: "outro@x.com", phone_number: null }, VENDA)).toEqual({
      name: "João  Comprador",
      phone_number: "+5531999998888",
    });
  });

  it("nome que é o próprio telefone ou identificador técnico conta como vazio", () => {
    expect(camposParaCompletar({ id: "c", name: "+5531999998888", email: "a@b.co", phone_number: "+5531999998888" }, VENDA)).toEqual({
      name: "João  Comprador",
    });
    expect(camposParaCompletar({ id: "c", name: "5531999998888@c.us", email: "a@b.co", phone_number: "+5531999998888" }, VENDA)).toEqual({
      name: "João  Comprador",
    });
  });

  it("venda sem nome não apaga nada", () => {
    expect(camposParaCompletar({ id: "c", name: null, email: null, phone_number: null }, { nome: null, email: null, telefone: null })).toEqual({});
  });
});

describe("frase da origem", () => {
  const quando = new Date("2026-10-21T15:00:00Z");

  it("compra", () => {
    expect(fraseDaOrigem(VENDA, "hotmart", quando)).toBe(
      "Comprou Curso Hotmart (Hotmart, pedido HP0001, 21/10/2026) e aceitou receber mensagens no WhatsApp no checkout",
    );
  });

  it("recuperação, sem pedido e sem produto", () => {
    expect(fraseDaOrigem({ ...VENDA, evento: "carrinho.abandonado", pedido: null, produto: null }, "kiwify", quando)).toBe(
      "Iniciou checkout de um produto (Kiwify, 21/10/2026) e aceitou receber mensagens no WhatsApp no checkout",
    );
  });
});
