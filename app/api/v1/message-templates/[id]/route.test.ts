/** PATCH /api/v1/message-templates/[id] — a recusa da reserva chega como mensagem do erro. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({ guard: vi.fn(), apoio: vi.fn() }));

vi.mock("@/lib/auth/require-role", () => ({ requireRole: h.guard }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: h.apoio }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: vi.fn() }) }));

import { PATCH } from "@/app/api/v1/message-templates/[id]/route";

beforeEach(() => {
  vi.resetAllMocks();
  h.guard.mockResolvedValue({
    ok: true,
    user: { id: "u1", idioma: "pt" },
    org: { orgId: "o1", role: "agent" },
  });
  h.apoio.mockResolvedValue(null);
});

describe("PATCH /api/v1/message-templates/[id]", () => {
  it("corpo com reserva: 422 com a frase da reserva como mensagem", async () => {
    const req = new NextRequest("http://localhost/api/v1/message-templates/t1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: 'Oi {{nome|"aluno"}}' }),
    });
    const resposta = await PATCH(req, { params: Promise.resolve({ id: "t1" }) });
    expect(resposta.status).toBe(422);
    expect((await resposta.json()).error.message).toBe(
      "O texto de reserva só funciona no passo Mensagem do fluxo e no Gravar campo.",
    );
  });
});
