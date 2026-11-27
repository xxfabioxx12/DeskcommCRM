import { describe, expect, it } from "vitest";

import { telefoneDeDddENumero, telefoneE164 } from "@/lib/vendas/telefone";

describe("telefoneE164 — casos do PhoneNormalizerTest do integrador", () => {
  it.each([
    ["+5511999998888", "BR", "+5511999998888"],
    ["11 99999-8888", "BR", "+5511999998888"],
    ["(11) 99999-8888", "BR", "+5511999998888"],
    ["11 3333-4444", "BR", "+551133334444"],
    ["5531999999999", "BR", "+5531999999999"],
    ["11987654321", "BR", "+5511987654321"],
    ["+1 415 555 2671", "BR", "+14155552671"],
    ["+351 912 345 678", "BR", "+351912345678"],
    ["351912345678", "BR", "+351912345678"],
    ["447911123456", "BR", "+447911123456"],
    ["5511987654321", "BR", "+5511987654321"],
    ["+5511987654321", "BR", "+5511987654321"],
    ["005511987654321", "BR", "+5511987654321"],
    ["00 351 912 345 678", "BR", "+351912345678"],
    ["912345678", "PT", "+351912345678"],
    ["(011) 98765-4321", "BR", "+5511987654321"],
    ["06 1234 5678", "IT", "+390612345678"],
    ["07911 123456", "GB", "+447911123456"],
  ])("%s (%s) → %s", (bruto, regiao, esperado) => {
    expect(telefoneE164(bruto, regiao)).toBe(esperado);
  });

  it("10 dígitos e 12 com DDI ganham o nono dígito (a forma que o CRM grava)", () => {
    expect(telefoneE164("1199998888")).toBe("+5511999998888");
    expect(telefoneE164("+55 11 9999-8888")).toBe("+5511999998888");
  });

  it("inválidos viram nulo, nunca erro", () => {
    for (const bruto of [null, undefined, "", "123", "abc", "+00 1234 5678", "11 1234-5678"]) {
      expect(telefoneE164(bruto), String(bruto)).toBeNull();
    }
  });

  it("DDD e número separados (padrão Hotmart)", () => {
    expect(telefoneDeDddENumero("31", "999999999")).toBe("+5531999999999");
    expect(telefoneDeDddENumero(31, 999998888)).toBe("+5531999998888");
    expect(telefoneDeDddENumero("31", null)).toBeNull();
    expect(telefoneDeDddENumero(null, "  ")).toBeNull();
  });

  it("região fora da tabela: só as formas internacionais", () => {
    expect(telefoneE164("912345678", "ZZ")).toBeNull();
    expect(telefoneE164("+351912345678", "ZZ")).toBe("+351912345678");
  });
});
