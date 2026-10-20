/**
 * O CANAL OFICIAL DIRETO PASSA A GERENCIAR OS PRÓPRIOS TEMPLATES.
 *
 * A capacidade (`canManageTemplates: true`) já dizia que sim; o adapter não tinha
 * as operações. Elas são as MESMAS do parceiro Graph-compatível (mesma Cloud API),
 * com a base, o token e a conta (WABA) da conexão oficial.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ waba: "WABA-1" as string | null }));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from() {
      const b: Record<string, unknown> = {};
      for (const m of ["select", "eq", "is"]) b[m] = () => b;
      b.maybeSingle = async () => ({ data: h.waba ? { meta_waba_id: h.waba } : null, error: null });
      return b;
    },
  }),
}));
vi.mock("@/lib/channels/meta/credentials", () => ({ resolveMetaCreds: vi.fn() }));

import { getAdapter } from "@/lib/channels";
import { CHANNEL_PROVIDER_META } from "@/lib/channels/capabilities";
import { resolveMetaCreds } from "@/lib/channels/meta/credentials";
import { metaCloudTemplateOps } from "@/lib/channels/meta/template-ops";

const ESCOPO = { organizationId: "org-1", sessionRef: "PN-1" };
const CREDS = { phoneNumberId: "PN-1", token: "tok-da-tela", graphVersion: "v22.0", source: "session" as const };
const DRAFT = {
  name: "pedido_chegou",
  language: "pt_BR",
  category: "UTILITY" as const,
  components: [{ type: "BODY", text: "Oi {{1}}, chegou.", example: { body_text: [["Ana"]] } }],
};

beforeEach(() => {
  h.waba = "WABA-1";
  vi.stubEnv("META_GRAPH_BASE_URL", "https://graph.example.test");
  vi.mocked(resolveMetaCreds).mockReset().mockResolvedValue(CREDS);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("operações de template do canal oficial", () => {
  it("o adapter do canal oficial expõe as operações", () => {
    expect(getAdapter(CHANNEL_PROVIDER_META).templates).toBe(metaCloudTemplateOps);
  });

  it("cria na coleção da WABA da conexão, com o token da sessão", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ id: "999", status: "PENDING", category: "UTILITY" }), { status: 200 }));
    const r = await metaCloudTemplateOps.create({ ...ESCOPO, draft: DRAFT });
    expect(r.status).toBe("PENDING");
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toBe("https://graph.example.test/v22.0/WABA-1/message_templates");
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer tok-da-tela");
    expect(JSON.parse(String(init?.body))).toEqual(DRAFT);
  });

  it("a recusa da Meta sobe com o texto para o usuário (error_user_msg)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ error: { message: "Invalid parameter", error_user_msg: "Message template already exists" } }),
        { status: 400 },
      ),
    );
    await expect(metaCloudTemplateOps.create({ ...ESCOPO, draft: DRAFT })).rejects.toThrow(
      "meta_template_failed: 400 Message template already exists",
    );
  });

  it("sem credencial e sem conta não chama a Meta", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    vi.mocked(resolveMetaCreds).mockResolvedValue(null);
    await expect(metaCloudTemplateOps.create({ ...ESCOPO, draft: DRAFT })).rejects.toThrow(/meta_not_configured/);
    vi.mocked(resolveMetaCreds).mockResolvedValue(CREDS);
    h.waba = null;
    await expect(metaCloudTemplateOps.create({ ...ESCOPO, draft: DRAFT })).rejects.toThrow(/meta_sem_waba/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("apaga UMA variante: acha o id por nome+idioma e manda o hsm_id", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ id: "777", name: "pedido_chegou", language: "pt_BR" }] }), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }));
    await metaCloudTemplateOps.remove({ ...ESCOPO, name: "pedido_chegou", language: "pt_BR" });
    const [url, init] = fetchSpy.mock.calls[1]!;
    expect(String(url)).toBe(
      "https://graph.example.test/v22.0/WABA-1/message_templates?name=pedido_chegou&hsm_id=777",
    );
    expect(init?.method).toBe("DELETE");
  });
});
