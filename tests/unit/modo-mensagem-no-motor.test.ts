/**
 * MODO `mensagem` DO NÓ DE AÇÃO — o grafo aceita, o motor leva as DUAS versões
 * no payload do job (sem `fixed_body`: quem decide é o worker, pelo número da
 * conversa) e os modos antigos não mudam.
 */
import { describe, expect, it } from "vitest";

import { runFollowupTick, type AdminClient, type FollowupJobRequest, type TickDeps } from "@/lib/followup/engine";
import { actionConfigSchema, flowGraphSchema } from "@/lib/followup/graph-schema";
import type { EnrollmentRow } from "@/lib/followup/node-handlers";
import { MODOS_DA_ACAO } from "@/lib/followup/vocabulario";

const ORG = "11111111-1111-4111-8111-111111111111";
const CONTATO = "22222222-2222-4222-8222-222222222222";
const MODELO = { name: "acesso", language: "pt_BR", contract_hash: "h1", slot_map: { "1": "{{primeiro_nome}}" } };

async function enfileirar(config: Record<string, unknown>): Promise<FollowupJobRequest[]> {
  const jobs: FollowupJobRequest[] = [];
  const fila: EnrollmentRow[] = [
    {
      id: "e1", organization_id: ORG, pointer_id: "p1", version_id: "v1", contact_id: CONTATO, conversation_id: null,
      current_node_id: "n2", status: "active", next_eval_at: new Date().toISOString(), claimed_until: null,
      attempts: 0, max_attempts: 3, last_error: null, steps_taken: 1, outcome: null, cancel_reason: null,
      started_at: new Date().toISOString(), completed_at: null, updated_at: new Date().toISOString(),
    },
  ];
  const grafo = {
    nodes: [
      { id: "n1", type: "trigger", label: "início", position: { x: 0, y: 0 }, config: {} },
      { id: "n2", type: "action", label: "manda", position: { x: 1, y: 0 }, config },
      { id: "fim", type: "end", label: "fim", position: { x: 2, y: 0 }, config: { outcome: "converted" } },
    ],
    edges: [
      { id: "e-1", source: "n1", target: "n2", condition: { type: "always" } },
      { id: "e-2", source: "n2", target: "fim", condition: { type: "always" } },
    ],
  };
  const db: AdminClient = {
    claimDueEnrollments: async () => fila.splice(0, fila.length),
    loadFlowGraph: async () => flowGraphSchema.parse(grafo),
    loadLeadFacts: async () => ({ lead_stage: null, tags: [] }),
    loadEnrollmentEvents: async () => [],
    insertEnrollmentEvent: async () => ({ inserted: true }),
    updateEnrollment: async () => {},
    loadRenderContext: async () => ({ contact: { name: "Ana" } }),
    loadLastInboundBody: async () => null,
    loadFlowPointerName: async () => null,
    insertDeadInboxItem: async () => {},
    persistirRespostaFollowup: async () => {},
  };
  const deps: TickDeps = { db, clock: () => new Date("2026-10-21T12:00:00Z"), enqueueJob: async (j) => { jobs.push(j); } };
  await runFollowupTick(deps);
  return jobs;
}

describe("modo mensagem", () => {
  it("schema: as duas versões, só uma, ou nenhuma (rascunho); chave estranha recusada", () => {
    expect(actionConfigSchema.safeParse({ mode: "mensagem", modelo: MODELO, texto: { body: "Oi {{primeiro_nome}}" } }).success).toBe(true);
    expect(actionConfigSchema.safeParse({ mode: "mensagem", texto: { body: "Oi" } }).success).toBe(true);
    expect(actionConfigSchema.safeParse({ mode: "mensagem" }).success).toBe(true);
    expect(actionConfigSchema.safeParse({ mode: "mensagem", texto: { body: "" } }).success).toBe(false);
    expect(actionConfigSchema.safeParse({ mode: "mensagem", outro: 1 }).success).toBe(false);
  });

  it("controle: os modos antigos parseiam idênticos", () => {
    for (const antigo of [
      { mode: "text", body: "Olá!" },
      { mode: "ai_message", prompt_hint: "x" },
      { mode: "template", template_id: "22222222-2222-4222-8222-222222222222" },
    ]) {
      expect(actionConfigSchema.parse(antigo)).toEqual(antigo);
    }
  });

  it("o motor leva as duas versões no payload, sem fixed_body", async () => {
    const jobs = await enfileirar({ mode: "mensagem", modelo: MODELO, texto: { body: "Oi {{primeiro_nome}}" } });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.payload.mensagem).toEqual({ modelo: MODELO, texto: { body: "Oi {{primeiro_nome}}" } });
    expect(jobs[0]?.payload).not.toHaveProperty("fixed_body");
  });

  it("controle: texto fixo continua com fixed_body renderizado e sem mensagem", async () => {
    const jobs = await enfileirar({ mode: "text", body: "Oi {{nome}}" });
    expect(jobs[0]?.payload.fixed_body).toBe("Oi Ana");
    expect(jobs[0]?.payload).not.toHaveProperty("mensagem");
  });

  it("vocabulário tem o rótulo do modo", () => {
    expect(MODOS_DA_ACAO.mensagem).toBe("Mensagem: template no número oficial, texto no comum");
  });
});
