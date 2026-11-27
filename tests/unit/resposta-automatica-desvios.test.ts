/**
 * OS DOIS CAMINHOS QUE NÃO PASSAM PELA PORTA DE SAÍDA (Divergência D5).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  signalTyping: vi.fn(async () => undefined),
  send: vi.fn(async () => ({ externalId: "wamid.X" })),
  sessao: {} as Record<string, unknown>,
}));

vi.mock("@/lib/channels", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getAdapter: () => ({
    signalTyping: h.signalTyping,
    send: h.send,
    isConfigured: () => true,
    resolveRecipient: () => "5551999990000",
  }),
}));

import { CHANNEL_PROVIDER_META } from "@/lib/channels/capabilities";
import { criarTransporteDoAviso } from "@/lib/escalacao/aviso-ao-suporte.handler";
import { sinalizarDigitando } from "@/lib/messaging/presenca";

const ORG = "11111111-1111-4111-8111-111111111111";
const CANAL = "22222222-2222-4222-8222-222222222222";

function banco() {
  const chain = {
    select: () => chain,
    eq: () => chain,
    not: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle: async () => ({ data: h.sessao, error: null }),
  };
  return { from: () => chain } as never;
}

beforeEach(() => {
  h.signalTyping.mockClear();
  h.send.mockClear();
});

describe("'digitando…' (também marca como lido no aparelho do cliente)", () => {
  const conversa = (responde: boolean | null) => ({
    is_group: false,
    group_chat_id: null,
    external_id: "wamid.DO-CLIENTE",
    contacts: { phone_number: "+5551999990000", wa_identity: null, wa_lid: null },
    channel_sessions: {
      provider: CHANNEL_PROVIDER_META,
      meta_phone_number_id: "845199182001279",
      waha_session_name: null,
      zernio_account_id: null,
      status: "WORKING",
      responde_sozinho: responde,
    },
  });

  it("⭐ oficial com o interruptor nulo: não sinaliza", async () => {
    h.sessao = conversa(null);
    await sinalizarDigitando(banco(), { organizationId: ORG, conversationId: CANAL });
    expect(h.signalTyping).not.toHaveBeenCalled();
  });

  it("ligado: sinaliza", async () => {
    h.sessao = conversa(true);
    await sinalizarDigitando(banco(), { organizationId: ORG, conversationId: CANAL });
    expect(h.signalTyping).toHaveBeenCalledTimes(1);
  });
});

describe("aviso ao suporte (transporte direto)", () => {
  const canal = { id: CANAL, status: "WORKING", archived_at: null, aceitaMensagemLivre: true } as never;

  beforeEach(() => {
    h.sessao = {
      provider: CHANNEL_PROVIDER_META,
      meta_phone_number_id: "845199182001279",
      waha_session_name: null,
      zernio_account_id: null,
      responde_sozinho: null,
    };
  });

  it("⭐ automático com o interruptor desligado: recusa e nada sai", async () => {
    const t = await criarTransporteDoAviso(banco(), { automatico: true });
    await expect(t.envia(ORG, canal, "5551999990000", "aviso")).rejects.toThrow(/resposta_automatica_desligada/);
    expect(h.send).not.toHaveBeenCalled();
  });

  it("⭐ F3: o aviso de proposta no WhatsApp passa como automático", async () => {
    const fonte = await import("node:fs").then((fs) => fs.readFileSync("lib/propostas/aviso-no-whatsapp.handler.ts", "utf8"));
    expect(fonte).toContain("criarTransporteDoAviso(admin, { automatico: true })");
    expect(fonte).not.toMatch(/criarTransporteDoAviso\(admin\)/);
  });

  it("o botão 'testar aviso' (pessoa, sem a opção) continua saindo", async () => {
    const t = await criarTransporteDoAviso(banco());
    await expect(t.envia(ORG, canal, "5551999990000", "aviso")).resolves.toEqual({ externalId: "wamid.X" });
  });
});
