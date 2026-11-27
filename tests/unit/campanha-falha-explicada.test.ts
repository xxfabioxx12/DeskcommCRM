/**
 * "Falhou" sozinho não diz nada. A lista de destinatários traz o MOTIVO, em
 * português ou espanhol, tirado do código da plataforma.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ idioma: "pt-BR", linhas: [] as Array<Record<string, unknown>> }));

vi.mock("@/lib/auth/require-role", () => ({
  requireRole: async () => ({ ok: true, org: { orgId: "org-1" }, user: { id: "u-1", idioma: h.idioma } }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from() {
      const b: Record<string, unknown> = {};
      for (const m of ["select", "eq", "order", "limit", "or"]) b[m] = () => b;
      Object.defineProperty(b, "then", {
        value: (ok: (v: unknown) => unknown) => Promise.resolve({ data: h.linhas, error: null }).then(ok),
      });
      return b;
    },
  }),
}));

import { GET } from "@/app/api/v1/campaigns/[id]/recipients/route";

const linha = (over: Record<string, unknown>) => ({
  id: "r-1",
  contact_id: "ct-1",
  channel_session_id: "s-1",
  status: "failed",
  eligibility_status: "eligible",
  exclusion_reason: null,
  sent_at: null,
  delivered_at: null,
  read_at: null,
  replied_at: null,
  opted_out_at: null,
  last_error_code: "131047",
  last_error_detail: "Re-engagement message",
  created_at: "2026-10-20T12:00:00.000Z",
  contacts: { name: "Ana", display_name: null },
  ...over,
});

const pedir = async () => {
  const res = await GET(new NextRequest("http://x/api/v1/campaigns/c-1/recipients"), {
    params: Promise.resolve({ id: "c-1" }),
  });
  return ((await res.json()) as { data: Array<Record<string, unknown>> }).data;
};

beforeEach(() => {
  h.idioma = "pt-BR";
});

describe("GET /api/v1/campaigns/:id/recipients — motivo da falha", () => {
  it("código do webhook vira a frase, e o detalhe cru continua disponível", async () => {
    h.linhas = [linha({})];
    const [d] = await pedir();
    expect(d).toMatchObject({ motivo_da_falha: "Fora das 24 horas: só template", last_error_detail: "Re-engagement message" });
  });
  it("em espanhol para quem usa espanhol", async () => {
    h.idioma = "es";
    h.linhas = [linha({ last_error_code: "send_failed", last_error_detail: "meta_132015: paused" })];
    const [d] = await pedir();
    expect(d?.motivo_da_falha).toBe("Plantilla pausada por Meta");
  });
  it("código desconhecido mostra o texto original; quem não falhou não tem motivo", async () => {
    h.linhas = [
      linha({ last_error_code: "131999", last_error_detail: "Brand new error" }),
      linha({ id: "r-2", status: "sent", last_error_code: null, last_error_detail: null }),
    ];
    const [falhou, enviada] = await pedir();
    expect(falhou?.motivo_da_falha).toBe("Brand new error");
    expect(enviada?.motivo_da_falha).toBeNull();
  });
});
