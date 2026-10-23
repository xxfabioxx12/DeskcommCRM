/**
 * I1 — turno de follow-up dirigido por fluxo que termina em 131070 / interruptor
 * desligado: o erro terminal sobe (o worker cancela sem retry), mas ANTES a
 * inscrição ouve `skipped` com o motivo verdadeiro (senão: dead-man + motivo falso).
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { JobRow } from "@/lib/agent-engine/queue/queue";

const { resultado, desfecho } = vi.hoisted(() => ({ resultado: vi.fn(), desfecho: { atual: {} as Record<string, unknown> } }));
vi.mock("@/lib/agent-engine/guardrails/before-send", () => ({
  runBeforeSend: vi.fn(async (args: Record<string, unknown>) => {
    await (args.send as (b: string) => Promise<unknown>)(args.body as string);
    return { status: "sent", outcome: desfecho.atual, trace: [] };
  }),
}));
vi.mock("@/lib/agent-engine/agent/human-handoff", () => ({ isLeadInHandoff: vi.fn(async () => false) }));
vi.mock("@/lib/agent-engine/edge/crm/get-lead-context", () => ({
  getLeadContext: vi.fn(async () => ({
    ok: true,
    context: { contact: { is_blocked: false } },
    lgpd: { isAnonymized: false, isProspecting: false, legalBasis: {} },
  })),
}));
vi.mock("@/lib/agent-engine/agent/inbound-turn", async (original) => ({
  ...(await original<typeof import("@/lib/agent-engine/agent/inbound-turn")>()),
  runAgentTurn: vi.fn(async () => undefined),
}));
vi.mock("@/lib/agent-engine/edge/crm/send-ledger", () => ({ resultadoDoEnvioDoFollowup: resultado }));

const ORG = "org-1";
const INSCRICAO = "11111111-1111-4111-8111-111111111111";
const boundary = {
  organization_id: ORG, contact_id: "lead-1", conversation_id: "conversa-1",
  service_revision: 1, demanda_id: null, demanda_revision: null,
};
const job = () =>
  ({
    id: "job-1", organization_id: ORG, contact_id: "lead-1", kind: "followup_turn", source_event_id: null,
    payload: {
      followup_enrollment_id: INSCRICAO, node_id: "passo", source_step_key: "passo:1",
      purpose: "send_message", fixed_body: "Oi!", service_boundary: boundary,
    },
    status: "running", priority: 0, run_after: new Date(), attempts: 1, max_attempts: 3,
    last_error: null, locked_by: "w1", locked_at: new Date(), created_at: new Date(),
  }) as JobRow;

const pool = {
  query: vi.fn(async (sql: string) => {
    if (sql.includes("d.fechada_em::text")) return { rows: [{ ...boundary, status: "open", demanda_fechada_em: null }] };
    if (/from conversations/.test(sql)) return { rows: [{ id: "conversa-1", channel_session_id: "canal-1", archived_at: null }] };
    if (/from followup_enrollments/.test(sql) && !/left join ai_agents/.test(sql))
      return { rows: [{ current_node_id: "passo", status: "active" }] };
    return { rows: [] };
  }),
} as never;

function deps() {
  const completeFollowupTurn = vi.fn(async () => undefined);
  const d = {
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    crmCfg: {}, llmCfg: {}, knobs: {},
    channel: () => ({ send: vi.fn(async () => ({ ok: true })) }),
    completeFollowupTurn,
  } as never;
  return { d, completeFollowupTurn };
}

let criarHandler: typeof import("@/lib/agent-engine/agent/followup-turn").createFollowupTurnHandler;
let Terminal: typeof import("@/lib/agent-engine/agent/falha-do-envio").EnvioSemNovaTentativaError;
beforeAll(async () => {
  ({ createFollowupTurnHandler: criarHandler } = await import("@/lib/agent-engine/agent/followup-turn"));
  ({ EnvioSemNovaTentativaError: Terminal } = await import("@/lib/agent-engine/agent/falha-do-envio"));
}, 60_000);
beforeEach(() => resultado.mockReset());

describe("turno de follow-up do fluxo com envio sem nova tentativa", () => {
  it.each([
    ["resposta_automatica_desligada", "resposta_automatica_desligada", "x"],
    ["conversa_com_outro_app", "meta_error", "meta_131070: x"],
  ])("%s: avisa a inscrição (skipped) e relança o erro terminal", async (motivo, codigo, detalhe) => {
    desfecho.atual = { kind: "failed", idempotencyKey: "k", messageId: "m", erro: { codigo, detalhe } };
    const { d, completeFollowupTurn } = deps();
    await expect(criarHandler(d)(job(), pool, { workerId: "w1" })).rejects.toBeInstanceOf(Terminal);
    expect(completeFollowupTurn).toHaveBeenCalledTimes(1);
    expect(completeFollowupTurn).toHaveBeenCalledWith(
      pool,
      expect.objectContaining({ enrollmentId: INSCRICAO, nodeId: "passo", result: { kind: "skipped", reason: motivo } }),
    );
  });
  it("falha comum: erro comum, inscrição não é fechada", async () => {
    desfecho.atual = { kind: "failed", idempotencyKey: "k", messageId: "m", erro: { codigo: "meta_error", detalhe: "meta_131047: x" } };
    const { d, completeFollowupTurn } = deps();
    await expect(criarHandler(d)(job(), pool, { workerId: "w1" })).rejects.not.toBeInstanceOf(Terminal);
    expect(completeFollowupTurn).not.toHaveBeenCalled();
  });
});
