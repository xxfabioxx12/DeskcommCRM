import { describe, expect, it } from "vitest";

import {
  atualizarConexaoDeVendaSchema,
  configDaConexao,
  configDaConexaoSchema,
  criarConexaoDeVendaSchema,
} from "@/lib/vendas/config";
import { linhasEmPares, mapaDaTela, telaDoMapa } from "@/lib/vendas/mapa-na-tela";

const MAPA_FLIX = {
  evento: { path: "event", map: { "student.access_granted": "acesso.criado" } },
  nome: "data.student.name",
  email: "data.student.email",
  telefone: "data.student.phone",
  id_evento: "id",
  produto_id: "data.course.id",
  produto_nome: "data.course.title",
  extras: { link_magico_de_acesso: "data.student.magic_link" },
};

describe("config da conexão", () => {
  it("o mapa da Flix passa (ConectorGenericoTest::mapaFlix)", () => {
    expect(
      configDaConexaoSchema.safeParse({ mapa: MAPA_FLIX, telefone_regiao: "BR" }).success,
    ).toBe(true);
  });

  it("evento fixo ou traduzido fora do vocabulário é recusado", () => {
    expect(
      configDaConexaoSchema.safeParse({ mapa: { evento: { fixo: "compra.qualquer" } } }).success,
    ).toBe(false);
    expect(
      configDaConexaoSchema.safeParse({ mapa: { evento: { path: "e", map: { a: "foo" } } } })
        .success,
    ).toBe(false);
    expect(
      configDaConexaoSchema.safeParse({ mapa: { evento: { fixo: "custom.aula_vista" } } }).success,
    ).toBe(true);
  });

  it("campo livre com nome fora do padrão é recusado", () => {
    expect(
      configDaConexaoSchema.safeParse({ mapa: { extras: { "Link Mágico": "a" } } }).success,
    ).toBe(false);
  });

  it("validação: cabeçalho com espaço e modo desconhecido são recusados", () => {
    expect(
      configDaConexaoSchema.safeParse({ seguranca: { modo: "header_igual", header: "X Minha" } })
        .success,
    ).toBe(false);
    expect(configDaConexaoSchema.safeParse({ seguranca: { modo: "hmac" } }).success).toBe(false);
    expect(
      configDaConexaoSchema.safeParse({
        seguranca: { modo: "stripe_t_v1", header: "X-Kookie-Signature", tolerancia_s: 300 },
      }).success,
    ).toBe(true);
  });

  it("config torta gravada vira {} — só registrando, região BR", () => {
    expect(configDaConexao({ dispara: "sim" })).toEqual({});
    expect(configDaConexao(null)).toEqual({});
    expect(configDaConexao({ dispara: true, telefone_regiao: "PT" })).toEqual({
      dispara: true,
      telefone_regiao: "PT",
    });
  });

  it("campo torto fora da segurança não apaga a segurança", () => {
    const seguranca = { modo: "header_igual", header: "X-Flix" } as const;
    expect(configDaConexao({ dispara: "sim", seguranca })).toEqual({ seguranca });
    expect(configDaConexao({ mapa: { nada: 1 }, seguranca })).toEqual({ seguranca });
    expect(configDaConexao({ dispara: true, seguranca: { modo: "outro" } })).toEqual({});
  });

  it("criar: plataforma fora da lista e segredo curto são recusados; segredo é opcional", () => {
    expect(criarConexaoDeVendaSchema.safeParse({ name: "x", kind: "lead_capture" }).success).toBe(
      false,
    );
    expect(
      criarConexaoDeVendaSchema.safeParse({ name: "x", kind: "hotmart", secret: "abc" }).success,
    ).toBe(false);
    expect(
      criarConexaoDeVendaSchema.safeParse({ name: "Flix", kind: "personalizada" }).success,
    ).toBe(true);
    expect(atualizarConexaoDeVendaSchema.safeParse({ secret: null }).success).toBe(true);
  });

  it("criar: segredo obrigatório fora da personalizada ou com validação; personalizada sem validação aceita sem segredo", () => {
    expect(criarConexaoDeVendaSchema.safeParse({ name: "x", kind: "hotmart" }).success).toBe(false);
    expect(
      criarConexaoDeVendaSchema.safeParse({ name: "x", kind: "kiwify", secret: null }).success,
    ).toBe(false);
    expect(
      criarConexaoDeVendaSchema.safeParse({ name: "x", kind: "hotmart", secret: "abcd" }).success,
    ).toBe(true);
    expect(
      criarConexaoDeVendaSchema.safeParse({
        name: "x",
        kind: "personalizada",
        config: { seguranca: { modo: "header_igual", header: "X-Token" } },
      }).success,
    ).toBe(false);
    expect(
      criarConexaoDeVendaSchema.safeParse({
        name: "x",
        kind: "personalizada",
        config: { seguranca: { modo: "header_igual", header: "X-Token" } },
        secret: "abcd",
      }).success,
    ).toBe(true);
    expect(
      criarConexaoDeVendaSchema.safeParse({
        name: "x",
        kind: "personalizada",
        config: { seguranca: { modo: "nenhuma" } },
      }).success,
    ).toBe(true);
  });
});

describe("mapa na tela", () => {
  it("linhas a=b: ignora vazia e sem '=', o primeiro '=' separa", () => {
    expect(linhasEmPares("a=b\n\n c = d=e \nsemigual")).toEqual({ a: "b", c: "d=e" });
  });

  it("ida e volta do mapa da Flix", () => {
    expect(mapaDaTela(telaDoMapa(MAPA_FLIX))).toEqual(MAPA_FLIX);
  });

  it("evento fixo vence o caminho; valor leva o formato; campo vazio não entra", () => {
    const tela = telaDoMapa(undefined);
    expect(
      mapaDaTela({
        ...tela,
        eventoCaminho: "event",
        eventoFixo: "acesso.criado",
        caminhos: { email: " data.email ", valor: "data.amount", nome: "  " },
        formatoDoValor: "centavos",
      }),
    ).toEqual({
      evento: { fixo: "acesso.criado" },
      email: "data.email",
      valor: { path: "data.amount", formato: "centavos" },
    });
  });
});
