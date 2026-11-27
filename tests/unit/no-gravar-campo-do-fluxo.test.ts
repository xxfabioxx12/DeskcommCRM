/**
 * NÓ `gravar_campo` (Set Custom Field no fluxo) — parseia, passa pelo relógio em
 * 1 tick, grava pela MESMA ação `set_field` das regras, deixa rastro quando
 * falha e é exigido completo na publicação.
 */
import { describe, expect, it } from "vitest";

import { createSupabaseAdminClient, runFollowupTick, type AdminClient, type TickDeps } from "@/lib/followup/engine";
import { CUSTO_NO_MOTOR } from "@/lib/followup/custo-no-motor";
import { flowGraphSchema, gravarCampoConfigSchema } from "@/lib/followup/graph-schema";
import type { EnrollmentRow } from "@/lib/followup/node-handlers";
import { CONTA_NO_TETO, NOS_DA_SUPERFICIE, validateFlowForPublish } from "@/lib/followup/validate-publish";
import { MENSAGEM_CAMPO_INVALIDO } from "@/lib/automation/etiquetas-e-campos";

import "@/lib/automation/actions/register-all";

const ORG = "11111111-1111-4111-8111-111111111111";
const CONTATO = "22222222-2222-4222-8222-222222222222";

const grafo = (config: Record<string, unknown>) => ({
  nodes: [
    { id: "n1", type: "trigger", label: "início", position: { x: 0, y: 0 }, config: {} },
    { id: "n2", type: "gravar_campo", label: "Grava o link", position: { x: 1, y: 0 }, config },
    { id: "fim", type: "end", label: "fim", position: { x: 2, y: 0 }, config: { outcome: "converted" } },
  ],
  edges: [
    { id: "e-1", source: "n1", target: "n2", condition: { type: "always" } },
    { id: "e-2", source: "n2", target: "fim", condition: { type: "always" } },
  ],
});

const inscricao = (): EnrollmentRow => ({
  id: "e1", organization_id: ORG, pointer_id: "p1", version_id: "v1", contact_id: CONTATO, conversation_id: null,
  current_node_id: "n2", status: "active", next_eval_at: new Date().toISOString(), claimed_until: null,
  attempts: 0, max_attempts: 3, last_error: null, steps_taken: 0, outcome: null, cancel_reason: null,
  started_at: new Date().toISOString(), completed_at: null, updated_at: new Date().toISOString(),
});

function tick(config: Record<string, unknown>, gravarCampo: AdminClient["gravarCampo"]) {
  const eventos: Array<{ event_type: string; payload: Record<string, unknown> }> = [];
  const fila = [inscricao()];
  const db: AdminClient = {
    claimDueEnrollments: async () => fila.splice(0, fila.length),
    loadFlowGraph: async () => flowGraphSchema.parse(grafo(config)),
    loadLeadFacts: async () => ({ lead_stage: null, tags: [] }),
    loadEnrollmentEvents: async () => [],
    insertEnrollmentEvent: async (e) => {
      eventos.push({ event_type: e.event_type, payload: e.payload });
      return { inserted: true };
    },
    updateEnrollment: async () => {},
    ...(gravarCampo ? { gravarCampo } : {}),
    loadLastInboundBody: async () => null,
    loadFlowPointerName: async () => null,
    insertDeadInboxItem: async () => {},
    persistirRespostaFollowup: async () => {},
  };
  const deps: TickDeps = { db, clock: () => new Date("2026-10-21T12:00:00Z"), enqueueJob: async () => {} };
  return { rodar: () => runFollowupTick(deps), eventos };
}

describe("nó gravar_campo", () => {
  it("schema: destino obrigatório; campo com ponto recusado; campo vazio aceito no rascunho", () => {
    expect(gravarCampoConfigSchema.safeParse({ destino: "contato", campo: "link", valor: "{{contato.x}}" }).success).toBe(true);
    expect(gravarCampoConfigSchema.safeParse({ destino: "contato", campo: "a.b", valor: "x" }).success).toBe(false);
    expect(gravarCampoConfigSchema.safeParse({ destino: "contato", campo: "", valor: "" }).success).toBe(true);
    expect(gravarCampoConfigSchema.safeParse({ campo: "link", valor: "x" }).success).toBe(false);
  });

  it("custa 1 tick, não conta no teto, e está nas superfícies do relógio", () => {
    expect(CUSTO_NO_MOTOR.gravar_campo).toBe(1);
    expect(CONTA_NO_TETO.gravar_campo).toBe(false);
    expect(NOS_DA_SUPERFICIE.followup).toContain("gravar_campo");
    expect(NOS_DA_SUPERFICIE.atendimento).not.toContain("gravar_campo");
  });

  it("avança e chama a escrita com o config do nó", async () => {
    const chamadas: unknown[] = [];
    const t = tick({ destino: "contato", campo: "link", valor: "x" }, async (item) => {
      chamadas.push(item);
    });
    const resumo = await t.rodar();
    expect(resumo).toMatchObject({ failed: 0, advanced: 1 });
    expect(chamadas).toEqual([{ organization_id: ORG, contact_id: CONTATO, enrollment_id: "e1", config: { destino: "contato", campo: "link", valor: "x" } }]);
  });

  it("falha deixa rastro gravar_campo_failed e o fluxo segue", async () => {
    const t = tick({ destino: "contato", campo: "link", valor: "x" }, async () => {
      throw new Error("falta o dado: primeiro_nome");
    });
    const resumo = await t.rodar();
    expect(resumo).toMatchObject({ failed: 0, advanced: 1 });
    expect(t.eventos.map((e) => e.event_type)).toEqual(["node_advanced", "gravar_campo_failed"]);
    expect(t.eventos[1]?.payload).toEqual({ error: "falta o dado: primeiro_nome" });
  });

  it("adaptador de produção: renderiza com o contato e grava pela 9002", async () => {
    const rpcs: Array<{ nome: string; args: Record<string, unknown> }> = [];
    const consulta = (tabela: string) => {
      const api = {
        select: () => api, eq: () => api, order: () => api, limit: () => api,
        maybeSingle: async () => ({
          data: tabela === "contacts" ? { id: CONTATO, name: "Ana Souza", custom_fields: {} } : null,
          error: null,
        }),
      };
      return api;
    };
    const admin = {
      from: consulta,
      rpc: async (nome: string, args: Record<string, unknown>) => {
        rpcs.push({ nome, args });
        return { data: { ok: true }, error: null };
      },
    };
    const db = createSupabaseAdminClient(admin as never);
    await db.gravarCampo!({
      organization_id: ORG, contact_id: CONTATO, enrollment_id: "e1",
      config: { destino: "contato", campo: "saudou", valor: "{{primeiro_nome}}" },
    });
    expect(rpcs).toEqual([{ nome: "fn_contato_anotar_campos", args: { p_org: ORG, p_contato: CONTATO, p_campos: { saudou: "Ana" } } }]);
  });

  it("publicação: campo ou valor vazio recusa; variável desconhecida recusa", () => {
    const codigos = (config: Record<string, unknown>) => {
      const r = validateFlowForPublish(flowGraphSchema.parse(grafo(config)));
      return r.ok ? [] : r.errors.map((e) => e.code);
    };
    expect(codigos({ destino: "contato", campo: "", valor: "x" })).toContain("campo_ausente");
    expect(codigos({ destino: "contato", campo: "link", valor: "{{sobrenome}}" })).toContain("variavel_desconhecida");
    expect(codigos({ destino: "contato", campo: "link", valor: "{{contato.link_area}}" })).toEqual([]);
  });

  it("publicação: nome de campo perigoso ou longo recusa com a mensagem da regra (R6)", () => {
    for (const campo of ["__proto__", "constructor", "prototype", "x".repeat(60) + "y"]) {
      const config = { destino: "contato", campo, valor: "x" };
      const parsed = flowGraphSchema.safeParse(grafo(config));
      // 61 caracteres o schema já recusa; os nomes de protótipo passam no schema e a publicação barra.
      if (!parsed.success) continue;
      const r = validateFlowForPublish(parsed.data);
      expect(r.ok).toBe(false);
      const erro = r.ok ? undefined : r.errors.find((e) => e.code === "campo_ausente");
      expect(erro?.message).toContain(MENSAGEM_CAMPO_INVALIDO);
    }
  });

  it("motor: nome de campo perigoso não chega à escrita (R6)", async () => {
    const rpcs: string[] = [];
    const consulta = (tabela: string) => {
      const api = {
        select: () => api, eq: () => api, order: () => api, limit: () => api,
        maybeSingle: async () => ({ data: tabela === "contacts" ? { id: CONTATO, name: "Ana", custom_fields: {} } : null, error: null }),
      };
      return api;
    };
    const admin = {
      from: consulta,
      rpc: async (nome: string) => {
        rpcs.push(nome);
        return { data: { ok: true }, error: null };
      },
    };
    const db = createSupabaseAdminClient(admin as never);
    await expect(
      db.gravarCampo!({ organization_id: ORG, contact_id: CONTATO, enrollment_id: "e1", config: { destino: "contato", campo: "__proto__", valor: "x" } }),
    ).rejects.toThrow();
    expect(rpcs).toEqual([]);
  });
});
