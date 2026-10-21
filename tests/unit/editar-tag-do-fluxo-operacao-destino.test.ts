/**
 * `edit_lead_tag` GANHA OPERAÇÃO E DESTINO — e o fluxo antigo não muda um byte.
 *
 * 1. schema: config antiga parseia IDÊNTICA (nenhuma chave injetada); contato
 *    recusa etiqueta de 41; card aceita até 60.
 * 2. adaptador de produção: remover/contato vai para `fn_contato_remover_etiquetas`
 *    normalizado; adicionar/contato para `fn_contato_adicionar_etiquetas` (com
 *    `contact.tag_added`); config antiga continua no card, crua.
 *    Sem card, o destino `card` cai no contato e normaliza (ruling R1).
 * 3. falha ao gravar deixa rastro na inscrição (`edit_lead_tag_failed`, chave
 *    própria) e o fluxo segue — como o `move_lead`.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/atendimento/origem-automacao", () => ({ originFromAutomationEvent: async () => null }));

import { createSupabaseAdminClient, runFollowupTick, type AdminClient, type TickDeps } from "@/lib/followup/engine";
import { editLeadTagConfigSchema, flowGraphSchema } from "@/lib/followup/graph-schema";
import type { EnrollmentRow } from "@/lib/followup/node-handlers";

import "@/lib/automation/actions/register-all";

const ORG = "11111111-1111-4111-8111-111111111111";
const CONTATO = "22222222-2222-4222-8222-222222222222";
const LEAD = "33333333-3333-4333-8333-333333333333";

function supabaseFalso(linhas: { lead: Record<string, unknown> | null; contato: Record<string, unknown> | null }) {
  const rpcs: Array<{ nome: string; args: Record<string, unknown> }> = [];
  const consulta = (tabela: string) => {
    const api = {
      select: () => api,
      eq: () => api,
      order: () => api,
      limit: () => api,
      maybeSingle: async () => ({ data: tabela === "crm_leads" ? linhas.lead : linhas.contato, error: null }),
    };
    return api;
  };
  const admin = {
    from: consulta,
    rpc: async (nome: string, args: Record<string, unknown>) => {
      rpcs.push({ nome, args });
      if (nome === "emit_event") return { data: null, error: null };
      if (nome.endsWith("_remover_etiquetas")) return { data: { tags: [], removidas: args.p_tags }, error: null };
      return { data: { tags: args.p_etiquetas, adicionadas: args.p_etiquetas }, error: null };
    },
  };
  return { db: createSupabaseAdminClient(admin as never), rpcs };
}

const item = (config: Record<string, unknown>) => ({
  organization_id: ORG,
  contact_id: CONTATO,
  enrollment_id: "e1",
  config: editLeadTagConfigSchema.parse(config),
});

describe("schema do edit_lead_tag", () => {
  it("config antiga parseia idêntica — nenhuma chave nova injetada", () => {
    expect(editLeadTagConfigSchema.parse({ tags: ["vip"] })).toEqual({ tags: ["vip"] });
  });

  it("operação e destino são aceitos; contato recusa 41, card aceita 60", () => {
    expect(editLeadTagConfigSchema.safeParse({ tags: ["a"], operacao: "remover", destino: "contato" }).success).toBe(true);
    expect(editLeadTagConfigSchema.safeParse({ tags: ["x".repeat(41)], destino: "contato" }).success).toBe(false);
    expect(editLeadTagConfigSchema.safeParse({ tags: ["x".repeat(60)], destino: "card" }).success).toBe(true);
    expect(editLeadTagConfigSchema.safeParse({ tags: ["a"], operacao: "trocar" }).success).toBe(false);
  });
});

describe("adaptador de produção (editarTagDoLead)", () => {
  it("remover no contato: fn_contato_remover_etiquetas com a etiqueta normalizada, o contato do card", async () => {
    const { db, rpcs } = supabaseFalso({ lead: { id: LEAD, contact_id: CONTATO, tags: [] }, contato: null });
    await db.editarTagDoLead!(item({ tags: ["VIP "], operacao: "remover", destino: "contato" }));
    expect(rpcs).toEqual([{ nome: "fn_contato_remover_etiquetas", args: { p_org: ORG, p_contato: CONTATO, p_tags: ["vip"] } }]);
  });

  it("adicionar no contato: fn_contato_adicionar_etiquetas e contact.tag_added", async () => {
    const { db, rpcs } = supabaseFalso({ lead: { id: LEAD, contact_id: CONTATO, tags: [] }, contato: null });
    await db.editarTagDoLead!(item({ tags: ["VIP"], operacao: "adicionar", destino: "contato" }));
    expect(rpcs[0]).toEqual({ nome: "fn_contato_adicionar_etiquetas", args: { p_org: ORG, p_contato: CONTATO, p_etiquetas: ["vip"] } });
    expect(rpcs[1]).toMatchObject({ nome: "emit_event", args: { p_event_type: "contact.tag_added" } });
  });

  it("controle: config antiga continua no card, com a etiqueta como veio", async () => {
    const { db, rpcs } = supabaseFalso({ lead: { id: LEAD, contact_id: CONTATO, tags: [] }, contato: null });
    await db.editarTagDoLead!(item({ tags: ["VIP"] }));
    expect(rpcs[0]).toEqual({ nome: "fn_lead_adicionar_etiquetas", args: { p_org: ORG, p_lead: LEAD, p_etiquetas: ["VIP"] } });
  });

  it("R1: sem card, o destino card cai no contato e a etiqueta sai normalizada — pôr e tirar", async () => {
    const contato = { id: CONTATO, tags: [] };
    const pôr = supabaseFalso({ lead: null, contato });
    await pôr.db.editarTagDoLead!(item({ tags: ["VIP "] }));
    expect(pôr.rpcs[0]).toEqual({ nome: "fn_contato_adicionar_etiquetas", args: { p_org: ORG, p_contato: CONTATO, p_etiquetas: ["vip"] } });

    const tirar = supabaseFalso({ lead: null, contato });
    await tirar.db.editarTagDoLead!(item({ tags: ["VIP "], operacao: "remover", destino: "card" }));
    expect(tirar.rpcs).toEqual([{ nome: "fn_contato_remover_etiquetas", args: { p_org: ORG, p_contato: CONTATO, p_tags: ["vip"] } }]);
  });

  it("pulado (sem contato) vira erro legível — o motor registra na inscrição", async () => {
    const { db } = supabaseFalso({ lead: null, contato: null });
    await expect(db.editarTagDoLead!(item({ tags: ["a"], operacao: "remover", destino: "contato" }))).rejects.toThrow("O contato não foi encontrado.");
  });
});

describe("falha ao gravar deixa rastro e o fluxo segue", () => {
  it("insere edit_lead_tag_failed com a mensagem e chave própria", async () => {
    const eventos: Array<{ event_type: string; payload: Record<string, unknown>; idempotency_key: string }> = [];
    const patches: Array<Record<string, unknown>> = [];
    const fila: EnrollmentRow[] = [
      {
        id: "e1", organization_id: ORG, pointer_id: "p1", version_id: "v1", contact_id: CONTATO, conversation_id: null,
        current_node_id: "n2", status: "active", next_eval_at: new Date().toISOString(), claimed_until: null,
        attempts: 0, max_attempts: 3, last_error: null, steps_taken: 0, outcome: null, cancel_reason: null,
        started_at: new Date().toISOString(), completed_at: null, updated_at: new Date().toISOString(),
      },
    ];
    const grafo = {
      nodes: [
        { id: "n1", type: "trigger", label: "início", position: { x: 0, y: 0 }, config: {} },
        { id: "n2", type: "edit_lead_tag", label: "tag", position: { x: 1, y: 0 }, config: { tags: ["a"], operacao: "remover" } },
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
      insertEnrollmentEvent: async (e) => {
        eventos.push({ event_type: e.event_type, payload: e.payload, idempotency_key: e.idempotency_key });
        return { inserted: true };
      },
      updateEnrollment: async (_id, _org, patch) => {
        patches.push(patch as Record<string, unknown>);
      },
      editarTagDoLead: async () => {
        throw new Error("banco recusou");
      },
      loadLastInboundBody: async () => null,
      loadFlowPointerName: async () => null,
      insertDeadInboxItem: async () => {},
      persistirRespostaFollowup: async () => {},
    };
    const deps: TickDeps = { db, clock: () => new Date("2026-10-21T12:00:00Z"), enqueueJob: async () => {} };

    const resumo = await runFollowupTick(deps);

    expect(resumo).toMatchObject({ failed: 0, advanced: 1 });
    expect(patches[0]).toMatchObject({ current_node_id: "fim" });
    expect(eventos).toEqual([
      { event_type: "node_advanced", payload: { next_node_id: "fim" }, idempotency_key: "n2:0" },
      { event_type: "edit_lead_tag_failed", payload: { error: "banco recusou" }, idempotency_key: "n2:0:falha" },
    ]);
  });
});
