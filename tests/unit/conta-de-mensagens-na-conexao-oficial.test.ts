/**
 * A CONTA DE MENSAGENS NA CONEXÃO OFICIAL — grava, valida e devolve.
 *
 * Handler REAL sobre um dublê do banco que aplica filtros e guarda o estado (o
 * mesmo desenho de `nome-interno-sobrevive-a-salvar-a-credencial.test.ts`).
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ linhas: [] as Array<Record<string, unknown>>, validar: vi.fn() }));

vi.mock("@/lib/auth/require-role", () => ({
  requireRole: vi.fn(async () => ({
    ok: true,
    user: { id: "33333333-3333-4333-8333-333333333333", idioma: "pt-BR" },
    org: { orgId: "11111111-1111-4111-8111-111111111111", role: "admin" },
  })),
}));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn(async () => null) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/webhooks/secrets", () => ({
  encryptWebhookSecret: vi.fn(async () => "cifrado"),
  decryptWebhookSecret: vi.fn(async () => null),
}));
vi.mock("@/lib/webhooks/url-publica", () => ({
  basePublicaDaInstalacao: () => "https://crm.test",
  basePublicaDoWebhookMeta: () => "https://crm.test",
}));
vi.mock("@/lib/channels/meta/app", () => ({
  appDaMeta: async () => ({ verifyToken: null, appSecret: null }),
  appDaMetaDoAmbiente: () => ({ verifyToken: null, appSecret: null }),
}));
vi.mock("@/lib/channels/meta/validate-credentials", () => ({ validateMetaCredentials: h.validar }));
vi.mock("@/lib/channels/meta/webhook-da-sessao", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  registrarWebhookDaSessao: vi.fn(async () => null),
}));
vi.mock("@/lib/channels/meta/sem-autorizacao", () => ({
  ultimaRecusaPorAutorizacao: vi.fn(async () => ({ detalhe: "meta_10: x", em: "2026-10-22T15:00:00Z" })),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => dubleDoBanco() }));

import { GET, POST } from "@/app/api/v1/channels/official/route";

const CANAL = "22222222-2222-4222-8222-222222222222";

function dubleDoBanco() {
  return {
    from() {
      const filtros: Array<[string, unknown]> = [];
      let op: "select" | "update" | "insert" = "select";
      let corpo: Record<string, unknown> = {};
      let unica = false;
      let comRetorno = false;
      const casam = () => h.linhas.filter((l) => filtros.every(([c, v]) => (l[c] ?? null) === v));
      const executar = () => {
        if (op === "insert") {
          const nova = { id: CANAL, archived_at: null, webhook_path_token: "tok123456789", ...corpo };
          h.linhas.push(nova);
          return { data: nova, error: null };
        }
        const achadas = casam();
        if (op === "update") {
          for (const l of achadas) Object.assign(l, corpo);
          if (!comRetorno) return { data: null, error: null };
        }
        return { data: unica ? (achadas[0] ?? null) : achadas, error: null };
      };
      const q = {
        select: () => ((comRetorno = true), q),
        eq: (c: string, v: unknown) => (filtros.push([c, v]), q),
        is: (c: string, v: unknown) => (filtros.push([c, v]), q),
        in: () => q,
        order: () => q,
        limit: () => q,
        maybeSingle: () => ((unica = true), q),
        single: () => ((unica = true), q),
        update: (p: Record<string, unknown>) => ((op = "update"), (corpo = p), (comRetorno = false), q),
        insert: (p: Record<string, unknown>) => ((op = "insert"), (corpo = p), q),
        then: (ok: (r: unknown) => unknown, erro?: (e: unknown) => unknown) => Promise.resolve(executar()).then(ok, erro),
      };
      return q;
    },
  };
}

const conectar = (extra: Record<string, unknown> = {}) =>
  POST(
    new NextRequest("https://crm.test/api/v1/channels/official", {
      method: "POST",
      body: JSON.stringify({ phone_number_id: "845199182001279", waba_id: "1604858698014735", token: "t".repeat(30), ...extra }),
    }),
  );

beforeEach(() => {
  h.linhas.length = 0;
  h.validar.mockResolvedValue({ ok: true, displayPhoneNumber: "555181495911", verifiedName: "NODZ" });
});

describe("POST — a conta de mensagens", () => {
  it("⭐ grava a conta informada", async () => {
    const r = await conectar({ messaging_account_id: "1288526903016074" });
    expect(r.status).toBe(200);
    expect(h.linhas[0]!.meta_messaging_account_id).toBe("1288526903016074");
  });

  it("vazia ou ausente grava nulo (a Meta escolhe, como hoje)", async () => {
    await conectar({ messaging_account_id: "" });
    expect(h.linhas[0]!.meta_messaging_account_id).toBeNull();
    h.linhas.length = 0;
    await conectar();
    // Ausente numa conexão nova: a chave nem vai no insert; o banco fica com o nulo.
    expect(h.linhas[0]!.meta_messaging_account_id ?? null).toBeNull();
  });

  it("⭐ F14: reconectar sem a chave não apaga a conta salva; vazia apaga", async () => {
    await conectar({ messaging_account_id: "1288526903016074" });
    await conectar();
    expect(h.linhas).toHaveLength(1);
    expect(h.linhas[0]!.meta_messaging_account_id).toBe("1288526903016074");
    await conectar({ messaging_account_id: "" });
    expect(h.linhas[0]!.meta_messaging_account_id).toBeNull();
  });

  it("com letra: 422 com a frase da conta, e nada é gravado", async () => {
    const r = await conectar({ messaging_account_id: "12a8" });
    expect(r.status).toBe(422);
    expect(JSON.stringify(await r.json())).toContain("O ID da conta de mensagens tem só números.");
    expect(h.linhas).toHaveLength(0);
  });
});

describe("GET — a tela lê a conta", () => {
  it("devolve contaDeMensagensId", async () => {
    await conectar({ messaging_account_id: "1288526903016074" });
    Object.assign(h.linhas[0]!, { organization_id: "11111111-1111-4111-8111-111111111111", provider: "meta_cloud" });
    const r = await GET(new NextRequest("https://crm.test/api/v1/channels/official"));
    const corpo = (await r.json()) as { data: { contaDeMensagensId: string | null } };
    expect(corpo.data.contaDeMensagensId).toBe("1288526903016074");
  });

  it("devolve semAutorizacao da última saída", async () => {
    await conectar();
    Object.assign(h.linhas[0]!, { organization_id: "11111111-1111-4111-8111-111111111111", provider: "meta_cloud" });
    const corpo = (await (await GET(new NextRequest("https://crm.test/api/v1/channels/official"))).json()) as {
      data: { semAutorizacao: { detalhe: string } | null };
    };
    expect(corpo.data.semAutorizacao?.detalhe).toBe("meta_10: x");
  });
});
