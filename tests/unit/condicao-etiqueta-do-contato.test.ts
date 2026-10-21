/**
 * CONDIÇÃO PELAS ETIQUETAS DO CONTATO (`contact_tag`) — comparada normalizada,
 * reavaliada antes do envio, e a de hoje (`tag`) renomeada para "do card"
 * sem mudar o que ela faz.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { desvioAntesDoEnvio } from "@/lib/followup/condicao-antes-do-envio";
import { createSupabaseAdminClient } from "@/lib/followup/engine";
import { conditionCheckSchema, flowGraphSchema } from "@/lib/followup/graph-schema";
import { evaluateCondition, type LeadFacts } from "@/lib/followup/node-handlers";
import { createPgAdminClient } from "@/lib/followup/turn-bridge";
import { CAMPOS_DA_CONDICAO, comparadoresDoCampo, fraseDaCondicao } from "@/lib/followup/vocabulario";
import { DICIONARIO } from "@/lib/i18n/dicionario";

const fatos = (extra: Partial<LeadFacts> = {}): LeadFacts => ({
  lead_stage: null,
  tags: [],
  steps_taken: 0,
  last_outcome: null,
  ...extra,
});

const umaRegra = (field: string, op: string, value: string) => ({
  combinator: "and" as const,
  checks: [conditionCheckSchema.parse({ field, op, value })],
});

describe("contact_tag", () => {
  it("⭐ VIP no fluxo casa com vip no contato (normalizado dos dois lados)", () => {
    expect(evaluateCondition(umaRegra("contact_tag", "eq", "VIP "), fatos({ contact_tags: ["vip"] }), new Date())).toBe(true);
    expect(evaluateCondition(umaRegra("contact_tag", "neq", "VIP"), fatos({ contact_tags: ["vip"] }), new Date())).toBe(false);
    expect(evaluateCondition(umaRegra("contact_tag", "neq", "VIP"), fatos({ contact_tags: ["outra"] }), new Date())).toBe(true);
  });

  it("sem as etiquetas carregadas (adaptador antigo), nada é verdadeiro — nem a negação", () => {
    expect(evaluateCondition(umaRegra("contact_tag", "eq", "vip"), fatos(), new Date())).toBe(false);
    expect(evaluateCondition(umaRegra("contact_tag", "neq", "vip"), fatos(), new Date())).toBe(false);
  });

  it("controle: `tag` continua lendo o CARD, sensível a caixa como hoje", () => {
    expect(evaluateCondition(umaRegra("tag", "eq", "vip"), fatos({ tags: ["vip"], contact_tags: [] }), new Date())).toBe(true);
    expect(evaluateCondition(umaRegra("tag", "eq", "vip"), fatos({ tags: [], contact_tags: ["vip"] }), new Date())).toBe(false);
  });

  it("é reavaliada no instante do envio (a etiqueta pode ter saído durante a espera)", () => {
    const grafo = flowGraphSchema.parse({
      nodes: [
        { id: "c", type: "condition", label: "tem vip?", position: { x: 0, y: 0 }, config: umaRegra("contact_tag", "eq", "vip") },
        { id: "w", type: "wait", label: "espera", position: { x: 1, y: 0 }, config: { mode: "fixed", duration_ms: 3_600_000 } },
        { id: "a", type: "action", label: "manda", position: { x: 2, y: 0 }, config: { mode: "text", body: "oi" } },
        { id: "nao", type: "end", label: "fim", position: { x: 2, y: 1 }, config: { outcome: "exhausted" } },
      ],
      edges: [
        { id: "1", source: "c", target: "w", condition: { type: "cond_result", value: true } },
        { id: "2", source: "c", target: "nao", condition: { type: "cond_result", value: false } },
        { id: "3", source: "w", target: "a", condition: { type: "always" } },
      ],
    });
    const desvio = desvioAntesDoEnvio(grafo.nodes, grafo.edges, "a", fatos({ contact_tags: [] }), new Date());
    expect(desvio).toMatchObject({ proximo: "nao", esperado: true, agora: false });
  });

  it("vocabulário: 'Etiqueta do contato' é o campo novo; o de hoje vira 'Etiqueta do card'", () => {
    expect(CAMPOS_DA_CONDICAO.contact_tag.rotulo).toBe("Etiqueta do contato");
    expect(CAMPOS_DA_CONDICAO.tag.rotulo).toBe("Etiqueta do card");
    expect(fraseDaCondicao("contact_tag", "eq", "vip")).toBe("O contato tem a etiqueta “vip”");
    expect(fraseDaCondicao("tag", "eq", "vip")).toBe("O card tem a etiqueta “vip”");
    expect(comparadoresDoCampo("contact_tag").map((c) => c.op)).toEqual(["eq", "neq"]);
    expect(DICIONARIO["Etiqueta do card"]?.es).toBeTruthy();
  });
});

/**
 * Ruling R5 — os DOIS adaptadores leem `contacts.tags`. O do worker (`pg`, o que
 * o e2e de jornada usa) é o que roda em produção; sem ele a condição seria
 * sempre falsa nesse caminho.
 */
describe("os adaptadores devolvem contact_tags", () => {
  it("pg (worker 24/7): lê contacts.tags e devolve contact_tags", async () => {
    const query = vi.fn(async (sql: string) => ({
      rows: sql.includes("from crm_leads")
        ? [{ stage_id: "s1", tags: ["Card"], custom_fields: {} }]
        : sql.includes("from contacts")
          ? [{ name: "Ana", tags: ["vip", "cliente"] }]
          : [],
    }));
    const db = createPgAdminClient({ query } as unknown as Parameters<typeof createPgAdminClient>[0]);
    const fatosDoBanco = await db.loadLeadFacts("org-1", "c-1");
    expect(fatosDoBanco).toMatchObject({ tags: ["Card"], contact_tags: ["vip", "cliente"], contact_name: "Ana" });
    const sqlDoContato = query.mock.calls.map(([sql]) => String(sql)).find((s) => s.includes("from contacts"));
    expect(sqlDoContato).toMatch(/select\s+name,\s*tags\s+from contacts/);
  });

  it("pg: contato sem etiquetas (ou sem linha) devolve lista vazia, não undefined", async () => {
    const query = vi.fn(async (sql: string) => ({
      rows: sql.includes("from contacts") ? [{ name: "Ana", tags: null }] : [],
    }));
    const db = createPgAdminClient({ query } as unknown as Parameters<typeof createPgAdminClient>[0]);
    expect((await db.loadLeadFacts("org-1", "c-1")).contact_tags).toEqual([]);
  });

  it("supabase: lê contacts.tags e devolve contact_tags", async () => {
    const selects: string[] = [];
    const tabelas: Record<string, Record<string, unknown>[]> = {
      crm_leads: [{ organization_id: "org-1", contact_id: "c-1", stage_id: "s1", tags: ["Card"], custom_fields: {}, updated_at: "1" }],
      contacts: [{ organization_id: "org-1", id: "c-1", name: "Ana", tags: ["vip"] }],
    };
    const admin = {
      from(tabela: string) {
        let linhas = [...(tabelas[tabela] ?? [])];
        const q = {
          select: (cols: string) => (selects.push(`${tabela}:${cols}`), q),
          eq: (c: string, v: unknown) => ((linhas = linhas.filter((l) => l[c] === v)), q),
          order: () => q,
          limit: (n: number) => ((linhas = linhas.slice(0, n)), q),
          maybeSingle: async () => ({ data: linhas[0] ?? null, error: null }),
        };
        return q;
      },
    } as unknown as SupabaseClient;
    const fatosDoBanco = await createSupabaseAdminClient(admin).loadLeadFacts("org-1", "c-1");
    expect(fatosDoBanco).toMatchObject({ tags: ["Card"], contact_tags: ["vip"], contact_name: "Ana" });
    expect(selects).toContain("contacts:name, tags");
  });
});
