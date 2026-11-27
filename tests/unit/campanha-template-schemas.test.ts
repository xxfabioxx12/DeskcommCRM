/**
 * O QUE A API ACEITA PARA UMA CAMPANHA POR TEMPLATE.
 *
 * O corpo antigo (sem nenhum campo novo) continua válido: é o que toda tela e
 * integração já mandam, e ele significa "texto".
 */
import { describe, expect, it } from "vitest";

import {
  criarCampanhaSchema,
  editarCampanhaSchema,
  mapaDeSlotsSchema,
  previaSchema,
} from "@/lib/campanhas/schemas";

const BASE = {
  name: "Reativação",
  channel_session_id: "11111111-1111-4111-8111-111111111111",
  base_legal: "consent" as const,
};
const TEMPLATE = {
  message_mode: "template" as const,
  template_name: "boas_vindas",
  template_language: "pt_BR",
  template_contract_hash: "h1",
  template_slot_map: { "1": "{{primeiro_nome}}", "button0:1": "promo" },
};

describe("criarCampanhaSchema", () => {
  it("o corpo de hoje (texto, sem campo novo) continua válido", () => {
    const r = criarCampanhaSchema.safeParse({ ...BASE, message_body: "Oi {{nome}}" });
    expect(r.success).toBe(true);
    expect(r.success && r.data.message_mode).toBeUndefined();
  });
  it("template com nome, idioma, carimbo e mapa é válido", () => {
    expect(criarCampanhaSchema.safeParse({ ...BASE, ...TEMPLATE }).success).toBe(true);
  });
  it("template sem o carimbo do contrato é recusado", () => {
    const r = criarCampanhaSchema.safeParse({ ...BASE, ...TEMPLATE, template_contract_hash: null });
    expect(r.success).toBe(false);
  });
  it("texto com template_name é recusado (incoerente)", () => {
    const r = criarCampanhaSchema.safeParse({ ...BASE, message_mode: "text", template_name: "x" });
    expect(r.success).toBe(false);
  });
  it("modo fora do vocabulário é recusado", () => {
    expect(criarCampanhaSchema.safeParse({ ...BASE, message_mode: "audio" }).success).toBe(false);
  });
});

describe("mapaDeSlotsSchema", () => {
  it("aceita as chaves do slotKey", () => {
    expect(mapaDeSlotsSchema.safeParse({ "1": "a", "header:1": "b", "card0:header:1": "c", nome: "d" }).success).toBe(true);
  });
  it("recusa chave com símbolo e mais de 50 chaves", () => {
    expect(mapaDeSlotsSchema.safeParse({ "1;drop": "a" }).success).toBe(false);
    const grande = Object.fromEntries(Array.from({ length: 51 }, (_, i) => [String(i + 1), "x"]));
    expect(mapaDeSlotsSchema.safeParse(grande).success).toBe(false);
  });
});

describe("editar e prévia", () => {
  it("editar aceita só o mapa", () => {
    expect(editarCampanhaSchema.safeParse({ template_slot_map: { "1": "{{nome}}" } }).success).toBe(true);
  });
  it("a prévia nasce em texto quando o modo não vem", () => {
    const r = previaSchema.safeParse({ audience_filter: { com_alguma_tag: ["vip"] } });
    expect(r.success && r.data.message_mode).toBe("text");
  });
  it("a prévia aceita o mapa em modo template", () => {
    const r = previaSchema.safeParse({
      audience_filter: { com_alguma_tag: ["vip"] },
      message_mode: "template",
      template_slot_map: { "1": "{{contato.cidade}}" },
    });
    expect(r.success).toBe(true);
  });
});

describe("message_body da campanha: conferência de variável e texto de reserva", () => {
  const corpo = (message_body: string) => ({ ...BASE, message_body });
  it.each([
    '{{nome|aluno}}',
    "{{nome|'aluno'}}",
    '{{nome|""}}',
    `{{nome|"${"a".repeat(101)}"}}`,
    '{{first_name|"aluno"}}',
    '{{sobrenome}}',
  ])("recusa %s ao criar e ao editar", (texto) => {
    expect(criarCampanhaSchema.safeParse(corpo(texto)).success).toBe(false);
    expect(editarCampanhaSchema.safeParse({ message_body: texto }).success).toBe(false);
  });
  it.each(['Oi {{primeiro_nome|"aluno"}}!', "Sem chaves", "Oi {{nome}}", null])("aceita %s", (texto) => {
    expect(criarCampanhaSchema.safeParse(corpo(texto as string)).success).toBe(true);
    expect(editarCampanhaSchema.safeParse({ message_body: texto }).success).toBe(true);
  });
  it("a frase de recusa é a do problema da expressão", () => {
    const r = criarCampanhaSchema.safeParse(corpo('{{first_name|"aluno"}}'));
    expect(JSON.stringify(r.error?.issues)).toContain("variável desconhecida");
  });
});
