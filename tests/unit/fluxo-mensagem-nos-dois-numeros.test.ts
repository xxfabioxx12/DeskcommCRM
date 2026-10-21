/**
 * O PASSO "MENSAGEM" NO WORKER — número oficial manda o template com as
 * variáveis; número comum manda o texto; versão ausente, dado faltando e
 * template mudado pulam o passo com o motivo, sem tocar na cadeia de envio.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { JobRow } from "@/lib/agent-engine/queue/queue";

const runBeforeSend = vi.fn(async (args: Record<string, unknown>) => {
  await (args.send as (b: string) => Promise<unknown>)(args.body as string);
  return { status: "sent", outcome: { kind: "sent" }, trace: [] };
});
vi.mock("@/lib/agent-engine/guardrails/before-send", () => ({ runBeforeSend }));
vi.mock("@/lib/agent-engine/agent/human-handoff", () => ({ isLeadInHandoff: vi.fn(async () => false) }));
vi.mock("@/lib/agent-engine/edge/crm/get-lead-context", () => ({
  getLeadContext: vi.fn(async () => ({
    ok: true,
    context: { contact: { is_blocked: false } },
    lgpd: { isAnonymized: false, isProspecting: false, legalBasis: {} },
  })),
}));
const runAgentTurn = vi.fn(async () => undefined);
vi.mock("@/lib/agent-engine/agent/inbound-turn", async (original) => ({
  ...(await original<typeof import("@/lib/agent-engine/agent/inbound-turn")>()),
  runAgentTurn,
}));
vi.mock("@/lib/agent-engine/edge/crm/send-ledger", () => ({
  resultadoDoEnvioDoFollowup: vi.fn(async () => ({ kind: "sent" })),
}));

const ORG = "org-1";
const LEAD = "lead-1";
const CONVERSA = "conversa-1";
const CANAL = "canal-1";
const boundary = { organization_id: ORG, contact_id: LEAD, conversation_id: CONVERSA, service_revision: 1, demanda_id: null, demanda_revision: null };

const COMPONENTES = [{ type: "BODY", text: "Oi {{1}}, seu acesso: {{2}}" }];
// O carimbo é o `meta_templates.contract_hash` gravado pelo sync; aqui basta ser igual dos dois lados.
const HASH = "h1";
const MODELO = { name: "acesso", language: "pt_BR", contract_hash: HASH, slot_map: { "1": "{{primeiro_nome}}", "2": "{{contato.link}}" } };
const TEXTO = { body: "Oi {{primeiro_nome}}, acesse {{contato.link}}" };

function job(mensagem: Record<string, unknown>): JobRow {
  return {
    id: "job-1", organization_id: ORG, contact_id: LEAD, kind: "followup_turn", source_event_id: null,
    payload: {
      followup_enrollment_id: "11111111-1111-4111-8111-111111111111",
      node_id: "passo",
      purpose: "send_message",
      mensagem,
      service_boundary: boundary,
    },
    status: "running", priority: 0, run_after: new Date(), attempts: 1, max_attempts: 3, last_error: null,
    locked_by: "w1", locked_at: new Date(), created_at: new Date(),
  } as JobRow;
}

interface Cenario {
  provider: string;
  linha?: { status: string; contract_hash: string } | null;
  contato?: Record<string, unknown>;
}

function fakePool(c: Cenario) {
  const query = vi.fn(async (sql: string): Promise<{ rows: Array<Record<string, unknown>> }> => {
    if (sql.includes("d.fechada_em::text")) return { rows: [{ ...boundary, status: "open", demanda_fechada_em: null }] };
    if (/select provider from channel_sessions where/.test(sql)) return { rows: [{ provider: c.provider }] };
    if (/from meta_templates t/.test(sql)) {
      return c.linha
        ? { rows: [{ name: "acesso", language: "pt_BR", status: c.linha.status, contract_hash: c.linha.contract_hash, components: COMPONENTES, parameter_format: "POSITIONAL", saved_values: {} }] }
        : { rows: [] };
    }
    if (/select \* from contacts/.test(sql)) return { rows: [c.contato ?? { id: LEAD, name: "Ana Souza", custom_fields: { link: "https://area" } }] };
    if (/select \* from crm_leads/.test(sql)) return { rows: [] };
    if (/from conversations/.test(sql)) return { rows: [{ id: CONVERSA, channel_session_id: CANAL, archived_at: null }] };
    if (sql.includes("select current_node_id, status from followup_enrollments")) return { rows: [{ current_node_id: "passo", status: "active" }] };
    return { rows: [] };
  });
  return { query } as never;
}

function deps() {
  const send = vi.fn(async (_input: Record<string, unknown>) => ({ ok: true }));
  const completeFollowupTurn = vi.fn(async () => undefined);
  const d = {
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    crmCfg: {}, llmCfg: {}, knobs: {},
    channel: () => ({ send }),
    completeFollowupTurn,
  } as never;
  return { d, send, completeFollowupTurn };
}

function resultado(complete: ReturnType<typeof vi.fn>): { kind: string; reason?: string } {
  const entrada = (complete.mock.calls[0] as unknown[] | undefined)?.[1] as { result: { kind: string; reason?: string } } | undefined;
  return entrada?.result ?? { kind: "(não chamou)" };
}

let criarHandler: typeof import("@/lib/agent-engine/agent/followup-turn").createFollowupTurnHandler;

beforeAll(async () => {
  ({ createFollowupTurnHandler: criarHandler } = await import("@/lib/agent-engine/agent/followup-turn"));
}, 60_000);

beforeEach(() => {
  runBeforeSend.mockClear();
  runAgentTurn.mockClear();
});

describe("passo Mensagem no worker", () => {
  it("⭐ número oficial: sai o TEMPLATE, com os valores na ordem do contrato", async () => {
    const { d, send, completeFollowupTurn } = deps();
    await criarHandler(d)(job({ modelo: MODELO, texto: TEXTO }), fakePool({ provider: "meta_cloud", linha: { status: "APPROVED", contract_hash: HASH } }), { workerId: "w1" });
    expect(runBeforeSend).toHaveBeenCalledTimes(1);
    expect(runBeforeSend.mock.calls[0]![0].isTemplate).toBe(true);
    expect(runBeforeSend.mock.calls[0]![0].body).toBe("Oi Ana, seu acesso: https://area");
    expect(send.mock.calls[0]![0].template).toEqual({ name: "acesso", language: "pt_BR", values: { "1": "Ana", "2": "https://area" } });
    expect(resultado(completeFollowupTurn).kind).toBe("sent");
    expect(runAgentTurn).not.toHaveBeenCalled();
  });

  it("número comum: sai o TEXTO renderizado, sem template", async () => {
    const { d, send, completeFollowupTurn } = deps();
    await criarHandler(d)(job({ modelo: MODELO, texto: TEXTO }), fakePool({ provider: "waha" }), { workerId: "w1" });
    expect(runBeforeSend.mock.calls[0]![0].isTemplate).toBeUndefined();
    expect(runBeforeSend.mock.calls[0]![0].body).toBe("Oi Ana, acesse https://area");
    expect(send.mock.calls[0]![0].template).toBeUndefined();
    expect(resultado(completeFollowupTurn).kind).toBe("sent");
  });

  it("versão ausente para o tipo do número: pula com 'sem mensagem para este tipo de número'", async () => {
    const { d, completeFollowupTurn } = deps();
    await criarHandler(d)(job({ modelo: MODELO }), fakePool({ provider: "waha" }), { workerId: "w1" });
    expect(runBeforeSend).not.toHaveBeenCalled();
    expect(resultado(completeFollowupTurn)).toEqual({ kind: "skipped", reason: "sem mensagem para este tipo de número" });
  });

  it("dado faltando: pula com 'falta o dado: contato.link'", async () => {
    const { d, completeFollowupTurn } = deps();
    await criarHandler(d)(
      job({ modelo: MODELO }),
      fakePool({ provider: "meta_cloud", linha: { status: "APPROVED", contract_hash: HASH }, contato: { id: LEAD, name: "Ana", custom_fields: {} } }),
      { workerId: "w1" },
    );
    expect(runBeforeSend).not.toHaveBeenCalled();
    expect(resultado(completeFollowupTurn)).toEqual({ kind: "skipped", reason: "falta o dado: contato.link" });
  });

  it("template mudou: pula com o motivo", async () => {
    const { d, completeFollowupTurn } = deps();
    await criarHandler(d)(job({ modelo: MODELO }), fakePool({ provider: "meta_cloud", linha: { status: "APPROVED", contract_hash: "outro" } }), { workerId: "w1" });
    expect(runBeforeSend).not.toHaveBeenCalled();
    expect(resultado(completeFollowupTurn).reason).toBe('o template "acesso" mudou na Meta: escolha de novo no passo do fluxo');
  });

  it("⭐ template que não existe no número da conversa: pula com o motivo, sem tocar na cadeia", async () => {
    const { d, completeFollowupTurn } = deps();
    await criarHandler(d)(job({ modelo: MODELO }), fakePool({ provider: "meta_cloud", linha: null }), { workerId: "w1" });
    expect(runBeforeSend).not.toHaveBeenCalled();
    expect(resultado(completeFollowupTurn)).toEqual({ kind: "skipped", reason: 'o template "acesso" não existe no número desta conversa' });
  });

  it("controle: passo de TEXTO (sem `mensagem`) sai como sempre e nem lê o tipo do número", async () => {
    const { d, send, completeFollowupTurn } = deps();
    const pool = fakePool({ provider: "meta_cloud" }) as unknown as { query: ReturnType<typeof vi.fn> };
    const semMensagem = job({});
    const { mensagem: _fora, ...payload } = semMensagem.payload as Record<string, unknown>;
    await criarHandler(d)({ ...semMensagem, payload: { ...payload, fixed_body: "Oi, tudo bem?" } } as JobRow, pool as never, { workerId: "w1" });
    expect(runBeforeSend.mock.calls[0]![0].body).toBe("Oi, tudo bem?");
    expect(send.mock.calls[0]![0].template).toBeUndefined();
    expect(pool.query.mock.calls.some(([sql]) => /select provider from channel_sessions where/.test(sql as string))).toBe(false);
    expect(resultado(completeFollowupTurn).kind).toBe("sent");
  });
});
