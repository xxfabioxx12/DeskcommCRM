import { describe, expect, it, vi } from "vitest";

import { decidirElegibilidadeDaConversa } from "@/lib/ai/elegibilidade/consulta-pg";
import { decidirElegibilidadeDaConversaViaSupabase } from "@/lib/ai/elegibilidade/consulta-supabase";
import { decidirElegibilidade, montarEstadoDeElegibilidade } from "@/lib/ai/elegibilidade/gate";
import { CHANNEL_PROVIDER_META } from "@/lib/channels/capabilities";
import {
  FRASE_DA_RESPOSTA_AUTOMATICA_DESLIGADA,
  canalRespondeSozinho,
  ehEnvioDeCampanha,
  respondeSozinho,
} from "@/lib/channels/responde-sozinho";
import { traduzir } from "@/lib/i18n/dicionario";

const ORG = "11111111-1111-4111-8111-111111111111";
const CANAL = "22222222-2222-4222-8222-222222222222";

function db(resposta: unknown | (() => never)) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => (typeof resposta === "function" ? (resposta as () => never)() : resposta),
  };
  return { from: vi.fn(() => chain) } as never;
}

describe("respondeSozinho — padrão por provedor", () => {
  it("⭐ nulo: oficial desligado; QR Code e parceiros ligados (como hoje)", () => {
    expect(respondeSozinho(CHANNEL_PROVIDER_META, null)).toBe(false);
    expect(respondeSozinho("waha", null)).toBe(true);
    expect(respondeSozinho("zernio", undefined)).toBe(true);
    expect(respondeSozinho(null, null)).toBe(true);
  });
  it("valor explícito vence o padrão", () => {
    expect(respondeSozinho(CHANNEL_PROVIDER_META, true)).toBe(true);
    expect(respondeSozinho("waha", false)).toBe(false);
  });
});

describe("ehEnvioDeCampanha", () => {
  it("campanha e teste da campanha; nada mais", () => {
    expect(ehEnvioDeCampanha({ type: "webhook_source", id: "campaign:abc" })).toBe(true);
    expect(ehEnvioDeCampanha({ type: "webhook_source", id: "campaign-test:abc" })).toBe(true);
    expect(ehEnvioDeCampanha({ type: "webhook_source", id: "regra-1" })).toBe(false);
    expect(ehEnvioDeCampanha({ type: "ai_agent", id: "campaign:abc" })).toBe(false);
  });
});

describe("canalRespondeSozinho — leitura tolerante", () => {
  const ref = { organizationId: ORG, channelSessionId: CANAL };
  it("lê o valor gravado", async () => {
    expect(await canalRespondeSozinho(db({ data: { responde_sozinho: true }, error: null }), { ...ref, provider: CHANNEL_PROVIDER_META })).toBe(true);
    expect(await canalRespondeSozinho(db({ data: { responde_sozinho: false }, error: null }), { ...ref, provider: "waha" })).toBe(false);
  });
  it("⭐ banco sem a coluna (42703) ou dublê que lança: cai no padrão, não derruba", async () => {
    const semColuna = { data: null, error: { code: "42703", message: "column responde_sozinho does not exist" } };
    expect(await canalRespondeSozinho(db(semColuna), { ...ref, provider: CHANNEL_PROVIDER_META })).toBe(false);
    expect(await canalRespondeSozinho(db(semColuna), { ...ref, provider: "waha" })).toBe(true);
    const lanca = () => {
      throw new TypeError("from is not a function");
    };
    expect(await canalRespondeSozinho(db(lanca), { ...ref, provider: "waha" })).toBe(true);
  });
});

describe("gate da IA", () => {
  const base = {
    orgStatus: "active",
    aiGate: null,
    forceHuman: false,
    aiOptOut: false,
    assigneeKind: null,
    botSilencedUntil: null,
    aiAuthorizedAt: null,
    agora: new Date("2026-10-22T12:00:00Z"),
    ttlMs: 1,
  };
  it("desligado veta antes de tudo que é do contato; ausente = permite (quem não leu não muda)", () => {
    expect(decidirElegibilidade(montarEstadoDeElegibilidade({ ...base, respondeSozinho: false }))).toEqual({
      permite: false,
      motivo: "resposta_automatica_desligada",
      bloqueioPorAllowlist: false,
    });
    expect(decidirElegibilidade(montarEstadoDeElegibilidade(base)).permite).toBe(true);
  });

  it("⭐ F2: o motivo do interruptor só aparece quando TODO o resto permitiria (o assistido depende disso)", () => {
    // Dono humano / force_human vencem: o rascunho do assistido também fica calado.
    expect(decidirElegibilidade(montarEstadoDeElegibilidade({ ...base, respondeSozinho: false, forceHuman: true })).motivo).toBe("force_human");
    expect(decidirElegibilidade(montarEstadoDeElegibilidade({ ...base, respondeSozinho: false, assigneeKind: "user" })).motivo).toBe("conversa_de_humano");
    // Allowlist sem autorização também vence.
    expect(
      decidirElegibilidade(montarEstadoDeElegibilidade({ ...base, aiGate: "allowlist", respondeSozinho: false })).motivo,
    ).toBe("sem_autorizacao");
  });

  it("consulta pg: lê provider e o interruptor por to_jsonb (tolerante)", async () => {
    const query = vi.fn(async () => ({
      rows: [
        {
          channel_metadata: {},
          channel_provider: CHANNEL_PROVIDER_META,
          responde_sozinho: null,
          force_human: false,
          ai_opt_out: false,
          assignee_kind: null,
          bot_silenced_until: null,
          ai_authorized_at: null,
          phone_number: null,
          org_status: "active",
        },
      ],
    }));
    const d = await decidirElegibilidadeDaConversa({ query } as never, { organizationId: ORG, conversationId: CANAL, agora: base.agora, ttlMs: 1 });
    expect(d?.motivo).toBe("resposta_automatica_desligada");
    expect(String((query.mock.calls[0] as unknown[])[0])).toContain("to_jsonb(cs) -> 'responde_sozinho'");
  });

  it("consulta supabase: lê provider e o interruptor do embed", async () => {
    const linha = {
      bot_silenced_until: null,
      assignee_kind: null,
      contacts: { force_human: false, ai_opt_out: false, ai_authorized_at: null, phone_number: null },
      channel_sessions: { metadata: {}, provider: "waha", responde_sozinho: false },
      organizations: { status: "active" },
    };
    const d = await decidirElegibilidadeDaConversaViaSupabase(db({ data: linha, error: null }), {
      organizationId: ORG,
      conversationId: CANAL,
      agora: base.agora,
      ttlMs: 1,
    });
    expect(d?.motivo).toBe("resposta_automatica_desligada");
  });
});

describe("F8: a frase do envio barrado", () => {
  it("tem espanhol (o balão do Inbox traduz o error_message)", () => {
    expect(traduzir(FRASE_DA_RESPOSTA_AUTOMATICA_DESLIGADA, "es")).not.toBe(FRASE_DA_RESPOSTA_AUTOMATICA_DESLIGADA);
  });
});
