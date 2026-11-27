import * as React from "react";
import { NextRequest } from "next/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

beforeAll(() => {
  const proto = window.HTMLElement.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture ??= () => false;
  proto.setPointerCapture ??= () => undefined;
  proto.releasePointerCapture ??= () => undefined;
});

const h = vi.hoisted(() => ({
  linha: null as Record<string, unknown> | null,
  updates: [] as Array<Record<string, unknown>>,
  filtros: [] as Array<[string, unknown]>,
  get: vi.fn(),
  patch: vi.fn(),
}));

vi.mock("@/lib/auth/require-role", () => ({
  requireRole: vi.fn(async () => ({
    ok: true,
    user: { id: "33333333-3333-4333-8333-333333333333", idioma: "pt-BR" },
    org: { orgId: "11111111-1111-4111-8111-111111111111" },
  })),
}));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn(async () => null) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => {
      let corpo: Record<string, unknown> | null = null;
      const q = {
        select: () => q,
        update: (p: Record<string, unknown>) => ((corpo = p), q),
        eq: (c: string, v: unknown) => (h.filtros.push([c, v]), q),
        is: () => q,
        maybeSingle: async () => ({ data: h.linha, error: null }),
        then: (ok: (r: unknown) => unknown) => {
          if (corpo) h.updates.push(corpo);
          return Promise.resolve({ data: h.linha ? [{ id: "c" }] : [], error: null }).then(ok);
        },
      };
      return q;
    },
  }),
}));
vi.mock("@/lib/api/client", () => ({ apiClient: { get: h.get, patch: h.patch } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { GET, PATCH } from "@/app/api/v1/channel-sessions/[id]/resposta-automatica/route";
import { RespostaAutomatica } from "@/components/connections/RespostaAutomatica";

const CANAL = "22222222-2222-4222-8222-222222222222";
const ctx = { params: Promise.resolve({ id: CANAL }) };

beforeEach(() => {
  h.linha = { provider: "meta_cloud", responde_sozinho: null };
  h.updates.length = 0;
  h.filtros.length = 0;
  h.get.mockReset();
  h.patch.mockReset();
});

describe("rota", () => {
  it("GET: oficial nulo = desligado; QR Code nulo = ligado", async () => {
    expect(((await (await GET(new NextRequest("https://x/a"), ctx)).json()) as { data: { ligado: boolean } }).data.ligado).toBe(false);
    h.linha = { provider: "waha", responde_sozinho: null };
    expect(((await (await GET(new NextRequest("https://x/a"), ctx)).json()) as { data: { ligado: boolean } }).data.ligado).toBe(true);
  });

  it("⭐ PATCH grava o valor explícito, filtrado pela organização", async () => {
    const r = await PATCH(new NextRequest("https://x/a", { method: "PATCH", body: JSON.stringify({ ligado: true }) }), ctx);
    expect(r.status).toBe(200);
    expect(h.updates).toEqual([{ responde_sozinho: true }]);
    expect(h.filtros).toContainEqual(["organization_id", "11111111-1111-4111-8111-111111111111"]);
  });

  it("corpo errado: 422; canal de outra empresa: 404", async () => {
    expect((await PATCH(new NextRequest("https://x/a", { method: "PATCH", body: "{}" }), ctx)).status).toBe(422);
    h.linha = null;
    expect((await PATCH(new NextRequest("https://x/a", { method: "PATCH", body: JSON.stringify({ ligado: false }) }), ctx)).status).toBe(404);
  });
});

describe("tela", () => {
  const montar = () =>
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <RespostaAutomatica channelId={CANAL} />
      </QueryClientProvider>,
    );

  it("desligado: diz o que não sai; ligar manda { ligado: true }", async () => {
    h.get.mockResolvedValue({ data: { ligado: false } });
    h.patch.mockResolvedValue({ data: { ligado: true } });
    montar();
    expect(await screen.findByText(/Só sai o que alguém digita no Inbox/)).toBeTruthy();
    await userEvent.click(screen.getByRole("switch", { name: "Responder automaticamente por este número" }));
    expect(h.patch).toHaveBeenCalledWith(`/api/v1/channel-sessions/${CANAL}/resposta-automatica`, { ligado: true });
  });
});
