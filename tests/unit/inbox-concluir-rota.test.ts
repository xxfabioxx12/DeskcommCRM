/**
 * Fork NODZ — POST /api/v1/conversations/:id/concluir (o "Concluir" do Inbox).
 * Fecha a conversa e conclui os casos abertos dela, sem mensagem ao cliente.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { requireRole } from "@/lib/auth/require-role";
import { concluirAtendimento } from "@/lib/inbox/concluir-atendimento";
import { exigirControleDaConversa } from "@/lib/inbox/controle-da-conversa";
import { exigirConversaDoSetor } from "@/lib/inbox/recorte-do-setor";
import { ApiError } from "@/lib/api/types";
import { createClient } from "@/lib/supabase/server";

import { fail } from "@/lib/api/wrappers";
import { ROLE_RANK, type AuthUser, type Role } from "@/lib/auth/types";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn(async () => null) }));
vi.mock("@/lib/inbox/concluir-atendimento", () => ({ concluirAtendimento: vi.fn() }));
vi.mock("@/lib/inbox/controle-da-conversa", () => ({ exigirControleDaConversa: vi.fn() }));
vi.mock("@/lib/inbox/recorte-do-setor", () => ({ exigirConversaDoSetor: vi.fn(async () => null) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/agent-engine/db/request-pool", () => ({ getRequestPool: vi.fn(() => ({})) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));


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
const req = () => new NextRequest(`http://localhost/api/v1/conversations/${CONV}/concluir`, { method: "POST" });
const params = { params: Promise.resolve({ id: CONV }) };

beforeEach(() => { vi.clearAllMocks(); vi.mocked(concluirAtendimento).mockResolvedValue({ conversation_closed: true, cases_resolved: 1 });
vi.mocked(exigirControleDaConversa).mockResolvedValue(undefined);
vi.mocked(exigirConversaDoSetor).mockResolvedValue(null); });

describe("POST /api/v1/conversations/:id/concluir", () => {
  it("conversa aberta: fecha a conversa e conclui os casos", async () => {
    session("agent"); conversa({ id: CONV, organization_id: ORG, service_revision: 7, status: "open" });
    
    const { POST } = await import("@/app/api/v1/conversations/[id]/concluir/route");
    const res = await POST(req(), params);
    expect(res.status).toBe(200);
    expect(concluirAtendimento).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ organizationId: ORG, conversationId: CONV, actorUserId: USER, expectedRevision: 7 }));
    const body = (await res.json()) as { data: { conversation_closed: boolean; cases_resolved: number } };
    expect(body.data).toEqual({ conversation_closed: true, cases_resolved: 1 });
  });

  it("conversa já fechada: não mexe nela, só conclui o caso preso", async () => {
    session("agent"); conversa({ id: CONV, organization_id: ORG, service_revision: 7, status: "closed" });
    
    const { POST } = await import("@/app/api/v1/conversations/[id]/concluir/route");
    const res = await POST(req(), params);
    expect(res.status).toBe(200);
    expect(concluirAtendimento).toHaveBeenCalled();
  });

  it("revisão mudou: 409 e o caso NÃO é concluído", async () => {
    session("agent"); conversa({ id: CONV, organization_id: ORG, service_revision: 7, status: "open" });
    vi.mocked(concluirAtendimento).mockRejectedValueOnce({ code: "PT409" });
    const { POST } = await import("@/app/api/v1/conversations/[id]/concluir/route");
    const res = await POST(req(), params);
    expect(res.status).toBe(409);
  });

  it("conversa que a pessoa não enxerga: 404", async () => {
    session("agent"); conversa(null);
    const { POST } = await import("@/app/api/v1/conversations/[id]/concluir/route");
    expect((await POST(req(), params)).status).toBe(404);
    expect(concluirAtendimento).not.toHaveBeenCalled();
  });

  it("viewer é barrado", async () => {
    session("viewer"); conversa({ id: CONV, organization_id: ORG, service_revision: 7, status: "open" });
    const { POST } = await import("@/app/api/v1/conversations/[id]/concluir/route");
    expect((await POST(req(), params)).status).toBe(403);
  });
});

it("convidado não ganha autoridade de conclusão", async () => {
 session("agent"); conversa({id: CONV, organization_id: ORG, service_revision: 7, status: "open"});
 vi.mocked(exigirControleDaConversa).mockRejectedValueOnce(new ApiError(403, "forbidden", undefined, "test"));
 const { POST } = await import("@/app/api/v1/conversations/[id]/concluir/route");
 expect((await POST(req(), params)).status).toBe(403);
 expect(concluirAtendimento).not.toHaveBeenCalled();
});
it("outro setor é recusado antes da escrita", async () => {
 session("agent"); vi.mocked(exigirConversaDoSetor).mockResolvedValueOnce(fail("not_found", "x", 404, {}));
 const { POST } = await import("@/app/api/v1/conversations/[id]/concluir/route");
 expect((await POST(req(), params)).status).toBe(404);
 expect(concluirAtendimento).not.toHaveBeenCalled();
});
it("falha transacional nunca responde sucesso", async () => {
 session("agent"); conversa({id: CONV, organization_id: ORG, service_revision: 7, status: "open"});
 vi.mocked(concluirAtendimento).mockRejectedValueOnce(new Error("db"));
 const { POST } = await import("@/app/api/v1/conversations/[id]/concluir/route");
 expect((await POST(req(), params)).status).toBe(500);
});
