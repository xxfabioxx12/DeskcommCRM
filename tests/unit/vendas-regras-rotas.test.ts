import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  gravada: { id: "r1", trigger_event: "contact.tag_added", trigger_config: {}, actions: [] as unknown[] },
  conexao: null as unknown,
  consultas: [] as Array<{ tabela: string; metodo: string; args: unknown[] }>,
  cadeia(tabela: string): unknown {
    const resultado = () => ({
      data: tabela === "automation_rules" ? h.gravada : tabela === "webhook_sources" ? h.conexao : null,
      error: null,
    });
    const proxy: unknown = new Proxy(function cadeiaFalsa() {}, {
      get(_alvo, prop) {
        if (prop === "then") return (ok: (v: unknown) => unknown) => Promise.resolve(resultado()).then(ok);
        if (prop === "maybeSingle" || prop === "single") return async () => resultado();
        return (...args: unknown[]) => {
          h.consultas.push({ tabela, metodo: String(prop), args });
          return proxy;
        };
      },
    });
    return proxy;
  },
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: (t: string) => h.cadeia(t) }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: async () => ({ data: null, error: null }) }) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined), isServiceRoleConfigured: () => true }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: async () => null }));
vi.mock("@/lib/auth/require-role", () => ({
  requireRole: async () => ({ ok: true, user: { id: "u-1", idioma: "pt-BR" }, org: { orgId: "org-1", role: "manager" } }),
}));

import { POST } from "@/app/api/v1/automation-rules/route";
import { PATCH } from "@/app/api/v1/automation-rules/[id]/route";
import { MENSAGEM_DA_VENDA_FORA_DO_GATILHO } from "@/lib/schemas/webhooks";

const CONEXAO = "66666666-6666-4666-8666-666666666666";
const json = (url: string, method: string, corpo: unknown) =>
  new NextRequest(url, { method, body: JSON.stringify(corpo), headers: { "content-type": "application/json" } });

beforeEach(() => {
  h.consultas.length = 0;
  h.conexao = null;
});

describe("rotas das regras com a venda", () => {
  it("POST: conexão de outra empresa (ou que não é de venda) é recusada", async () => {
    const res = await POST(
      json("http://localhost/api/v1/automation-rules", "POST", {
        name: "Comprou",
        trigger_event: "sale.received",
        actions: [{ type: "add_tag", config: { tags: ["comprou"] } }],
        trigger_config: { conexao_id: CONEXAO },
      }),
    );
    expect(res.status).toBe(422);
    expect((await res.json()).error.message).toBe("A conexão escolhida não pertence a esta empresa.");
    expect(h.consultas).toContainEqual({ tabela: "webhook_sources", metodo: "in", args: ["kind", ["hotmart", "kiwify", "kookie", "personalizada"]] });
  });

  it("PATCH só das ações num gatilho que não é de venda: {{venda.x}} recusada", async () => {
    const res = await PATCH(
      json("http://localhost/api/v1/automation-rules/r1", "PATCH", {
        actions: [{ type: "set_field", config: { destino: "contato", campo: "x", valor: "{{venda.produto}}" } }],
      }),
      { params: Promise.resolve({ id: "r1" }) },
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toBe(MENSAGEM_DA_VENDA_FORA_DO_GATILHO);
  });
});
