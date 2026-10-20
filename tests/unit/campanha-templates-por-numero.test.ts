/**
 * GET /api/v1/channels/templates?channel_session_id= — os modelos DAQUELE número.
 * Sem o parâmetro, a rota responde como sempre (o seletor da janela fechada e a
 * tela de Templates dependem disso).
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CHANNEL_PROVIDER_META, CHANNEL_PROVIDER_ZERNIO } from "@/lib/channels/capabilities";

const h = vi.hoisted(() => ({ linhas: [] as Array<Record<string, unknown>>, sessao: null as unknown, tabelas: [] as string[] }));

vi.mock("@/lib/auth/require-role", () => ({
  requireRole: async () => ({ ok: true, org: { orgId: "org-1" }, user: { id: "u-1", idioma: "pt-BR" } }),
}));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: async () => null }));
vi.mock("@/lib/channels/meta/session", () => ({ metaSessionForOrg: async () => ({ wabaId: "WABA-1" }) }));
vi.mock("@/lib/channels/meta/credentials", () => ({ resolveMetaCreds: vi.fn() }));
vi.mock("@/lib/channels/meta/template-sync", () => ({ syncTemplates: vi.fn() }));
vi.mock("@/lib/channels/meta/webhook", () => ({ normalizeRejectedReason: (r: unknown) => r ?? null }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from(tabela: string) {
      h.tabelas.push(tabela);
      const b: Record<string, unknown> = {};
      for (const m of ["select", "eq", "order"]) b[m] = () => b;
      b.maybeSingle = async () => ({ data: tabela === "channel_sessions" ? h.sessao : null, error: null });
      Object.defineProperty(b, "then", {
        value: (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) =>
          Promise.resolve({ data: tabela === "meta_templates" ? h.linhas : [], error: null }).then(ok, ko),
      });
      return b;
    },
  }),
}));

import { GET } from "@/app/api/v1/channels/templates/route";

const OFICIAL = "11111111-1111-4111-8111-111111111111";
const PARCEIRO = "22222222-2222-4222-8222-222222222222";

const linha = (name: string, channel_session_id: string | null, waba_id: string | null) => ({
  name,
  language: "pt_BR",
  status: "APPROVED",
  category: "MARKETING",
  rejected_reason: null,
  quality_score: null,
  parameter_format: "POSITIONAL",
  contract_hash: `h-${name}`,
  components: [{ type: "BODY", text: "Oi {{1}}" }],
  synced_at: "2026-10-20T00:00:00.000Z",
  saved_values: {},
  channel_session_id,
  waba_id,
});

const pedir = async (qs = "") => {
  const res = await GET(new NextRequest(`http://localhost/api/v1/channels/templates${qs}`));
  return { status: res.status, corpo: (await res.json()) as { data?: { templates: Array<{ name: string }> } } };
};

beforeEach(() => {
  h.tabelas = [];
  h.linhas = [linha("boas_vindas", null, "WABA-1"), linha("promo", null, "WABA-2"), linha("do_parceiro", PARCEIRO, null)];
});

describe("GET /api/v1/channels/templates", () => {
  it("sem o parâmetro: todas as linhas da organização, sem consultar conexão (como hoje)", async () => {
    const { status, corpo } = await pedir();
    expect(status).toBe(200);
    expect(corpo.data?.templates.map((t) => t.name)).toEqual(["boas_vindas", "promo", "do_parceiro"]);
    expect(h.tabelas).not.toContain("channel_sessions");
  });
  it("número oficial recebe as linhas sem conexão da sua conta", async () => {
    h.sessao = { provider: CHANNEL_PROVIDER_META, meta_waba_id: "WABA-1" };
    const { corpo } = await pedir(`?channel_session_id=${OFICIAL}`);
    expect(corpo.data?.templates.map((t) => t.name)).toEqual(["boas_vindas"]);
  });
  it("número de parceiro recebe só as linhas dele", async () => {
    h.sessao = { provider: CHANNEL_PROVIDER_ZERNIO, meta_waba_id: null };
    const { corpo } = await pedir(`?channel_session_id=${PARCEIRO}`);
    expect(corpo.data?.templates.map((t) => t.name)).toEqual(["do_parceiro"]);
  });
  it("parâmetro inválido é 422; conexão de outra organização é 404", async () => {
    expect((await pedir("?channel_session_id=nao-e-uuid")).status).toBe(422);
    h.sessao = null;
    expect((await pedir(`?channel_session_id=${OFICIAL}`)).status).toBe(404);
  });
});
