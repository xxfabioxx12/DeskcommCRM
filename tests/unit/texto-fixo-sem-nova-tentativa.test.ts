/**
 * F10 — texto fixo barrado (interruptor / 131070) fecha o job SEM retry e avisa a
 * inscrição com o motivo verdadeiro (senão o dead-man a mataria por
 * `action_turn_never_completed`).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { completeTurn, sendWithLedger } = vi.hoisted(() => ({ completeTurn: vi.fn(async () => undefined), sendWithLedger: vi.fn() }));
vi.mock("@/lib/agent-engine/edge/crm/send-ledger", () => ({ sendWithLedger, supabaseSendLedger: () => ({}) }));
vi.mock("@/lib/followup/turn-bridge", () => ({ completeTurnForEnrollment: completeTurn }));
vi.mock("@/lib/followup/engine", () => ({ createSupabaseAdminClient: () => ({}) }));
vi.mock("@/app/api/v1/messages/_handler", () => ({ sendMessageHandler: vi.fn() }));
vi.mock("@/lib/agenda/efeito", () => ({ assertAgendaEffectSupabase: vi.fn(async () => undefined) }));
vi.mock("@/lib/atendimento/origem", () => ({ assertServiceBoundarySupabase: vi.fn(async () => undefined) }));
vi.mock("@/lib/atendimento/fronteira", () => ({
  parseServiceBoundary: () => ({ conversation_id: "conv" }),
  StaleServiceBoundaryError: class extends Error {},
}));
vi.mock("@/lib/ai/elegibilidade/consulta-supabase", () => ({ decidirElegibilidadeDaConversaViaSupabase: async () => null }));
vi.mock("@/lib/followup/janela-de-disparo", () => ({ canalDaConversa: async () => null, decidirAdiamentoPorJanela: async () => null }));
vi.mock("@/lib/agent-engine/pacing/ledger-supabase", () => ({ criarPacingDoCanal: async () => ({}) }));

import { enviarTextoFixoPendente } from "@/lib/followup/enviar-texto-fixo";

function adminFalso(settle: (a: unknown) => void) {
  const job = {
    id: "job", organization_id: "org", contact_id: "c", attempts: 0, max_attempts: 3,
    payload: { fixed_body: "oi", followup_enrollment_id: "enr", node_id: "no", service_boundary: {} },
  };
  const q = (data: unknown): Record<string, unknown> => {
    const o: Record<string, unknown> = {};
    for (const m of ["select", "eq", "lt", "order", "limit", "update"]) o[m] = () => o;
    o.maybeSingle = async () => ({ data, error: null });
    o.then = (r: (v: unknown) => unknown) => r({ data: [job], error: null });
    return o;
  };
  return {
    from: (t: string) =>
      t === "job_queue"
        ? q({ id: "job", locked_by: "w", locked_at: "t" })
        : q({ current_node_id: "no", status: "active", revision: 1 }),
    rpc: async (fn: string, args: unknown) => {
      if (fn === "fn_followup_inline_settle") settle(args);
      return { data: true, error: null };
    },
  } as never;
}

beforeEach(() => vi.clearAllMocks());

describe("enviarTextoFixoPendente diante de falha sem nova tentativa", () => {
  it.each([
    ["resposta_automatica_desligada", "resposta_automatica_desligada", "x"],
    ["conversa_com_outro_app", "meta_error", "meta_131070: x"],
  ])("motivo %s: inscrição recebe skipped e o job fecha como feito", async (motivo, codigo, detalhe) => {
    sendWithLedger.mockResolvedValue({ kind: "failed", idempotencyKey: "k", crmMessageId: "m", erro: { codigo, detalhe } });
    const settle = vi.fn<(a: unknown) => void>();
    const enviados = await enviarTextoFixoPendente(adminFalso(settle));
    expect(enviados).toBe(0);
    expect(completeTurn).toHaveBeenCalledWith(
      expect.anything(), "org", "enr", "no", { kind: "skipped", reason: motivo }, undefined, "job", expect.anything(),
    );
    expect(settle).toHaveBeenCalledWith(expect.objectContaining({ p_done: true, p_error: motivo }));
  });
  it("falha comum continua sendo erro (job volta pra fila)", async () => {
    sendWithLedger.mockResolvedValue({ kind: "failed", idempotencyKey: "k", crmMessageId: "m", erro: { codigo: "meta_error", detalhe: "meta_131047: x" } });
    const settle = vi.fn<(a: unknown) => void>();
    await enviarTextoFixoPendente(adminFalso(settle));
    expect(completeTurn).not.toHaveBeenCalled();
    expect(settle).toHaveBeenCalledWith(expect.objectContaining({ p_done: false, p_error: "message_failed" }));
  });
});
