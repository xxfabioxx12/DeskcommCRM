/**
 * Fork NODZ — POST /api/v1/conversations/:id/concluir (o "Concluir" do Inbox).
 * Fecha a conversa e conclui os casos abertos dela, sem mensagem ao cliente.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { concluirCasosDaConversa } from "@/lib/agent-engine/agent/human-cases";
import { fail } from "@/lib/api/wrappers";
import { ROLE_RANK, type AuthUser, type Role } from "@/lib/auth/types";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn(async () => null) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/agent-engine/db/request-pool", () => ({ getRequestPool: vi.fn(() => ({})) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/agent-engine/agent/human-cases", () => ({ concluirCasosDaConversa: vi.fn(async () => 1) }));

const ORG = "22222222-2222-4222-8222-222222222222";
const USER = "11111111-1111-4111-8111-111111111111";
const CONV = "44444444-4444-4444-8444-444444444444";

function session(role: Role) {
  const user: AuthUser = { id: USER, email: "u@x.com", full_name: null, avatar_url: null, is_platform_admin: false,
    idioma: "pt-BR" as const, organizations: [{ organization_id: ORG, organization_name: "Org", role }] };
  vi.mocked(requireRole).mockImplementation(async (min: Role) =>
    ROLE_RANK[role] >= ROLE_RANK[min]
      ? { ok: true, user, org: { orgId: ORG, name: "Org", role } }
      : { ok: false, response: fail("forbidden_role", "x", 403, {}) });
}
function conversa(row: Record<string, unknown> | null) {
  const c: Record<string, unknown> = {};
  for (const m of ["select", "eq"]) c[m] = () => c;
  c.maybeSingle = async () => ({ data: row, error: null });
  vi.mocked(createClient).mockResolvedValue({ from: () => c } as unknown as Awaited<ReturnType<typeof createClient>>);
}
function rpc(error: { code: string; message: string } | null = null) {
  const fn = vi.fn(async () => ({ data: {}, error }));
  vi.mocked(createAdminClient).mockReturnValue({ rpc: fn } as unknown as ReturnType<typeof createAdminClient>);
  return fn;
}
const req = () => new NextRequest(`http://localhost/api/v1/conversations/${CONV}/concluir`, { method: "POST" });
const params = { params: Promise.resolve({ id: CONV }) };

beforeEach(() => { vi.clearAllMocks(); vi.mocked(concluirCasosDaConversa).mockResolvedValue(1); });

describe("POST /api/v1/conversations/:id/concluir", () => {
  it("conversa aberta: fecha a conversa e conclui os casos", async () => {
    session("agent"); conversa({ id: CONV, organization_id: ORG, service_revision: 7, status: "open" });
    const r = rpc();
    const { POST } = await import("@/app/api/v1/conversations/[id]/concluir/route");
    const res = await POST(req(), params);
    expect(res.status).toBe(200);
    expect(r).toHaveBeenCalledWith("fn_service_status", expect.objectContaining({ p_status: "closed", p_expected: 7 }));
    expect(concluirCasosDaConversa).toHaveBeenCalledWith(expect.anything(), ORG, CONV, USER);
    const body = (await res.json()) as { data: { conversation_closed: boolean; cases_resolved: number } };
    expect(body.data).toEqual({ conversation_closed: true, cases_resolved: 1 });
  });

  it("conversa já fechada: não mexe nela, só conclui o caso preso", async () => {
    session("agent"); conversa({ id: CONV, organization_id: ORG, service_revision: 7, status: "closed" });
    const r = rpc();
    const { POST } = await import("@/app/api/v1/conversations/[id]/concluir/route");
    const res = await POST(req(), params);
    expect(res.status).toBe(200);
    expect(r).not.toHaveBeenCalled();
    expect(concluirCasosDaConversa).toHaveBeenCalled();
  });

  it("revisão mudou: 409 e o caso NÃO é concluído", async () => {
    session("agent"); conversa({ id: CONV, organization_id: ORG, service_revision: 7, status: "open" });
    rpc({ code: "PT409", message: "stale" });
    const { POST } = await import("@/app/api/v1/conversations/[id]/concluir/route");
    const res = await POST(req(), params);
    expect(res.status).toBe(409);
    expect(concluirCasosDaConversa).not.toHaveBeenCalled();
  });

  it("conversa que a pessoa não enxerga: 404", async () => {
    session("agent"); conversa(null); rpc();
    const { POST } = await import("@/app/api/v1/conversations/[id]/concluir/route");
    expect((await POST(req(), params)).status).toBe(404);
    expect(concluirCasosDaConversa).not.toHaveBeenCalled();
  });

  it("viewer é barrado", async () => {
    session("viewer"); conversa({ id: CONV, organization_id: ORG, service_revision: 7, status: "open" }); rpc();
    const { POST } = await import("@/app/api/v1/conversations/[id]/concluir/route");
    expect((await POST(req(), params)).status).toBe(403);
  });
});
