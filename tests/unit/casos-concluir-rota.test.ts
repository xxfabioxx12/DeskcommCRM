/**
 * Fork NODZ — POST /api/v1/ai/cases/:id/concluir e o GET com as três abas.
 *
 * "Concluído" fecha o caso SEM falar com o cliente: nada de `enqueueJob`
 * (`case_reply_turn`) nem handoff. A transição real no Postgres é a
 * `concluirCasoSemMensagem`, aqui um spy; o SQL dela fica para o teste com banco.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getRequestPool } from "@/lib/agent-engine/db/request-pool";
import { concluirCasoSemMensagem } from "@/lib/agent-engine/agent/human-cases";
import { enqueueJob } from "@/lib/agent-engine/queue/queue";
import { audit } from "@/lib/audit";
import { fail } from "@/lib/api/wrappers";
import { ROLE_RANK, type AuthUser, type Role } from "@/lib/auth/types";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn(async () => null) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/agent-engine/db/request-pool", () => ({ getRequestPool: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/agent-engine/agent/human-cases", () => ({ concluirCasoSemMensagem: vi.fn(async () => true) }));
vi.mock("@/lib/agent-engine/queue/queue", () => ({ enqueueJob: vi.fn() }));

const ORG_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const CASE_ID = "33333333-3333-4333-8333-333333333333";
const CONV_ID = "44444444-4444-4444-8444-444444444444";

function session(effectiveRole: Role) {
  const user: AuthUser = {
    id: USER_ID, email: "u@example.com", full_name: null, avatar_url: null, is_platform_admin: false,
    idioma: "pt-BR" as const,
    organizations: [{ organization_id: ORG_ID, organization_name: "Org", role: effectiveRole }],
  };
  vi.mocked(requireRole).mockImplementation(async (min: Role) => {
    if (ROLE_RANK[effectiveRole] >= ROLE_RANK[min]) {
      return { ok: true, user, org: { orgId: ORG_ID, name: "Org", role: effectiveRole } };
    }
    return { ok: false, response: fail("forbidden_role", `Requer role >= ${min}.`, 403, {}) };
  });
}

function pool(rows: Array<{ status: string }>) {
  const query = vi.fn(async () => ({ rows, rowCount: rows.length }));
  vi.mocked(getRequestPool).mockReturnValue({ query } as unknown as ReturnType<typeof getRequestPool>);
  return query;
}

const post = (body?: unknown) =>
  new NextRequest(`http://localhost/api/v1/ai/cases/${CASE_ID}/concluir`, {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const params = (id = CASE_ID) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(concluirCasoSemMensagem).mockResolvedValue(true);
});

describe("POST /api/v1/ai/cases/:id/concluir", () => {
  it("fecha o caso sem nota e sem mandar nada ao cliente", async () => {
    session("agent");
    pool([{ status: "awaiting_human" }]);
    const { POST } = await import("@/app/api/v1/ai/cases/[id]/concluir/route");
    const res = await POST(post(), params());
    expect(res.status).toBe(200);
    expect(concluirCasoSemMensagem).toHaveBeenCalledWith(expect.anything(), ORG_ID, CASE_ID, USER_ID, null);
    expect(enqueueJob).not.toHaveBeenCalled();
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ case_action: "concluido_sem_mensagem" }) }),
    );
  });

  it("aceita nota interna opcional", async () => {
    session("agent");
    pool([{ status: "awaiting_lead" }]);
    const { POST } = await import("@/app/api/v1/ai/cases/[id]/concluir/route");
    const res = await POST(post({ note: "Respondi no Inbox" }), params());
    expect(res.status).toBe(200);
    expect(concluirCasoSemMensagem).toHaveBeenCalledWith(expect.anything(), ORG_ID, CASE_ID, USER_ID, "Respondi no Inbox");
  });

  it("caso já fechado devolve 409", async () => {
    session("agent");
    pool([{ status: "resolved" }]);
    vi.mocked(concluirCasoSemMensagem).mockResolvedValue(false);
    const { POST } = await import("@/app/api/v1/ai/cases/[id]/concluir/route");
    const res = await POST(post(), params());
    expect(res.status).toBe(409);
  });

  it("caso de outra org (ou inexistente) devolve 404", async () => {
    session("agent");
    pool([]);
    const { POST } = await import("@/app/api/v1/ai/cases/[id]/concluir/route");
    const res = await POST(post(), params());
    expect(res.status).toBe(404);
    expect(concluirCasoSemMensagem).not.toHaveBeenCalled();
  });

  it("viewer é barrado (403)", async () => {
    session("viewer");
    pool([{ status: "awaiting_human" }]);
    const { POST } = await import("@/app/api/v1/ai/cases/[id]/concluir/route");
    const res = await POST(post(), params());
    expect(res.status).toBe(403);
    expect(concluirCasoSemMensagem).not.toHaveBeenCalled();
  });

  it("campo desconhecido no body é recusado (422)", async () => {
    session("agent");
    pool([{ status: "awaiting_human" }]);
    const { POST } = await import("@/app/api/v1/ai/cases/[id]/concluir/route");
    const res = await POST(post({ action: "resolved" }), params());
    expect(res.status).toBe(422);
  });
});

describe("GET /api/v1/ai/cases — abas do fork", () => {
  function admin() {
    const inCalls: Array<[string, unknown]> = [];
    const chain = {
      select: () => chain, eq: () => chain, order: () => chain,
      in: (col: string, val: unknown) => { inCalls.push([col, val]); return chain; },
      then: (f: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null, count: 0 }).then(f),
    };
    vi.mocked(createAdminClient).mockReturnValue({ from: () => chain } as unknown as ReturnType<typeof createAdminClient>);
    return inCalls;
  }
  function sessao() {
    const c: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "order", "limit"]) c[m] = () => c;
    c.then = (f: (v: unknown) => unknown) => Promise.resolve({ data: [{ id: CONV_ID, conversation_id: CONV_ID }], error: null }).then(f);
    vi.mocked(createClient).mockResolvedValue({ from: () => c } as unknown as Awaited<ReturnType<typeof createClient>>);
  }

  it.each([
    ["waiting", ["awaiting_human"]],
    ["answered", ["awaiting_lead"]],
    ["resolved", ["resolved", "escalated", "cancelled"]],
  ])("status=%s lista só %j", async (status, esperado) => {
    session("agent");
    sessao();
    const inCalls = admin();
    const { GET } = await import("@/app/api/v1/ai/cases/route");
    const res = await GET(new NextRequest(`http://localhost/api/v1/ai/cases?status=${status}`));
    expect(res.status).toBe(200);
    const primeiroFiltro = inCalls.find(([col]) => col === "status");
    expect(primeiroFiltro?.[1]).toEqual(esperado);
    const body = (await res.json()) as { data: Record<string, unknown> };
    expect(body.data).toHaveProperty("waiting_count");
    expect(body.data).toHaveProperty("answered_count");
  });
});
