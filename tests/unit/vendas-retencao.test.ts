import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  env: {
    INTERNAL_CRON_SECRET: "segredo",
    INTERNAL_SECRET: "",
    WEBHOOK_LOG_BODY_RETENTION_DAYS: "",
    WEBHOOK_LOG_ROW_RETENTION_DAYS: "",
    LEAD_CAPTURE_RETENTION_DAYS: "",
  },
}));
const av = vi.hoisted(() => ({ audit: vi.fn(async () => undefined), captureException: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: av.audit }));
vi.mock("@sentry/nextjs", () => ({ captureException: av.captureException }));
vi.mock("@/lib/channels/retencao-do-arquivo", () => ({
  LOTE_PADRAO: 500,
  ErroAoApagarLinhasVelhas: class extends Error {},
  podarArquivoDeWebhooks: async () => ({ esvaziadas: 0, apagadas: 0, temMais: false }),
}));
vi.mock("@/lib/webhooks/retencao-da-captacao", () => ({
  podarHistoricoDeCaptacao: async () => ({ apagadas: 0, temMais: false, diasAplicados: 365 }),
}));
const h = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: h.rpc }) }));

import { DIAS_DOS_DADOS_DA_VENDA, limparDadosDasVendas } from "@/lib/vendas/retencao";

beforeEach(() => {
  h.rpc.mockReset();
  av.audit.mockClear();
  av.captureException.mockClear();
});

describe("limparDadosDasVendas", () => {
  it("chama a função do banco com 30 dias e o lote; devolve quantas limpou", async () => {
    h.rpc.mockResolvedValue({ data: 3, error: null });
    expect(await limparDadosDasVendas({ rpc: h.rpc } as never, 50)).toBe(3);
    expect(DIAS_DOS_DADOS_DA_VENDA).toBe(30);
    expect(h.rpc).toHaveBeenCalledWith("fn_vendas_limpar_dados_vencidos", { p_dias: 30, p_lote: 50 });
  });

  it("falha do banco sobe com o nome da tabela", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "permission denied" } });
    await expect(limparDadosDasVendas({ rpc: h.rpc } as never, 50)).rejects.toThrow("sales_events: permission denied");
  });
});

describe("o cron de retenção", () => {
  async function chamarCron(): Promise<Response> {
    const { GET } = await import("@/app/api/v1/cron/webhook-log-retention/route");
    return GET({
      url: "http://localhost/api/v1/cron/webhook-log-retention",
      headers: new Headers({ authorization: "Bearer segredo" }),
    } as never);
  }

  it("limpa as vendas no mesmo tique e diz quantas", async () => {
    h.rpc.mockResolvedValue({ data: 2, error: null });
    const res = await chamarCron();
    expect(res.status).toBe(200);
    expect((await res.json()).data.vendas).toEqual({ limpas: 2 });
  });

  it("falha das vendas não derruba a rodada das outras podas", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    const res = await chamarCron();
    expect(res.status).toBe(200);
    expect((await res.json()).data.vendas).toBeNull();
    // F19: o mesmo aviso das outras podas (trilha + Sentry), não só o log.
    expect(av.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "retention.sweep_run",
        metadata: expect.objectContaining({ poda: "sales_events", falhou: true }),
      }),
    );
    await vi.waitFor(() => expect(av.captureException).toHaveBeenCalledTimes(1));
    expect(av.captureException.mock.calls[0]?.[1]).toMatchObject({ tags: { subsystem: "retencao", poda: "sales_events" } });
  });
});
