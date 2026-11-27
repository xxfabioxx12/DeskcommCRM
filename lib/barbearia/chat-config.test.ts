import { describe, expect, it } from "vitest";
import { chatBarbeariaLigado, painelBarbeariaLigado } from "./config";

describe("visual do chat independente por organização", () => {
  it("não ativa pelo painel nem por configurações inválidas", () => {
    for (const settings of [undefined, null, [], true, {}, { painel_barbearia: true }, { chat_barbearia: "true" }, { chat_barbearia: false }]) {
      expect(chatBarbeariaLigado(settings)).toBe(false);
    }
  });
  it("ativa só por booleano explícito, sem ativar o painel", () => {
    expect(chatBarbeariaLigado({ chat_barbearia: true })).toBe(true);
    expect(painelBarbeariaLigado({ chat_barbearia: true })).toBe(false);
    expect(chatBarbeariaLigado({ chat_barbearia: true, painel_barbearia: false })).toBe(true);
  });
});
