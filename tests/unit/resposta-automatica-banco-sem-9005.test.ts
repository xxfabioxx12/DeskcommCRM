/**
 * I-2 — banco SEM a 9005 (coluna `responde_sozinho` ausente). O PostgREST recusa a
 * consulta inteira quando ela pede uma coluna que não existe; por isso a leitura
 * não pode pedir o interruptor pelo nome. Linha sem a coluna = padrão do provedor:
 * oficial desligado, QR Code ligado (como antes).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ signalTyping: vi.fn(async () => undefined) }));
vi.mock("@/lib/channels", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getAdapter: () => ({ signalTyping: h.signalTyping, resolveRecipient: () => "5551999990000" }),
}));

import { decidirElegibilidadeDaConversaViaSupabase } from "@/lib/ai/elegibilidade/consulta-supabase";
import { CHANNEL_PROVIDER_META } from "@/lib/channels/capabilities";
import { sinalizarDigitando } from "@/lib/messaging/presenca";

const ORG = "11111111-1111-4111-8111-111111111111";
const CONV = "22222222-2222-4222-8222-222222222222";

/** PostgREST de um banco sem a 9005: pedir a coluna pelo nome = erro. */
function bancoSem9005(linha: unknown) {
  let pediuAColuna = false;
  const chain = {
    select: (cols: string) => {
      if (cols.includes("responde_sozinho")) pediuAColuna = true;
      return chain;
    },
    eq: () => chain,
    not: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle: async () =>
      pediuAColuna
        ? { data: null, error: { message: "column channel_sessions_1.responde_sozinho does not exist" } }
        : { data: linha, error: null },
  };
  return { from: () => chain } as never;
}

const sessao = (provider: string) => ({
  provider,
  metadata: {},
  status: "WORKING",
  meta_phone_number_id: "845199182001279",
  waha_session_name: "s",
  zernio_account_id: null,
  // sem `responde_sozinho`: a coluna não existe
});

const conversa = (provider: string) => ({
  is_group: false,
  group_chat_id: null,
  bot_silenced_until: null,
  assignee_kind: null,
  contacts: { force_human: false, ai_opt_out: false, ai_authorized_at: null, phone_number: "+5551999990000", wa_identity: null, wa_lid: null },
  organizations: { status: "active" },
  channel_sessions: sessao(provider),
});

beforeEach(() => h.signalTyping.mockClear());

describe("elegibilidade num banco sem a 9005", () => {
  const decidir = (provider: string) =>
    decidirElegibilidadeDaConversaViaSupabase(bancoSem9005(conversa(provider)), {
      organizationId: ORG,
      conversationId: CONV,
      agora: new Date(),
      ttlMs: 1,
    });
  it("⭐ QR Code segue respondendo (não quebra a leitura)", async () => {
    const d = await decidir("waha");
    expect(d?.motivo).not.toBe("resposta_automatica_desligada");
  });
  it("⭐ oficial fica desligado", async () => {
    const d = await decidir(CHANNEL_PROVIDER_META);
    expect(d?.permite).toBe(false);
    expect(d?.motivo).toBe("resposta_automatica_desligada");
  });
});

describe("'digitando…' num banco sem a 9005", () => {
  it("⭐ QR Code sinaliza", async () => {
    await sinalizarDigitando(bancoSem9005(conversa("waha")), { organizationId: ORG, conversationId: CONV });
    expect(h.signalTyping).toHaveBeenCalledTimes(1);
  });
  it("⭐ oficial não sinaliza", async () => {
    await sinalizarDigitando(bancoSem9005(conversa(CHANNEL_PROVIDER_META)), { organizationId: ORG, conversationId: CONV });
    expect(h.signalTyping).not.toHaveBeenCalled();
  });
});
