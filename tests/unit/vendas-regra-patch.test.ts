// @vitest-environment node
/**
 * PATCH parcial de uma regra "Venda recebida" que só traz `trigger_config`: o
 * schema não vê o gatilho, então a rota confere os filtros contra o gatilho
 * GRAVADO (ruling F9 da T13). Sem isso, filtro torto vira regra que nunca casa.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const deps = vi.hoisted(() => ({
  gravada: { id: "", trigger_event: "", trigger_config: {}, actions: [] as unknown[] },
  atualizou: false,
}));

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined), isServiceRoleConfigured: () => true }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: async () => null }));
vi.mock("@/lib/auth/require-role", () => ({
  requireRole: async () => ({
    ok: true,
    user: { id: "11111111-1111-4111-8111-111111111111", idioma: "pt-BR" },
    org: { orgId: "22222222-2222-4222-8222-222222222222", role: "manager" },
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => {
      const cadeia = {
        select: () => cadeia,
        eq: () => cadeia,
        update: () => {
          deps.atualizou = true;
          return cadeia;
        },
        maybeSingle: async () => ({ data: deps.gravada, error: null }),
        single: async () => ({ data: deps.gravada, error: null }),
      };
      return cadeia;
    },
  }),
}));

import { PATCH } from "@/app/api/v1/automation-rules/[id]/route";

const REGRA = "33333333-3333-4333-8333-333333333333";

function patch(corpo: unknown) {
  return PATCH(
    new NextRequest(`https://crm.exemplo/api/v1/automation-rules/${REGRA}`, {
      method: "PATCH",
      body: JSON.stringify(corpo),
      headers: { "content-type": "application/json" },
    }),
    { params: Promise.resolve({ id: REGRA }) },
  );
}

beforeEach(() => {
  deps.atualizou = false;
  deps.gravada = {
    id: REGRA,
    trigger_event: "sale.received",
    trigger_config: {},
    actions: [{ type: "add_tag", config: { tags: ["comprou"] } }],
  };
});

describe("PATCH só com trigger_config numa regra de venda", () => {
  it("filtro torto é recusado e nada é gravado", async () => {
    const res = await patch({ trigger_config: { evento: "compra.qualquer" } });
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain("Revise os filtros da venda.");
    expect(deps.atualizou).toBe(false);
  });

  it("filtro válido passa", async () => {
    const res = await patch({ trigger_config: { produto_id: "4455", evento: "compra.aprovada" } });
    expect(res.status).toBe(200);
    expect(deps.atualizou).toBe(true);
  });

  it("CONTROLE: a mesma config numa regra que não é de venda não é conferida", async () => {
    deps.gravada.trigger_event = "contact.tag_added";
    const res = await patch({ trigger_config: { evento: "compra.qualquer" } });
    expect(res.status).toBe(200);
  });
});
