/**
 * A CONTA QUE PAGA VAI EM TODO ENVIO DO NÚMERO OFICIAL (caminho 1, item 1).
 *
 * Sem `messaging_account_id`, com a chave alcançando mais de uma conta de
 * mensagens no número, o envio pode cair no crédito do ManyChat ou ser recusado.
 * Campo vazio = o corpo de hoje, byte a byte.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  creds: { phoneNumberId: "845199182001279", token: "tok", graphVersion: "v23.0", source: "session" } as Record<
    string,
    unknown
  >,
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) as never }));
vi.mock("@/lib/webhooks/secrets", () => ({ decryptWebhookSecret: async () => "tok" }));
// Só `resolveMetaCreds` é dublada; `metaCredsForPhoneNumberId` e o helper são reais.
vi.mock("@/lib/channels/meta/credentials", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  resolveMetaCreds: vi.fn(async () => h.creds),
}));

import { metaCloudAdapter } from "@/lib/channels/adapters/meta-cloud";
import { campoDaContaDeMensagens, metaCredsForPhoneNumberId } from "@/lib/channels/meta/credentials";
import { sendTemplate } from "@/lib/channels/meta/send-template";
import { eventoDaSessao } from "@/lib/channels/meta/session";

const ORG = "11111111-1111-4111-8111-111111111111";
const CONTA = "1288526903016074";
let corpos: Array<Record<string, unknown>> = [];

beforeEach(() => {
  corpos = [];
  h.creds = { phoneNumberId: "845199182001279", token: "tok", graphVersion: "v23.0", source: "session" };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: { body?: string }) => {
      corpos.push(JSON.parse(init?.body ?? "{}"));
      return { ok: true, status: 200, statusText: "", json: async () => ({ messages: [{ id: "wamid.X" }] }) };
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const envelope = (extra: Record<string, unknown> = {}) =>
  ({ organizationId: ORG, sessionRef: "845199182001279", to: "5551999990000", kind: "text", body: "oi", ...extra }) as never;

describe("campoDaContaDeMensagens", () => {
  it("com conta: o campo; vazia ou nula: nada", () => {
    expect(campoDaContaDeMensagens(CONTA)).toEqual({ messaging_account_id: CONTA });
    expect(campoDaContaDeMensagens("")).toEqual({});
    expect(campoDaContaDeMensagens(null)).toEqual({});
    expect(campoDaContaDeMensagens(undefined)).toEqual({});
  });
});

describe("envio pelo adapter oficial", () => {
  it("⭐ texto e mídia levam a conta quando ela existe", async () => {
    h.creds.messagingAccountId = CONTA;
    await metaCloudAdapter.send(envelope());
    await metaCloudAdapter.send(envelope({ kind: "image", media: { url: "https://x.example/a.jpg", caption: null } }));
    expect(corpos.map((c) => c.messaging_account_id)).toEqual([CONTA, CONTA]);
  });

  it("⭐ o 'digitando…' também leva a conta", async () => {
    h.creds.messagingAccountId = CONTA;
    await metaCloudAdapter.signalTyping!({
      organizationId: ORG,
      sessionRef: "845199182001279",
      recipient: "5551999990000",
      inboundExternalId: "wamid.DO-CLIENTE",
    });
    expect(corpos[0]).toMatchObject({ status: "read", messaging_account_id: CONTA });
  });

  it("sem conta: o corpo de hoje, sem a chave", async () => {
    h.creds.messagingAccountId = null;
    await metaCloudAdapter.send(envelope());
    expect(corpos[0]).not.toHaveProperty("messaging_account_id");
  });
});

describe("envio de template", () => {
  const MODELO = {
    phoneNumberId: "845199182001279",
    token: "tok",
    graphVersion: "v23.0",
    to: "5551999990000",
    binding: { name: "promo", language: "pt_BR", contractHash: "h1", values: {} },
    current: { name: "promo", language: "pt_BR", contractHash: "h1", status: "APPROVED", components: [{ type: "BODY", text: "Olá" }] },
  };

  it("⭐ leva a conta quando ela vem; sem ela, o corpo de hoje", async () => {
    await sendTemplate({ ...MODELO, messagingAccountId: CONTA });
    await sendTemplate(MODELO);
    expect(corpos[0]).toMatchObject({ type: "template", messaging_account_id: CONTA });
    expect(corpos[1]).not.toHaveProperty("messaging_account_id");
  });
});

describe("a credencial lê a conta da sessão", () => {
  it("devolve messagingAccountId da linha (e pede a coluna)", async () => {
    const selects: string[] = [];
    const chain = {
      select: (c: string) => (selects.push(c), chain),
      eq: () => chain,
      is: () => chain,
      maybeSingle: async () => ({
        data: { meta_phone_number_id: "845199182001279", meta_token_encrypted: "cifrado", meta_messaging_account_id: CONTA },
        error: null,
      }),
    };
    const creds = await metaCredsForPhoneNumberId({ from: () => chain } as never, {
      organizationId: ORG,
      phoneNumberId: "845199182001279",
    });
    expect(selects[0]).toContain("meta_messaging_account_id");
    expect(creds?.messagingAccountId).toBe(CONTA);
  });
});

describe("webhook do número oficial", () => {
  it("⭐ aceita a WABA e a conta de mensagens, recusa outra", () => {
    const sessao = { id: "s", organizationId: ORG, wabaId: "1604858698014735", contaDeMensagensId: CONTA };
    expect(eventoDaSessao(sessao, "1604858698014735")).toBe(true);
    expect(eventoDaSessao(sessao, CONTA)).toBe(true);
    expect(eventoDaSessao(sessao, "999999999")).toBe(false);
    // Sem conta gravada, só a WABA, como hoje.
    expect(eventoDaSessao({ ...sessao, contaDeMensagensId: null }, CONTA)).toBe(false);
    // Sem WABA na sessão ou no evento: não filtra, como hoje.
    expect(eventoDaSessao({ ...sessao, wabaId: null }, "qualquer")).toBe(true);
    expect(eventoDaSessao(sessao, undefined)).toBe(true);
  });
});
