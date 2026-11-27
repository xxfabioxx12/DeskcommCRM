/**
 * A conexão de venda mora em `webhook_sources` (fork 9003), mas NÃO é fonte de
 * captação: o token dela não abre lead por `/webhooks/in`, ela não aparece em
 * "Receber dados" nem no MCP, e a rota da fonte não a edita.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  fontes: [] as Array<Record<string, unknown>>,
  inseridos: [] as string[],
  /** Mesma régua para os dois clients: aplica `eq` de verdade sobre `h.fontes`. */
  cadeia(tabela: string): unknown {
    const filtros: Array<(l: Record<string, unknown>) => boolean> = [];
    const linhas = () => (tabela === "webhook_sources" ? h.fontes : []).filter((l) => filtros.every((f) => f(l)));
    const proxy: unknown = new Proxy(function cadeiaFalsa() {}, {
      get(_alvo, prop) {
        if (prop === "then") return (ok: (v: unknown) => unknown) => Promise.resolve({ data: linhas(), error: null }).then(ok);
        if (prop === "maybeSingle" || prop === "single") return async () => ({ data: linhas()[0] ?? null, error: null });
        if (prop === "eq") {
          return (coluna: string, valor: unknown) => {
            filtros.push((l) => l[coluna] === valor);
            return proxy;
          };
        }
        if (prop === "insert") {
          return () => {
            h.inseridos.push(tabela);
            return proxy;
          };
        }
        return () => proxy;
      },
    });
    return proxy;
  },
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: (t: string) => h.cadeia(t), rpc: async () => ({ data: null, error: null }) }),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: (t: string) => h.cadeia(t) }) }));
vi.mock("@/lib/ai/dispatcher/rate-limit", () => ({ checkRateLimit: async () => ({ allowed: true }) }));
vi.mock("@/lib/webhooks/secrets", () => ({ decryptWebhookSecret: async () => null, encryptWebhookSecret: async () => null, encryptRuleActionSecrets: async (_c: unknown, a: unknown) => a }));
vi.mock("@/lib/audit", () => ({ audit: async () => undefined }));
vi.mock("@/lib/webhooks/captacao", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  registrarCaptacao: async () => undefined,
}));
vi.mock("@/app/api/v1/leads/_handler", () => ({
  createLeadHandler: async () => {
    throw new Error("passou do portão");
  },
}));
vi.mock("@/lib/dev/kick-local-pipeline", () => ({ kickLocalPipeline: async () => undefined }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: async () => null }));
vi.mock("@/lib/auth/require-role", () => ({
  requireRole: async () => ({ ok: true, user: { id: "u-1", idioma: "pt-BR" }, org: { orgId: "org-1", role: "manager" } }),
}));

import { POST as captar } from "@/app/api/v1/webhooks/in/[token]/route";
import { PATCH as editarFonte } from "@/app/api/v1/webhook-sources/[id]/route";
import { GET as eventosDaFonte } from "@/app/api/v1/webhook-sources/[id]/events/route";
import { POST as criarRegra } from "@/app/api/v1/automation-rules/route";
import { definirEntradaAtiva, listarEntradasAutomaticas } from "@/lib/operacao/entradas-automaticas";

const VENDA_UUID = "11111111-1111-4111-8111-111111111111";
const CAMINHO_DA_FONTE = "token-falso-teste";
const BASE = {
  id: "fonte-1",
  organization_id: "org-1",
  name: "Fonte",
  path_token: CAMINHO_DA_FONTE,
  secret_encrypted: null,
  default_pipeline_id: "pipe-1",
  default_stage_id: "stage-1",
  field_map: {},
  form_fields: [],
  redirect_to: null,
  is_active: true,
  authorize_ai_on_capture: false,
  update_existing_lead_on_capture: false,
};

async function captarCom(kind: string): Promise<Response | Error> {
  h.fontes = [{ ...BASE, kind }];
  const req = new NextRequest(`http://localhost/api/v1/webhooks/in/${CAMINHO_DA_FONTE}`, {
    method: "POST",
    body: JSON.stringify({ nome: "Dora", telefone: "11999998888" }),
    headers: { "content-type": "application/json" },
  });
  return captar(req, { params: Promise.resolve({ token: CAMINHO_DA_FONTE }) }).catch((e: Error) => e);
}

const deps = () => ({
  supabase: h.cadeia as never,
  organizationId: "org-1",
  actor: { type: "user" as const, id: "u-1", role: "manager" as const },
  requestId: "r-1",
});

beforeEach(() => {
  h.inseridos.length = 0;
});

describe("a captação não enxerga conexão de venda", () => {
  it("token de conexão de venda em /webhooks/in: 404, nada gravado", async () => {
    const res = await captarCom("hotmart");
    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(404);
    expect(h.inseridos).not.toContain("webhook_events_log");
  });

  it("CONTROLE: a mesma linha como captação passa do portão", async () => {
    await captarCom("lead_capture");
    expect(h.inseridos).toContain("webhook_events_log");
  });

  it("'Receber dados' e o MCP listam só captação", async () => {
    h.fontes = [{ ...BASE, kind: "lead_capture" }, { ...BASE, id: "venda-1", kind: "kiwify" }];
    const lista = await listarEntradasAutomaticas({ ...deps(), supabase: { from: (t: string) => h.cadeia(t) } as never });
    expect(lista.map((f) => f.id)).toEqual(["fonte-1"]);
  });

  it("ligar/desligar pela operação da captação não alcança a conexão de venda", async () => {
    h.fontes = [{ ...BASE, id: "venda-1", kind: "kiwify" }];
    await expect(
      definirEntradaAtiva({ ...deps(), supabase: { from: (t: string) => h.cadeia(t) } as never }, { id: "venda-1", ativa: false }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("PATCH /webhook-sources/[id] de uma conexão de venda: 404", async () => {
    h.fontes = [{ ...BASE, id: "venda-1", kind: "kookie" }];
    const req = new NextRequest("http://localhost/api/v1/webhook-sources/venda-1", {
      method: "PATCH",
      body: JSON.stringify({ name: "outra" }),
      headers: { "content-type": "application/json" },
    });
    expect((await editarFonte(req, { params: Promise.resolve({ id: "venda-1" }) })).status).toBe(404);
  });

  it("GET /webhook-sources/[id]/events de uma conexão de venda: 404", async () => {
    h.fontes = [{ ...BASE, id: "venda-1", kind: "hotmart" }];
    const req = new NextRequest("http://localhost/api/v1/webhook-sources/venda-1/events");
    expect((await eventosDaFonte(req, { params: Promise.resolve({ id: "venda-1" }) })).status).toBe(404);
  });

  it("regra de automação apontando webhook_source_id de conexão de venda: 422", async () => {
    h.fontes = [{ ...BASE, id: VENDA_UUID, kind: "kiwify" }];
    const req = new NextRequest("http://localhost/api/v1/automation-rules", {
      method: "POST",
      body: JSON.stringify({
        name: "r",
        trigger_event: "lead.created",
        trigger_config: { webhook_source_id: VENDA_UUID },
        actions: [{ type: "add_tag", config: { tags: ["x"] } }],
      }),
      headers: { "content-type": "application/json" },
    });
    expect((await criarRegra(req)).status).toBe(422);
  });
});
