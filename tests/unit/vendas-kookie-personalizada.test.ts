import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { ConfigDaConexao } from "@/lib/vendas/config";
import { identificarEntrega, traduzirVenda } from "@/lib/vendas/plataformas";
import { identificarKookie, traduzirKookie } from "@/lib/vendas/plataformas/kookie";
import { identificarPersonalizada, traduzirPersonalizada } from "@/lib/vendas/plataformas/personalizada";
import type { EntregaDaVenda } from "@/lib/vendas/plataformas/tipos";

const fixture = (nome: string) =>
  JSON.parse(readFileSync(join(__dirname, "..", "fixtures", "vendas", `${nome}.json`), "utf8"));

function entrega(payload: Record<string, unknown>, extra: Partial<EntregaDaVenda> = {}): EntregaDaVenda {
  return { payload, corpo: JSON.stringify(payload), cabecalho: () => null, config: {}, ...extra };
}

describe("Kookie", () => {
  it("venda aprovada (fixture)", () => {
    const v = traduzirKookie(entrega(fixture("kookie_venda_aprovada")), "chave")!;
    expect(v).toMatchObject({
      evento: "compra.aprovada",
      entidade: "venda:4821",
      email: "maria@example.com",
      telefone: "+5511999998888",
      valorCentavos: 19700,
      moeda: "BRL",
      produtoId: "12",
      produto: "Curso X",
      ofertaCodigo: "AB3X9KMQ",
      ofertaNome: "Oferta Padrão",
      pedido: "A1B2C3-D4E5F6",
      orderBump: false,
    });
  });

  it("venda.criada aguardando pix vira pix gerado; já paga é ignorada", () => {
    const p = fixture("kookie_venda_aprovada");
    p.evento = "venda.criada";
    expect(traduzirKookie(entrega(p), "c")).toBeNull();
    p.data.venda.status = "aguardando_pagamento";
    p.data.venda.metodo_pagamento = "pix";
    expect(traduzirKookie(entrega(p), "c")).toMatchObject({ evento: "compra.pix_gerado", entidade: "venda:4821" });
    p.data.venda.metodo_pagamento = "boleto";
    expect(traduzirKookie(entrega(p), "c")!.evento).toBe("compra.boleto_gerado");
  });

  it("checkout abandonado", () => {
    const v = traduzirKookie(
      entrega({
        evento: "checkout.abandonado",
        data: {
          lead: { id: 77, nome: "Lia Lead", email: "Lia@Email.com", telefone: "11 97777-6666" },
          produto: { id: 12, nome: "Curso X", preco: 197.0 },
          checkout_url: "https://pay.kookie.com.br/curso-x?recover=tok",
        },
      }),
      "c",
    )!;
    expect(v).toMatchObject({
      evento: "carrinho.abandonado",
      entidade: "lead:77",
      telefone: "+5511977776666",
      checkoutUrl: "https://pay.kookie.com.br/curso-x?recover=tok",
      valorCentavos: 19700,
    });
  });

  it("assinatura renovada sem telefone; suspensa vira atrasada; expirada vira cancelada", () => {
    const base = {
      data: {
        assinatura: { id: 9, ciclo: 4, valor: 49.9 },
        produto: { id: 12, nome: "Clube X" },
        oferta: { codigo: "AB1", nome: "Mensal" },
        cliente: { nome: "Rui", email: "Rui@Email.com" },
      },
    };
    expect(traduzirKookie(entrega({ ...base, evento: "assinatura.renovada" }), "c")).toMatchObject({
      evento: "assinatura.renovada",
      telefone: null,
      email: "rui@email.com",
      valorCentavos: 4990,
      entidade: "assinatura:9:4",
    });
    expect(traduzirKookie(entrega({ ...base, evento: "assinatura.suspensa" }), "c")!.evento).toBe("assinatura.atrasada");
    expect(traduzirKookie(entrega({ ...base, evento: "assinatura.expirada" }), "c")!.evento).toBe("assinatura.cancelada");
  });

  it("reembolso, grátis, order bump e evento sem mapa", () => {
    const p = fixture("kookie_venda_aprovada");
    p.evento = "venda.reembolsada";
    expect(traduzirKookie(entrega(p), "c")!.evento).toBe("compra.reembolsada");
    p.evento = "acesso_gratis.liberado";
    expect(traduzirKookie(entrega(p), "c")!.evento).toBe("compra.aprovada");
    p.data.venda.tipo_venda = "order_bump";
    expect(traduzirKookie(entrega(p), "c")!.orderBump).toBe(true);
    p.evento = "venda.estranha";
    expect(traduzirKookie(entrega(p), "c")).toBeNull();
  });

  it("sem id de venda, a entidade cai na chave da entrega", () => {
    const p = fixture("kookie_venda_aprovada");
    delete p.data.venda.id;
    delete p.data.venda.codigo_venda;
    expect(traduzirKookie(entrega(p), "chave-da-entrega")!.entidade).toBe("venda:chave-da-entrega");
  });

  it("identificação: cabeçalho de id e de evento vencem o payload; test marca teste", () => {
    const p = { ...fixture("kookie_venda_aprovada"), test: true };
    const cab = new Headers({ "X-Webhook-Event-Id": "evt-cab-1", "X-Webhook-Event": "venda.aprovada" });
    expect(identificarKookie(entrega(p, { cabecalho: (n) => cab.get(n) }))).toEqual({
      chave: "evt-cab-1",
      eventoOriginal: "venda.aprovada",
      teste: true,
    });
    expect(identificarKookie(entrega(fixture("kookie_venda_aprovada"))).chave).toBe("9f6f6a0e-1b2c-4d5e-8f90-a1b2c3d4e5f6");
  });
});

const PAYLOAD_FLIX = {
  id: "evt-flix-0001",
  event: "student.access_granted",
  data: {
    student: {
      name: "Aluno Teste",
      email: "Aluno@Email.com",
      phone: "11988887777",
      magic_link: "https://area.flix.kookie.com.br/magic-login?token=abc123",
    },
    course: { id: 13, title: "Curso Flix" },
  },
};
const MAPA_FLIX: NonNullable<ConfigDaConexao["mapa"]> = {
  evento: { path: "event", map: { "student.access_granted": "acesso.criado" } },
  nome: "data.student.name",
  email: "data.student.email",
  telefone: "data.student.phone",
  entity: "id",
  id_evento: "id",
  produto_id: "data.course.id",
  produto_nome: "data.course.title",
  extras: { link_magico_de_acesso: "data.student.magic_link" },
};
const flix = (payload: Record<string, unknown>, mapa = MAPA_FLIX, regiao?: "BR" | "PT") =>
  entrega(payload, { config: { mapa, ...(regiao ? { telefone_regiao: regiao } : {}) } });

describe("Personalizada (GenericAdapter + MapaCampos do integrador)", () => {
  it("monta a venda inteira pelo mapa (estilo Flix)", () => {
    expect(traduzirPersonalizada(flix(PAYLOAD_FLIX), "c")).toMatchObject({
      evento: "acesso.criado",
      entidade: "custom:evt-flix-0001",
      email: "aluno@email.com",
      telefone: "+5511988887777",
      nome: "Aluno Teste",
      produtoId: "13",
      produto: "Curso Flix",
      pedido: "evt-flix-0001",
      extras: { link_magico_de_acesso: "https://area.flix.kookie.com.br/magic-login?token=abc123" },
    });
  });

  it("id do produto com espaço vem aparado", () => {
    const p = { ...PAYLOAD_FLIX, data: { ...PAYLOAD_FLIX.data, course: { id: "  13  ", title: "Curso Flix" } } };
    expect(traduzirPersonalizada(flix(p), "c")!.produtoId).toBe("13");
  });

  it("evento sem tradução vira custom.<slug>; evento fixo vale para todo envio", () => {
    expect(traduzirPersonalizada(flix({ ...PAYLOAD_FLIX, event: "lesson.completed" }), "c")!.evento).toBe("custom.lesson_completed");
    expect(traduzirPersonalizada(flix(PAYLOAD_FLIX, { evento: { fixo: "acesso.criado" }, email: "data.student.email" }), "c")!.evento).toBe(
      "acesso.criado",
    );
  });

  it("telefone usa a região da conexão; caminho que aponta para objeto é ignorado", () => {
    const v = traduzirPersonalizada(flix(PAYLOAD_FLIX, { evento: { fixo: "acesso.criado" }, telefone: "data.student.phone", nome: "data.student" }), "c")!;
    expect(v.telefone).toBe("+5511988887777");
    expect(v.nome).toBeNull();
    const pt = { ...PAYLOAD_FLIX, data: { ...PAYLOAD_FLIX.data, student: { ...PAYLOAD_FLIX.data.student, phone: "912345678" } } };
    expect(traduzirPersonalizada(flix(pt, MAPA_FLIX, "PT"), "c")!.telefone).toBe("+351912345678");
  });

  it("valor nos dois formatos e moeda fixa", () => {
    const p = { ...PAYLOAD_FLIX, total: "R$ 197,90", cents: 19700 };
    expect(traduzirPersonalizada(flix(p, { ...MAPA_FLIX, valor: "total", moeda: { fixo: "USD" } }), "c")).toMatchObject({
      valorCentavos: 19790,
      moeda: "USD",
    });
    expect(traduzirPersonalizada(flix(p, { ...MAPA_FLIX, valor: { path: "cents", formato: "centavos" } }), "c")!.valorCentavos).toBe(19700);
  });

  it("sem mapa (ou sem evento resolvido) não traduz", () => {
    expect(traduzirPersonalizada(entrega(PAYLOAD_FLIX), "c")).toBeNull();
    expect(traduzirPersonalizada(flix({ id: "x" }), "c")).toBeNull();
  });

  it("identificação: id_evento é a chave; teste mapeado; evento original pelo caminho", () => {
    const comTeste = { ...MAPA_FLIX, teste: "data.is_test" };
    expect(identificarPersonalizada(flix({ ...PAYLOAD_FLIX, data: { ...PAYLOAD_FLIX.data, is_test: true } }, comTeste))).toEqual({
      chave: "evt-flix-0001",
      eventoOriginal: "student.access_granted",
      teste: true,
    });
    expect(identificarPersonalizada(flix({ ...PAYLOAD_FLIX, data: { ...PAYLOAD_FLIX.data, is_test: "false" } }, comTeste)).teste).toBe(false);
    expect(identificarPersonalizada(flix({ ...PAYLOAD_FLIX, data: { ...PAYLOAD_FLIX.data, is_test: "sim" } }, comTeste)).teste).toBe(true);
    const semId = identificarPersonalizada(entrega({ algo: 1 }, { config: { mapa: { evento: { fixo: "acesso.criado" } } } }));
    expect(semId.chave).toMatch(/^[0-9a-f]{64}$/);
    expect(semId.eventoOriginal).toBe("personalizado");
  });
});

it("index: escolhe pela plataforma", () => {
  const p = fixture("hotmart_purchase_approved");
  expect(identificarEntrega("hotmart", entrega(p)).chave).toBe("hm-evt-0001");
  expect(traduzirVenda("hotmart", entrega(p), "x")!.evento).toBe("compra.aprovada");
  expect(traduzirVenda("personalizada", flix(PAYLOAD_FLIX), "x")!.evento).toBe("acesso.criado");
});
