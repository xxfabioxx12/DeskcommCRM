import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  fonte: null as Record<string, unknown> | null,
  permitido: true,
  segredo: "segredo" as string | null,
  filtros: [] as unknown[][],
  recusa: vi.fn(async () => undefined),
  receber: vi.fn(
    async (): Promise<{ duplicate: boolean; status: string; motivo: string | null; salesEventId: string | null }> => ({
      duplicate: false,
      status: "processado",
      motivo: null,
      salesEventId: "ev-1",
    }),
  ),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => {
      const c: Record<string, unknown> = {};
      c.select = () => c;
      c.eq = (...a: unknown[]) => {
        h.filtros.push(["eq", ...a]);
        return c;
      };
      c.in = (...a: unknown[]) => {
        h.filtros.push(["in", ...a]);
        return c;
      };
      c.maybeSingle = async () => ({ data: h.fonte, error: null });
      return c;
    },
  }),
}));
vi.mock("@/lib/ai/dispatcher/rate-limit", () => ({ checkRateLimit: async () => ({ allowed: h.permitido }) }));
vi.mock("@/lib/webhooks/secrets", () => ({ decryptWebhookSecret: async () => h.segredo }));
vi.mock("@/lib/vendas/banco", () => ({ bancoDaVenda: () => ({ registrarRecusa: h.recusa }) }));
vi.mock("@/lib/vendas/receber", () => ({ receberVenda: h.receber }));

import { GET, HEAD, POST } from "@/app/api/v1/webhooks/vendas/[token]/route";

const TOKEN = "token-da-conexao-0001";
const HOTMART = { id: "conexao-1", organization_id: "org-1", kind: "hotmart", config: { dispara: true }, secret_encrypted: "\\xc30d", is_active: true };
const CORPO = JSON.stringify({ id: "hm-evt-0001", event: "PURCHASE_APPROVED", data: {} });

function requisicao(corpo: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`http://localhost/api/v1/webhooks/vendas/${TOKEN}`, { method: "POST", body: corpo, headers });
}
const enviar = (req: NextRequest, token = TOKEN) => POST(req, { params: Promise.resolve({ token }) });

beforeEach(() => {
  h.fonte = { ...HOTMART };
  h.permitido = true;
  h.segredo = "segredo";
  h.filtros.length = 0;
  h.recusa.mockClear();
  h.receber.mockReset().mockResolvedValue({ duplicate: false, status: "processado", motivo: null, salesEventId: "ev-1" });
});

describe("rota pública das vendas", () => {
  it("GET e HEAD respondem 200 (sonda da Kiwify)", async () => {
    expect((await GET()).status).toBe(200);
    expect(await (await GET()).json()).toEqual({ status: "ok" });
    expect((await HEAD()).status).toBe(200);
  });

  it("token curto, conexão desconhecida, inativa ou de captação: 404", async () => {
    expect((await enviar(requisicao(CORPO), "curto")).status).toBe(404);
    h.fonte = null;
    expect((await enviar(requisicao(CORPO))).status).toBe(404);
    expect(h.filtros).toContainEqual(["in", "kind", ["hotmart", "kiwify", "kookie", "personalizada"]]);
    h.fonte = { ...HOTMART, is_active: false };
    expect((await enviar(requisicao(CORPO))).status).toBe(404);
    h.fonte = { ...HOTMART, kind: "lead_capture" };
    expect((await enviar(requisicao(CORPO))).status).toBe(404);
    expect(h.receber).not.toHaveBeenCalled();
  });

  it("limite de taxa: 429", async () => {
    h.permitido = false;
    expect((await enviar(requisicao(CORPO))).status).toBe(429);
  });

  it("content-length acima de 512 KB: 413 sem ler", async () => {
    const res = await enviar(requisicao(CORPO, { "content-length": String(600 * 1024) }));
    expect(res.status).toBe(413);
    expect(h.receber).not.toHaveBeenCalled();
  });

  it("corpo acima de 512 KB sem content-length: 413 e nada registrado", async () => {
    const req = requisicao(JSON.stringify({ x: "a".repeat(600 * 1024) }), { "X-HOTMART-HOTTOK": "segredo" });
    expect(req.headers.get("content-length")).toBeNull();
    expect((await enviar(req)).status).toBe(413);
    expect(h.receber).not.toHaveBeenCalled();
    expect(h.recusa).not.toHaveBeenCalled();
  });

  it("hottok errado: 401, recusa registrada (sem payload), nada roda", async () => {
    const res = await enviar(requisicao(CORPO, { "X-HOTMART-HOTTOK": "errado" }));
    expect(res.status).toBe(401);
    expect(h.recusa).toHaveBeenCalledWith(
      { id: "conexao-1", organizationId: "org-1", plataforma: "hotmart", config: { dispara: true } },
      "hottok não confere",
    );
    expect(h.receber).not.toHaveBeenCalled();
  });

  it("segredo que não decifra: recusa (falha fechada)", async () => {
    h.segredo = null;
    expect((await enviar(requisicao(CORPO, { "X-HOTMART-HOTTOK": "segredo" }))).status).toBe(401);
    expect(h.recusa).toHaveBeenCalledWith(expect.anything(), "conexão sem hottok salvo");
  });

  it("personalizada sem validação e JSON inválido: 400", async () => {
    h.fonte = { ...HOTMART, kind: "personalizada", secret_encrypted: null, config: {} };
    expect((await enviar(requisicao("{nao é json"))).status).toBe(400);
    expect(h.receber).not.toHaveBeenCalled();
  });

  it("válida: entrega para receberVenda e responde received; repetida responde duplicate", async () => {
    const res = await enviar(requisicao(CORPO, { "X-HOTMART-HOTTOK": "segredo" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });
    expect(h.receber).toHaveBeenCalledWith(
      expect.anything(),
      { id: "conexao-1", organizationId: "org-1", plataforma: "hotmart", config: { dispara: true } },
      expect.objectContaining({ payload: JSON.parse(CORPO), corpo: CORPO, config: { dispara: true } }),
    );
    h.receber.mockResolvedValue({ duplicate: true, status: "recebido", motivo: null, salesEventId: null });
    expect(await (await enviar(requisicao(CORPO, { "X-HOTMART-HOTTOK": "segredo" }))).json()).toEqual({ received: true, duplicate: true });
  });

  it("segredo gravado e segurança ilegível: 401 e recusa registrada, nada roda", async () => {
    h.fonte = { ...HOTMART, kind: "personalizada", config: { seguranca: { modo: "header_igual", header: "não vale!" } } };
    const res = await enviar(requisicao(CORPO, { "X-Webhook-Secret": "segredo" }));
    expect(res.status).toBe(401);
    expect(h.recusa).toHaveBeenCalledWith(expect.anything(), "configuração de segurança ilegível");
    expect(h.receber).not.toHaveBeenCalled();
  });

  it("\\u0000 no JSON (o jsonb recusa): 400 sem registrar", async () => {
    const corpo = '{"id":"hm-1","event":"PURCHASE_APPROVED","data":{"buyer":{"name":"Jo\\u0000ão"}}}';
    const res = await enviar(requisicao(corpo, { "X-HOTMART-HOTTOK": "segredo" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toBe("corpo com caractere nulo");
    expect(h.receber).not.toHaveBeenCalled();
    // "\\\\u0000" (barra escapada) é texto comum, não o caractere nulo.
    expect((await enviar(requisicao('{"id":"hm-2","nota":"a\\\\u0000"}', { "X-HOTMART-HOTTOK": "segredo" }))).status).toBe(200);
  });

  it("registro falhou: 500 para a plataforma reentregar", async () => {
    h.receber.mockRejectedValue(new Error("sales_events: conexão caiu"));
    expect((await enviar(requisicao(CORPO, { "X-HOTMART-HOTTOK": "segredo" }))).status).toBe(500);
  });
});
