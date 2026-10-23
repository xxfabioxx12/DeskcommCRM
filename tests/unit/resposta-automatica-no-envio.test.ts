/**
 * A PORTA DE SAÍDA RESPEITA O INTERRUPTOR — e só barra o que é automático.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ storage: { from: () => ({ createSignedUrl: async () => ({ data: null, error: null }) }) } }),
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
// A resposta aprovada é conferida no banco pelo handler; aqui só importa que ela
// chegou conferida (F2) — o assert de verdade tem teste próprio.
vi.mock("@/lib/ai/replies/delivery", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  assertApprovedReplySupabase: vi.fn(async () => undefined),
  prepareApprovedReplySupabase: vi.fn(async () => undefined),
  recordApprovedReplyReceiptSupabase: vi.fn(async (_s: unknown, _c: unknown, _id: unknown, _e: unknown, m: unknown) => m),
}));

import { sendMessageHandler } from "@/app/api/v1/messages/_handler";
import type { HandlerCtx } from "@/lib/api/handlers/types";
import { CHANNEL_PROVIDER_META } from "@/lib/channels/capabilities";
import { RESPOSTA_AUTOMATICA_DESLIGADA } from "@/lib/channels/responde-sozinho";
import type { SendMessageInput } from "@/lib/schemas";
import { criarDubleDoHandler } from "@/tests/helpers/duble-do-handler";

const ORG = "11111111-1111-4111-8111-111111111111";
const CONV = "22222222-2222-4222-8222-222222222222";
const CONTACT = "33333333-3333-4333-8333-333333333333";
const SESSION = "44444444-4444-4444-8444-444444444444";
const USER = "55555555-5555-4555-8555-555555555555";

type Ator = HandlerCtx["actor"];
const IA: Ator = { type: "ai_agent", id: USER, role: "agent" };
const REGRA: Ator = { type: "webhook_source", id: "regra-1" };
const TOKEN: Ator = { type: "api_token", id: USER } as Ator;
const PESSOA: Ator = { type: "user", id: USER };

function conversa(provider: string, respondeSozinho: boolean | null) {
  return {
    id: CONV,
    organization_id: ORG,
    contact_id: CONTACT,
    channel_session_id: SESSION,
    is_group: false,
    group_chat_id: null,
    // Janela aberta: o teste é do interruptor, não da janela de 24 h.
    last_inbound_at: new Date().toISOString(),
    contacts: { phone_number: "+5551999990000", wa_identity: null, is_blocked: false },
    channel_sessions: {
      provider,
      waha_session_name: "default",
      meta_phone_number_id: "845199182001279",
      status: "WORKING",
      archived_at: null,
      responde_sozinho: respondeSozinho,
    },
  };
}

async function enviar(provider: string, valor: boolean | null, actor: Ator, extra: Partial<HandlerCtx> = {}) {
  const duble = criarDubleDoHandler({ conversation: conversa(provider, valor) });
  return sendMessageHandler(
    duble.supabase,
    { organization_id: ORG, actor, requestId: "req-1", ...extra } as HandlerCtx,
    { conversation_id: CONV, type: "text", body: "oi" } as SendMessageInput,
  );
}

const fetchMock = vi.fn(async () => ({ ok: true, status: 200, statusText: "", json: async () => ({ id: "true_x", messages: [{ id: "wamid.X" }] }) }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  fetchMock.mockClear();
});

describe("interruptor desligado no oficial (padrão)", () => {
  it.each([
    ["IA", IA],
    ["regra/follow-up", REGRA],
    ["integração por token", TOKEN],
  ])("⭐ %s: falha com o motivo e nada sai pela rede", async (_n, actor) => {
    vi.stubGlobal("fetch", fetchMock);
    const m = await enviar(CHANNEL_PROVIDER_META, null, actor);
    expect(m).toMatchObject({ status: "failed", error_code: RESPOSTA_AUTOMATICA_DESLIGADA });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("⭐ a pessoa no Inbox não é barrada", async () => {
    vi.stubGlobal("fetch", fetchMock);
    const m = await enviar(CHANNEL_PROVIDER_META, null, PESSOA);
    expect(m.error_code).not.toBe(RESPOSTA_AUTOMATICA_DESLIGADA);
  });

  it("⭐ campanha e teste da campanha não são resposta automática", async () => {
    vi.stubGlobal("fetch", fetchMock);
    for (const id of ["campaign:c1", "campaign-test:c1"]) {
      const m = await enviar(CHANNEL_PROVIDER_META, null, { type: "webhook_source", id });
      expect(m.error_code, id).not.toBe(RESPOSTA_AUTOMATICA_DESLIGADA);
    }
  });

  it("⭐ F2: resposta APROVADA por uma pessoa (approved_reply) não é barrada", async () => {
    vi.stubGlobal("fetch", fetchMock);
    const approvedReply = { organizationId: ORG, jobId: "66666666-6666-4666-8666-666666666666", jobClaim: "claim-1" };
    const m = await enviar(CHANNEL_PROVIDER_META, null, IA, { approvedReply } as unknown as Partial<HandlerCtx>);
    expect(m.error_code).not.toBe(RESPOSTA_AUTOMATICA_DESLIGADA);
  });

  it("⭐ releitura na hora do envio: desligar entre um envio e outro barra o seguinte", async () => {
    vi.stubGlobal("fetch", fetchMock);
    const conv = conversa(CHANNEL_PROVIDER_META, true);
    const duble = criarDubleDoHandler({ conversation: conv });
    const ctx = { organization_id: ORG, actor: IA, requestId: "req-1" } as HandlerCtx;
    const input = { conversation_id: CONV, type: "text", body: "oi" } as SendMessageInput;
    expect((await sendMessageHandler(duble.supabase, ctx, input)).error_code).not.toBe(RESPOSTA_AUTOMATICA_DESLIGADA);
    conv.channel_sessions.responde_sozinho = false;
    expect(await sendMessageHandler(duble.supabase, { ...ctx, requestId: "req-2" }, { ...input, body: "oi de novo" })).toMatchObject({
      status: "failed",
      error_code: RESPOSTA_AUTOMATICA_DESLIGADA,
    });
  });

  it("ligado na tela: a IA passa", async () => {
    vi.stubGlobal("fetch", fetchMock);
    const m = await enviar(CHANNEL_PROVIDER_META, true, IA);
    expect(m.error_code).not.toBe(RESPOSTA_AUTOMATICA_DESLIGADA);
  });
});

describe("números por QR Code", () => {
  it("⭐ com o interruptor nulo continua respondendo sozinho", async () => {
    vi.stubEnv("WAHA_API_BASE_URL", "http://localhost:3030");
    vi.stubEnv("WAHA_API_KEY", "hash123");
    vi.stubGlobal("fetch", fetchMock);
    const m = await enviar("waha", null, IA);
    expect(m.error_code).not.toBe(RESPOSTA_AUTOMATICA_DESLIGADA);
    expect(fetchMock).toHaveBeenCalled();
  });

  it("desligado de propósito: barra também", async () => {
    vi.stubGlobal("fetch", fetchMock);
    const m = await enviar("waha", false, REGRA);
    expect(m).toMatchObject({ status: "failed", error_code: RESPOSTA_AUTOMATICA_DESLIGADA });
  });
});
