import { beforeEach, describe, expect, it, vi } from "vitest";

type Canal = { daily_message_limit: number | null; status: string; provider: string | null };
type Estado = { lastSentAt: Date | null; sentToday: number; numberActivatedAt: null };

const h = vi.hoisted(() => ({
  conversas: [] as unknown[],
  canais: {} as Record<string, Canal>,
  estados: {} as Record<string, Estado>,
  degraus: [] as { minAgeDays: number; cap: number }[],
  permite: true,
  servico: vi.fn(async () => ({ conversation_id: "conv-1" })),
  enroll: vi.fn(async (_db: unknown, input: { resolveServiceBoundary?: () => Promise<unknown> }) => {
    await input.resolveServiceBoundary?.();
    return { ok: true, enrollment: { id: "enr-1" } };
  }),
}));

vi.mock("@/lib/agent-engine/pacing/store", () => ({
  loadChannelKnobs: async () => ({
    knobs: { timezone: "America/Sao_Paulo", warmupDailyCaps: h.degraus },
    numberActivatedAt: null,
  }),
  loadPacingState: async (_pool: unknown, _org: string, sessionId: string) =>
    h.estados[sessionId] ?? { lastSentAt: null, sentToday: 0, numberActivatedAt: null },
}));
vi.mock("@/lib/agent-engine/pacing/engine", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  decidePacing: () => ({ allow: h.permite }),
}));
vi.mock("@/lib/followup/enroll", () => ({ enrollFollowupFlow: h.enroll }));
vi.mock("@/lib/atendimento/origem-automacao", () => ({ serviceForAutomation: h.servico }));
vi.mock("@/lib/agent-engine/db/request-pool", () => ({ getRequestPool: () => ({}) }));

import { executeStartMessageFlow } from "@/lib/automation/actions/start-message-flow";
import type { ActionCtx } from "@/lib/automation/types";
import { lerNumero } from "@/lib/campanhas/numero-disponivel";
import { CHANNEL_PROVIDER_META, CHANNEL_PROVIDER_WAHA } from "@/lib/channels/capabilities";
import { configDaConexaoSchema } from "@/lib/vendas/config";
import { livreParaOFluxo, numerosDeSaidaDoEvento, saidaDaVenda } from "@/lib/vendas/numero-de-saida";

/** Supabase de mentira: `conversations` devolve `h.conversas`; `channel_sessions`, o canal do `eq("id", …)`. */
const admin = {
  from(tabela: string) {
    const filtros: Record<string, unknown> = {};
    const resultado = () => ({
      data: tabela === "conversations" ? h.conversas : (h.canais[String(filtros.id)] ?? null),
      error: null,
    });
    const c: Record<string, unknown> = {};
    c.select = () => c;
    c.limit = () => c;
    c.eq = (coluna: string, valor: unknown) => {
      filtros[coluna] = valor;
      return c;
    };
    c.maybeSingle = async () => resultado();
    c.then = (ok: (v: unknown) => unknown) => Promise.resolve(resultado()).then(ok);
    return c;
  },
} as never;

const AGORA = new Date("2026-10-21T15:00:00Z");

/** Monta os números: `null` = desconectado; `folga` = quanto cabe hoje num teto de 100 (`null` = sem teto). */
function numeros(estados: Record<string, { folga: number | null; ultimoEnvio?: Date } | null>) {
  h.canais = {};
  h.estados = {};
  for (const [sid, e] of Object.entries(estados)) {
    if (e === null) {
      h.canais[sid] = { daily_message_limit: 100, status: "STOPPED", provider: null };
      continue;
    }
    h.canais[sid] = { daily_message_limit: e.folga === null ? null : 100, status: "WORKING", provider: null };
    h.estados[sid] = { lastSentAt: e.ultimoEnvio ?? null, sentToday: e.folga === null ? 0 : 100 - e.folga, numberActivatedAt: null };
  }
}

const saida = (lista: string[]) =>
  saidaDaVenda({ admin, pool: () => ({}) as never, organizationId: "org-1", contactId: "c1", numeros: lista, agora: AGORA });

beforeEach(() => {
  h.conversas = [];
  h.canais = {};
  h.estados = {};
  h.degraus = [];
  h.permite = true;
  h.servico.mockClear();
  h.enroll.mockClear();
});

describe("a leitura do número (extraída da rodada da campanha)", () => {
  it("fora do ar não entra; no ar: folga do dia, pacing e se exige template", async () => {
    h.canais.s1 = { daily_message_limit: 100, status: "STOPPED", provider: CHANNEL_PROVIDER_META };
    expect(await lerNumero(admin, {} as never, "org-1", "s1", AGORA)).toBeNull();
    h.canais.s1 = { daily_message_limit: 100, status: "WORKING", provider: CHANNEL_PROVIDER_META };
    h.estados.s1 = { lastSentAt: null, sentToday: 30, numberActivatedAt: null };
    const l = await lerNumero(admin, {} as never, "org-1", "s1", AGORA);
    expect(l?.numero).toMatchObject({ sessionId: "s1", folgaDoDia: 70, ultimoEnvio: null });
    expect(l?.exigeTemplate).toBe(true);
    expect(l?.aquecimentoEstourado).toBe(false);
    h.permite = false;
    expect((await lerNumero(admin, {} as never, "org-1", "s1", AGORA))?.numero.podeAgora).toBe(false);
  });

  it("aquecimento: estourado quando o envio de hoje alcança o teto do degrau da idade do número", async () => {
    h.degraus = [{ minAgeDays: 0, cap: 20 }];
    h.canais.s1 = { daily_message_limit: 100, status: "WORKING", provider: null };
    h.estados.s1 = { lastSentAt: null, sentToday: 19, numberActivatedAt: null };
    expect((await lerNumero(admin, {} as never, "org-1", "s1", AGORA))?.aquecimentoEstourado).toBe(false);
    h.estados.s1 = { lastSentAt: null, sentToday: 20, numberActivatedAt: null };
    expect((await lerNumero(admin, {} as never, "org-1", "s1", AGORA))?.aquecimentoEstourado).toBe(true);
  });
});

describe("aquecimento só conta em número com risco de bloqueio (o decidePacing só o arma com banRisk)", () => {
  it("número oficial acima do degrau do aquecimento continua elegível", async () => {
    h.degraus = [{ minAgeDays: 0, cap: 20 }];
    h.canais.s1 = { daily_message_limit: 100, status: "WORKING", provider: CHANNEL_PROVIDER_META };
    h.estados.s1 = { lastSentAt: null, sentToday: 25, numberActivatedAt: null };
    expect((await lerNumero(admin, {} as never, "org-1", "s1", AGORA))?.aquecimentoEstourado).toBe(false);
    expect(await saida(["s1"])).toEqual({ tipo: "numero", sessionId: "s1" });
  });

  it("número comum (WAHA, banRisk) acima do aquecimento continua sendo pulado", async () => {
    h.degraus = [{ minAgeDays: 0, cap: 20 }];
    h.canais.s1 = { daily_message_limit: 100, status: "WORKING", provider: CHANNEL_PROVIDER_WAHA };
    h.estados.s1 = { lastSentAt: null, sentToday: 25, numberActivatedAt: null };
    expect((await lerNumero(admin, {} as never, "org-1", "s1", AGORA))?.aquecimentoEstourado).toBe(true);
    expect(await saida(["s1"])).toEqual({ tipo: "nenhum_livre" });
  });
});

describe("número de saída da venda — a régua do rodízio da campanha", () => {
  it("sem números marcados: comportamento de hoje", async () => {
    expect(await saida([])).toEqual({ tipo: "como_hoje" });
  });

  it("contato que já conversa fica no número dele", async () => {
    h.conversas = [{ id: "conv-antiga" }];
    numeros({ s1: { folga: 10 }, s2: { folga: 50 } });
    expect(await saida(["s1", "s2"])).toEqual({ tipo: "como_hoje" });
  });

  it("contato novo cai no número de maior folga", async () => {
    numeros({ s1: { folga: 10 }, s2: { folga: 50 } });
    expect(await saida(["s1", "s2"])).toEqual({ tipo: "numero", sessionId: "s2" });
  });

  it("empate determinístico: o mais parado, depois o id", async () => {
    numeros({ s1: { folga: 50, ultimoEnvio: new Date("2026-10-21T14:00:00Z") }, s2: { folga: 50, ultimoEnvio: new Date("2026-10-20T15:00:00Z") } });
    expect(await saida(["s1", "s2"])).toEqual({ tipo: "numero", sessionId: "s2" });
    numeros({ sB: { folga: 50 }, sA: { folga: 50 } });
    expect(await saida(["sB", "sA"])).toEqual({ tipo: "numero", sessionId: "sA" });
  });

  it("número desconectado e número no teto do dia são pulados", async () => {
    numeros({ s1: null, s2: { folga: 0 }, s3: { folga: 5 } });
    expect(await saida(["s1", "s2", "s3"])).toEqual({ tipo: "numero", sessionId: "s3" });
  });

  it("número em aquecimento estourado é pulado, mesmo com mais folga no teto", async () => {
    h.degraus = [{ minAgeDays: 0, cap: 20 }];
    numeros({ s1: { folga: 80 }, s2: { folga: 10 } }); // s1 enviou 20 hoje, s2 enviou 90
    h.estados.s2!.sentToday = 5;
    h.canais.s2!.daily_message_limit = 15;
    expect(await saida(["s1", "s2"])).toEqual({ tipo: "numero", sessionId: "s2" });
  });

  it("nenhum disponível: nenhum_livre", async () => {
    numeros({ s1: null, s2: { folga: 0 } });
    expect(await saida(["s1", "s2"])).toEqual({ tipo: "nenhum_livre" });
  });

  it("janela fechada e intervalo recente não tiram o número da escolha — quem espera é o passo de envio (D16)", async () => {
    h.permite = false;
    numeros({ s1: { folga: 5 } });
    expect(await saida(["s1"])).toEqual({ tipo: "numero", sessionId: "s1" });

    h.permite = true;
    h.canais = { s1: { daily_message_limit: 100, status: "WORKING", provider: CHANNEL_PROVIDER_META } };
    h.estados = { s1: { lastSentAt: new Date(AGORA.getTime() - 1000), sentToday: 1, numberActivatedAt: null } };
    expect((await lerNumero(admin, {} as never, "org-1", "s1", AGORA))?.numero.podeAgora).toBe(false);
    expect(await saida(["s1"])).toEqual({ tipo: "numero", sessionId: "s1" });

    const base = { sessionId: "s1", ultimoEnvio: null };
    expect(livreParaOFluxo({ numero: { ...base, folgaDoDia: null, podeAgora: false }, aquecimentoEstourado: false }).podeAgora).toBe(true);
    expect(livreParaOFluxo({ numero: { ...base, folgaDoDia: 0, podeAgora: true }, aquecimentoEstourado: false }).podeAgora).toBe(false);
    expect(livreParaOFluxo({ numero: { ...base, folgaDoDia: 50, podeAgora: true }, aquecimentoEstourado: true }).podeAgora).toBe(false);
  });

  it("lista do payload: só textos, sem repetir; e a config aceita até 50 uuids", () => {
    expect(numerosDeSaidaDoEvento({ numeros_de_saida: ["a", "a", 3, "", "b"] })).toEqual(["a", "b"]);
    expect(numerosDeSaidaDoEvento({})).toEqual([]);
    const uuid = "66666666-6666-4666-8666-666666666666";
    expect(configDaConexaoSchema.safeParse({ numeros_de_saida: [uuid] }).success).toBe(true);
    expect(configDaConexaoSchema.safeParse({ numeros_de_saida: ["s1"] }).success).toBe(false);
    expect(configDaConexaoSchema.safeParse({ numeros_de_saida: Array(51).fill(uuid) }).success).toBe(false);
  });
});

describe("start_message_flow a partir do gatilho de venda", () => {
  function ctx(event_type: string, payload: Record<string, unknown>): ActionCtx {
    return {
      admin,
      organizationId: "org-1",
      ruleId: "rule-1",
      ruleName: "Comprou",
      requestId: "ev-1",
      event: {
        id: "ev-1",
        organization_id: "org-1",
        event_type,
        entity_kind: "contact",
        entity_id: "c1",
        payload,
        metadata: {},
        consumed_by: [],
        attempts: 0,
      } as unknown as ActionCtx["event"],
      context: { contact: { id: "c1" } },
    };
  }
  const POINTER = { flow_pointer_id: "11111111-1111-4111-8111-111111111111" };

  it("contato novo: a conversa nasce no número escolhido", async () => {
    numeros({ s1: { folga: 40 } });
    const r = await executeStartMessageFlow(ctx("sale.received", { numeros_de_saida: ["s1"] }), POINTER);
    expect(r.status).toBe("success");
    expect(h.servico).toHaveBeenCalledWith(expect.anything(), "c1", "s1");
  });

  it("nenhum número livre: não inscreve, com o motivo literal", async () => {
    numeros({ s1: { folga: 0 } });
    const r = await executeStartMessageFlow(ctx("sale.received", { numeros_de_saida: ["s1"] }), POINTER);
    expect(r).toEqual({ type: "start_message_flow", status: "skipped", detail: { reason: "sem_numero_de_saida_livre" } });
    expect(h.enroll).not.toHaveBeenCalled();
  });

  it("outro gatilho, ou venda sem números marcados: como hoje (sem número)", async () => {
    numeros({ s1: { folga: 40 } });
    await executeStartMessageFlow(ctx("contact.tag_added", { numeros_de_saida: ["s1"] }), POINTER);
    await executeStartMessageFlow(ctx("sale.received", {}), POINTER);
    expect(h.servico.mock.calls.map((c) => (c as unknown[])[2])).toEqual([undefined, undefined]);
  });
});
