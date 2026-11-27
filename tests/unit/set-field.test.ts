/**
 * AÇÃO `set_field` — grava UMA chave de campo personalizado (Set Custom Field
 * do ManyChat), com as variáveis da campanha, sem apagar as outras chaves.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { getAction } from "@/lib/automation/actions";
import type { ActionCtx } from "@/lib/automation/types";
import { actionSchema } from "@/lib/schemas/webhooks";

import "@/lib/automation/actions/set-field";

const ORG = "11111111-1111-1111-1111-111111111111";

function cenario(context: Record<string, unknown>, resposta: unknown = { ok: true }, timezone: string | null = null) {
  const chamadas: Array<{ nome: string; args: Record<string, unknown> }> = [];
  const consulta = {
    select: () => consulta,
    eq: () => consulta,
    maybeSingle: async () => ({ data: { timezone }, error: null }),
  };
  const admin = {
    from: () => consulta,
    rpc: async (nome: string, args: Record<string, unknown>) => {
      chamadas.push({ nome, args });
      return { data: resposta, error: null };
    },
  };
  const ctx = { admin, organizationId: ORG, ruleId: "r", ruleName: "r", event: {}, context, requestId: "q" } as unknown as ActionCtx;
  return { ctx, chamadas };
}

const CONTATO = { id: "C", name: "Ana Souza", custom_fields: { link: "https://area" } };

describe("set_field", () => {
  it("contato: renderiza as variáveis e grava SÓ a chave pedida", async () => {
    const { ctx, chamadas } = cenario({ contact: CONTATO });
    const r = await getAction("set_field")!.execute(ctx, { destino: "contato", campo: "boas_vindas", valor: "Oi {{primeiro_nome}}: {{contato.link}}" });
    expect(r).toEqual({ type: "set_field", status: "success", detail: { destino: "contato", campo: "boas_vindas" } });
    expect(chamadas).toEqual([
      { nome: "fn_contato_anotar_campos", args: { p_org: ORG, p_contato: "C", p_campos: { boas_vindas: "Oi Ana: https://area" } } },
    ]);
  });

  it("card: grava no card pela 0502", async () => {
    const { ctx, chamadas } = cenario({ lead: { id: "L", contact_id: "C" }, contact: CONTATO });
    await getAction("set_field")!.execute(ctx, { destino: "card", campo: "plano", valor: "ouro" });
    expect(chamadas[0]).toEqual({ nome: "fn_lead_anotar_campos", args: { p_org: ORG, p_lead: "L", p_campos: { plano: "ouro" } } });
  });

  it("card sem card: ignorado (não cai no contato — Divergência D1)", async () => {
    const { ctx, chamadas } = cenario({ contact: CONTATO });
    expect(await getAction("set_field")!.execute(ctx, { destino: "card", campo: "plano", valor: "ouro" })).toMatchObject({
      status: "skipped",
      detail: { reason: "no_lead" },
    });
    expect(chamadas).toEqual([]);
  });

  it("⭐ variável sem valor: falha com o motivo e não grava nada", async () => {
    const { ctx, chamadas } = cenario({ contact: { id: "C", name: null } });
    expect(await getAction("set_field")!.execute(ctx, { destino: "contato", campo: "x", valor: "{{primeiro_nome}}" })).toEqual({
      type: "set_field",
      status: "failed",
      error: "falta o dado: primeiro_nome",
    });
    expect(chamadas).toEqual([]);
  });

  it("{{saudacao}} usa o fuso da organização (lê só quando precisa)", async () => {
    const { ctx, chamadas } = cenario({ contact: CONTATO }, { ok: true }, "America/Sao_Paulo");
    await getAction("set_field")!.execute(ctx, { destino: "contato", campo: "s", valor: "{{saudacao}}" });
    expect(String((chamadas[0]?.args.p_campos as Record<string, string>).s)).toMatch(/^(Bom dia|Boa tarde|Boa noite)$/);
  });

  it("config inválida (campo com ponto) não toca o banco", async () => {
    const { ctx, chamadas } = cenario({ contact: CONTATO });
    expect(await getAction("set_field")!.execute(ctx, { destino: "contato", campo: "a.b", valor: "x" })).toMatchObject({ status: "skipped" });
    expect(chamadas).toEqual([]);
  });

  it("nome de campo perigoso ou longo demais é ignorado antes do banco", async () => {
    for (const campo of ["__proto__", "constructor", "prototype", "x".repeat(61)]) {
      const { ctx, chamadas } = cenario({ contact: CONTATO });
      expect(await getAction("set_field")!.execute(ctx, { destino: "contato", campo, valor: "x" })).toMatchObject({ status: "skipped" });
      expect(chamadas).toEqual([]);
    }
  });

  it("schema: campo 1..60 sem ponto, valor obrigatório, variável desconhecida recusada", () => {
    const ok = (config: Record<string, unknown>) => actionSchema.safeParse({ type: "set_field", config }).success;
    expect(ok({ destino: "contato", campo: "link", valor: "{{contato.link}}" })).toBe(true);
    expect(ok({ destino: "contato", campo: "a.b", valor: "x" })).toBe(false);
    expect(ok({ destino: "contato", campo: "link", valor: "" })).toBe(false);
    expect(ok({ destino: "contato", campo: "link", valor: "{{sobrenome}}" })).toBe(false);
    expect(ok({ campo: "link", valor: "x" })).toBe(false);
  });
  it("reserva: sem o dado grava a reserva", async () => {
    const { ctx, chamadas } = cenario({ contact: { id: "C", name: null } });
    const r = await getAction("set_field")!.execute(ctx, { destino: "contato", campo: "nome_curto", valor: '{{primeiro_nome|"aluno"}}' });
    expect(r).toMatchObject({ status: "success" });
    expect(chamadas[0]?.args.p_campos).toEqual({ nome_curto: "aluno" });
  });

  describe("fuso com reserva", () => {
    afterEach(() => vi.useRealTimers());
    it("{{saudacao|…}} também lê o fuso da organização", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-09-18T12:00:00.000Z")); // 9h em São Paulo, 21h em Tóquio
      const { ctx, chamadas } = cenario({ contact: CONTATO }, { ok: true }, "Asia/Tokyo");
      await getAction("set_field")!.execute(ctx, { destino: "contato", campo: "s", valor: '{{saudacao|"Olá"}}' });
      expect(chamadas[0]?.args.p_campos).toEqual({ s: "Boa noite" });
    });
  });

  it("schema: aceita a reserva; desconhecida com reserva e reserva sem aspas são recusadas", () => {
    const ok = (valor: string) => actionSchema.safeParse({ type: "set_field", config: { destino: "contato", campo: "x", valor } }).success;
    expect(ok('{{primeiro_nome|"aluno"}}')).toBe(true);
    expect(ok("{{primeiro_nome|“aluno”}}")).toBe(true);
    expect(ok('{{venda.produto|"o curso"}}')).toBe(true);
    expect(ok('{{sobrenome|"x"}}')).toBe(false);
    expect(ok("{{primeiro_nome|aluno}}")).toBe(false);
  });
});
