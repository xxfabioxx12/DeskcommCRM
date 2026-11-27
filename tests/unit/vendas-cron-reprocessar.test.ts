import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  rodada: vi.fn(),
  audit: vi.fn(async () => undefined),
  autoriza: vi.fn(() => true),
  sentry: vi.fn(),
}));

vi.mock("@/lib/auth/cron-auth", () => ({ autorizaCron: h.autoriza }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/vendas/banco", () => ({ bancoDaVenda: () => ({}) }));
vi.mock("@/lib/vendas/reprocessar", () => ({ reprocessarPendentes: h.rodada }));
vi.mock("@/lib/audit", () => ({ audit: h.audit }));
vi.mock("@sentry/nextjs", () => ({ captureException: h.sentry }));

import { GET } from "@/app/api/v1/cron/vendas-reprocessar/route";

const pedido = () => new NextRequest("http://localhost/api/v1/cron/vendas-reprocessar");
const VAZIA = { tentadas: 0, processadas: 0, falharam: 0, outras: 0, encerradas: 0 };

beforeEach(() => {
  h.rodada.mockReset().mockResolvedValue(VAZIA);
  h.audit.mockClear();
  h.autoriza.mockReset().mockReturnValue(true);
  h.sentry.mockClear();
});

describe("cron vendas-reprocessar", () => {
  it("sem o segredo do cron: 403 e nada roda", async () => {
    h.autoriza.mockReturnValue(false);
    expect((await GET(pedido())).status).toBe(403);
    expect(h.rodada).not.toHaveBeenCalled();
  });

  it("rodada vazia: 200 e sem trilha", async () => {
    const res = await GET(pedido());
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual(VAZIA);
    expect(h.audit).not.toHaveBeenCalled();
  });

  it("rodada que tentou: 200 e uma linha de trilha", async () => {
    h.rodada.mockResolvedValue({ ...VAZIA, tentadas: 2, processadas: 2 });
    expect((await GET(pedido())).status).toBe(200);
    expect(h.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "sales_event.retry_run", organizationId: null, metadata: expect.objectContaining({ tentadas: 2 }) }),
    );
  });

  it("rodada que falha: 500, trilha com falhou e Sentry", async () => {
    h.rodada.mockRejectedValue(new Error("sales_events: timeout"));
    const res = await GET(pedido());
    expect(res.status).toBe(500);
    expect(h.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "sales_event.retry_run",
        metadata: expect.objectContaining({ falhou: true, erro: "sales_events: timeout" }),
      }),
    );
    await vi.waitFor(() => expect(h.sentry).toHaveBeenCalled());
  });
});
