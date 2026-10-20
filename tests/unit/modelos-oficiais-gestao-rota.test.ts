/**
 * POST /api/v1/channels/templates — criar, editar e apagar template do canal
 * oficial. O corpo vazio continua sendo "sincronizar".
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as GestaoDeModelos from "@/lib/channels/gestao-de-modelos";
import type * as TemplateSync from "@/lib/channels/meta/template-sync";

const h = vi.hoisted(() => ({
  ops: null as null | Record<string, ReturnType<typeof vi.fn>>,
  gestao: vi.fn(),
  sync: vi.fn(),
  audit: vi.fn(),
  upserts: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/auth/require-role", () => ({
  requireRole: async () => ({ ok: true, org: { orgId: "org-1" }, user: { id: "u-1", idioma: "pt-BR" } }),
}));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: async () => null }));
vi.mock("@/lib/audit", () => ({ audit: h.audit }));
vi.mock("@/lib/channels/meta/session", () => ({
  metaSessionForOrg: async () => ({ id: "s-1", organizationId: "org-1", wabaId: "WABA-1", phoneNumberId: "PN-1" }),
}));
vi.mock("@/lib/channels/meta/credentials", () => ({
  resolveMetaCreds: async () => ({ phoneNumberId: "PN-1", token: "tok", graphVersion: "v22.0", source: "session" }),
}));
vi.mock("@/lib/channels/meta/webhook", () => ({ normalizeRejectedReason: (r: unknown) => r ?? null }));
vi.mock("@/lib/channels/meta/template-sync", async (original) => ({
  ...(await original<typeof TemplateSync>()),
  syncTemplates: h.sync,
}));
vi.mock("@/lib/channels/modelos-do-canal", () => ({ opsDeModelosDaContaOficial: () => h.ops }));
vi.mock("@/lib/channels/gestao-de-modelos", async (original) => ({
  ...(await original<typeof GestaoDeModelos>()),
  executarGestao: h.gestao,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from() {
      const b: Record<string, unknown> = {};
      for (const m of ["select", "eq", "order"]) b[m] = () => b;
      b.upsert = async (linha: Record<string, unknown>) => {
        h.upserts.push(linha);
        return { error: null };
      };
      Object.defineProperty(b, "then", {
        value: (ok: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok),
      });
      return b;
    },
  }),
}));

import { GET, POST } from "@/app/api/v1/channels/templates/route";

const pedir = (corpo?: unknown) =>
  POST(
    new NextRequest("http://localhost/api/v1/channels/templates", {
      method: "POST",
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    }),
  );

const CRIAR = {
  acao: "criar",
  name: "pedido_chegou",
  language: "pt_BR",
  category: "MARKETING",
  corpo: "Oi {{1}}, seu pedido chegou.",
  exemplos: ["Ana"],
  respostasRapidas: ["Quero ver"],
};

beforeEach(() => {
  vi.clearAllMocks();
  h.upserts = [];
  h.ops = {
    create: vi.fn(async () => ({
      name: "",
      language: "",
      status: "PENDING",
      category: "MARKETING",
      components: [],
      rejectedReason: null,
      parameterFormat: null,
    })),
    update: vi.fn(),
    remove: vi.fn(),
    list: vi.fn(),
  };
  h.sync.mockResolvedValue({ inserted: 0, updated: 0, unchanged: 0, disabled: 0 });
  h.gestao.mockResolvedValue({ ok: true, acao: "apagar" });
});

describe("criar", () => {
  it("manda para a Meta e espelha NA HORA como PENDING, na conta oficial", async () => {
    const res = await pedir(CRIAR);
    expect(res.status).toBe(201);
    expect(h.ops!.create).toHaveBeenCalledWith({
      organizationId: "org-1",
      sessionRef: "PN-1",
      draft: {
        name: "pedido_chegou",
        language: "pt_BR",
        category: "MARKETING",
        components: [
          { type: "BODY", text: "Oi {{1}}, seu pedido chegou.", example: { body_text: [["Ana"]] } },
          { type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: "Quero ver" }] },
        ],
      },
    });
    expect(h.upserts[0]).toMatchObject({
      organization_id: "org-1",
      waba_id: "WABA-1",
      name: "pedido_chegou",
      language: "pt_BR",
      status: "PENDING",
      category: "MARKETING",
    });
    expect(h.upserts[0]).not.toHaveProperty("channel_session_id");
    expect(h.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "template.created" }));
  });

  it("formulário inválido é 422 e nada vai para a Meta", async () => {
    for (const troca of [{ exemplos: [] }, { name: "Pedido Novo" }, { category: "AUTHENTICATION" }, { corpo: "{{1}} chegou", exemplos: ["Ana"] }]) {
      const res = await pedir({ ...CRIAR, ...troca });
      expect(res.status).toBe(422);
    }
    expect(h.ops!.create).not.toHaveBeenCalled();
  });

  it("recusa da Meta vira frase em português, e o texto original da Meta vai junto", async () => {
    h.ops!.create!.mockRejectedValue(new Error("meta_template_failed: 400 Message template already exists"));
    const res = await pedir(CRIAR);
    expect(res.status).toBe(502);
    const corpo = (await res.json()) as { error: { message: string; details?: { originalDaMeta?: string } } };
    expect(corpo.error.message).toBe("Já existe um template com este nome e idioma nesta conta. Use outro nome.");
    // A tela mostra "<frase> (Meta: <original>)": um acerto errado da leitura nunca é silencioso.
    expect(corpo.error.details?.originalDaMeta).toBe("Message template already exists");
  });

  it("recusa que não conhecemos volta só com o texto da Meta", async () => {
    h.ops!.create!.mockRejectedValue(new Error("meta_template_failed: 400 Something odd happened"));
    const res = await pedir(CRIAR);
    expect(res.status).toBe(502);
    const corpo = (await res.json()) as { error: { message: string; details?: { originalDaMeta?: string } } };
    expect(corpo.error.message).toBe("Something odd happened");
    expect(corpo.error.details?.originalDaMeta).toBeUndefined();
  });

  it("canal sem gestão de templates é 501", async () => {
    h.ops = null;
    expect((await pedir(CRIAR)).status).toBe(501);
  });
});

describe("editar e apagar", () => {
  it("apagar em uso devolve 409 com onde, e o escopo é a conta oficial", async () => {
    h.gestao.mockResolvedValue({ ok: false, codigo: "em_uso", usos: [{ tipo: "fluxo", nome: "Boas-vindas" }] });
    const res = await pedir({ acao: "apagar", name: "pedido_chegou", language: "pt_BR" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: "template_in_use", details: { usos: ["Follow-up «Boas-vindas»"] } } });
    expect(h.gestao.mock.calls[0]?.[2]).toEqual({ orgId: "org-1", sessionId: "s-1", sessionRef: "PN-1", wabaDoOficial: "WABA-1" });
  });

  it("editar monta os components no servidor e sincroniza depois", async () => {
    h.gestao.mockResolvedValue({ ok: true, acao: "editar" });
    const res = await pedir({ acao: "editar", name: "pedido_chegou", language: "pt_BR", corpo: "Oi {{1}}, chegou.", exemplos: ["Ana"] });
    expect(res.status).toBe(200);
    expect(h.gestao.mock.calls[0]?.[3]).toEqual({
      acao: "editar",
      name: "pedido_chegou",
      language: "pt_BR",
      components: [{ type: "BODY", text: "Oi {{1}}, chegou.", example: { body_text: [["Ana"]] } }],
    });
    expect(h.sync).toHaveBeenCalledTimes(1);
  });
});

describe("compatibilidade", () => {
  it("corpo vazio continua sincronizando", async () => {
    const res = await pedir();
    expect(res.status).toBe(200);
    expect(h.sync).toHaveBeenCalledWith({ organizationId: "org-1", wabaId: "WABA-1", token: "tok", graphVersion: "v22.0" });
  });
  it("o GET diz se a tela pode criar", async () => {
    const res = await GET(new NextRequest("http://localhost/api/v1/channels/templates"));
    expect(((await res.json()) as { data: { podeGerenciar: boolean } }).data.podeGerenciar).toBe(true);
  });
});
