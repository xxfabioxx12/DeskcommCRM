import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  authz: vi.fn(),
  prender: vi.fn(),
  tentar: vi.fn(),
  audit: vi.fn(async () => undefined),
}));

vi.mock("@/lib/auth/require-role", () => ({ requireRole: h.authz }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: async () => null }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/vendas/banco", () => ({ bancoDaVenda: () => ({ prenderPeloBotao: h.prender }) }));
vi.mock("@/lib/vendas/reprocessar", () => ({ tentarDeNovo: h.tentar }));
vi.mock("@/lib/audit", () => ({ audit: h.audit }));

import { POST } from "@/app/api/v1/eventos-de-venda/[id]/tentar-de-novo/route";

const ID = "66666666-6666-4666-8666-666666666666";
const LINHA = { id: ID, organization_id: "org-1", tentativas: 0, status: "recebido" };
const clicar = (id = ID, corpo: unknown = {}) =>
  POST(
    new NextRequest(`http://localhost/api/v1/eventos-de-venda/${id}/tentar-de-novo`, {
      method: "POST",
      body: JSON.stringify(corpo),
      headers: { "content-type": "application/json" },
    }),
    { params: Promise.resolve({ id }) },
  );

beforeEach(() => {
  h.authz.mockReset().mockResolvedValue({ ok: true, user: { id: "u-1", idioma: "pt-BR" }, org: { orgId: "org-1", role: "manager" } });
  h.prender.mockReset().mockResolvedValue(LINHA);
  h.tentar.mockReset().mockResolvedValue({ status: "processado", motivo: null, contactId: "c1" });
  h.audit.mockClear();
});

describe("POST tentar de novo", () => {
  it("só manager: pede manager e devolve a recusa sem tocar na venda", async () => {
    h.authz.mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) });
    expect((await clicar()).status).toBe(403);
    expect(h.authz).toHaveBeenCalledWith("manager", expect.objectContaining({ resource: "webhook_sources" }));
    expect(h.prender).not.toHaveBeenCalled();
  });

  it("só da própria empresa: a organização vem do login, nunca do corpo", async () => {
    await clicar(ID, { organization_id: "outra-org" });
    expect(h.prender).toHaveBeenCalledWith("org-1", ID, expect.any(Date));
  });

  it("zera e tenta na hora: 200 com o desfecho e uma linha de trilha", async () => {
    const res = await clicar();
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ status: "processado", motivo: null });
    expect(h.tentar).toHaveBeenCalledWith(expect.anything(), LINHA, expect.any(Date));
    expect(h.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "sales_event.retry_requested", actorUserId: "u-1", organizationId: "org-1", resourceId: ID }),
    );
  });

  it("recusa sem dados (limpos em 30 dias ou na anonimização): 409 e não tenta", async () => {
    h.prender.mockResolvedValue("sem_dados");
    const res = await clicar();
    expect(res.status).toBe(409);
    expect(JSON.stringify(await res.json())).toContain("já foram apagados");
    expect(h.tentar).not.toHaveBeenCalled();
  });

  it("não achou: 404; não está falhou: 409; id torto: 400; erro do banco: 500", async () => {
    h.prender.mockResolvedValue("nao_achou");
    expect((await clicar()).status).toBe(404);
    h.prender.mockResolvedValue("nao_falhou");
    expect((await clicar()).status).toBe(409);
    expect((await clicar("nao-e-uuid")).status).toBe(400);
    h.prender.mockRejectedValue(new Error("sales_events: timeout"));
    expect((await clicar()).status).toBe(500);
    expect(h.tentar).not.toHaveBeenCalled();
  });
});
