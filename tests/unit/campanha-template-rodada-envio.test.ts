/**
 * O RAMO DE TEMPLATE da rodada, pelo COMPORTAMENTO (o guarda por regex está em
 * `campanha-template-rodada-ligacao.test.ts`).
 *
 * A rodada inteira roda contra um banco em memória; ritmo, canal, origem do
 * atendimento e a porta de saída são dublês. O que se prova:
 *   - template que não monta pausa a campanha SEM reservar o destinatário;
 *   - valor que falta só para uma pessoa falha a pessoa, sem pausar e sem enviar;
 *   - recusa síncrona que é do TEMPLATE pausa e devolve a pessoa à fila (ninguém
 *     se perde); recusa que é da pessoa só falha a pessoa.
 */
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

const dubles = vi.hoisted(() => ({
  linha: null as unknown,
  resposta: { id: "m-1", status: "sent" } as Record<string, unknown>,
  enviar: null as unknown as Mock<(...args: unknown[]) => unknown>,
}));

vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock("@/lib/agent-engine/db/request-pool", () => ({ getRequestPool: () => ({}) }));
vi.mock("@/lib/agent-engine/pacing/store", () => ({
  loadChannelKnobs: async () => ({ knobs: { timezone: "America/Sao_Paulo" }, numberActivatedAt: null }),
  loadPacingState: async () => ({ sentToday: 0, lastSentAt: null }),
  recordSend: async () => undefined,
}));
vi.mock("@/lib/agent-engine/pacing/engine", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  decidePacing: () => ({ allow: true }),
}));
vi.mock("@/lib/atendimento/origem", () => ({ beginServiceAtOrigin: async () => ({ conversation_id: "cv-1" }) }));
vi.mock("@/lib/channels/linha-do-espelho", () => ({
  linhaDoEspelho: async () => ({ data: dubles.linha, error: null }),
}));
vi.mock("@/app/api/v1/messages/_handler", () => {
  dubles.enviar = vi.fn(async () => dubles.resposta);
  return { sendMessageHandler: (...args: unknown[]) => dubles.enviar(...args) };
});

import type { LinhaDoModelo } from "@/lib/campanhas/conferir-template";
import { rodarUmaRodadaDeCampanha } from "@/lib/campanhas/rodada";
import { CHANNEL_PROVIDER_META } from "@/lib/channels/capabilities";

type Linha = Record<string, unknown>;

/** PostgREST em memória: `eq`/`in`/`lte`/`not is null` e `limit`; coluna que a linha não tem não filtra. */
function bancoEmMemoria(tabelas: Record<string, Linha[]>) {
  const updates: Array<{ tabela: string; valor: Linha }> = [];
  const builder = (tabela: string) => {
    const filtros: Array<(l: Linha) => boolean> = [];
    let limite = Infinity;
    let patch: Linha | null = null;
    const resolver = () => {
      const linhas = (tabelas[tabela] ?? []).filter((l) => filtros.every((f) => f(l))).slice(0, limite);
      if (patch) {
        updates.push({ tabela, valor: patch });
        for (const l of linhas) Object.assign(l, patch);
      }
      return { data: linhas, error: null, count: linhas.length };
    };
    const b: Record<string, unknown> = new Proxy(
      {},
      {
        get(_alvo, metodo) {
          switch (metodo) {
            case "then":
              return (ok: (v: unknown) => unknown) => Promise.resolve(resolver()).then(ok);
            case "maybeSingle":
            case "single":
              return async () => ({ data: resolver().data[0] ?? null, error: null });
            case "update":
              return (p: Linha) => {
                patch = p;
                return b;
              };
            case "eq":
              return (coluna: string, valor: unknown) => {
                filtros.push((l) => !(coluna in l) || l[coluna] === valor);
                return b;
              };
            case "in":
              return (coluna: string, valores: unknown[]) => {
                filtros.push((l) => !(coluna in l) || valores.includes(l[coluna]));
                return b;
              };
            case "lte":
              return (coluna: string, valor: string) => {
                filtros.push((l) => !(coluna in l) || String(l[coluna]) <= valor);
                return b;
              };
            case "not":
              return (coluna: string, op: string, valor: unknown) => {
                if (op === "is" && valor === null) filtros.push((l) => l[coluna] != null);
                return b;
              };
            case "limit":
              return (n: number) => {
                limite = n;
                return b;
              };
            default:
              return () => b;
          }
        },
      },
    );
    return b;
  };
  return { admin: { from: (t: string) => builder(t) } as never, updates, tabelas };
}

const AGORA = new Date("2026-10-20T18:00:00.000Z");
const LINHA: LinhaDoModelo = {
  name: "chegou",
  language: "pt_BR",
  status: "APPROVED",
  contract_hash: "h1",
  components: [{ type: "HEADER", format: "IMAGE" }, { type: "BODY", text: "{{1}}! O {{2}} chegou." }],
  parameter_format: "POSITIONAL",
  saved_values: { "header:1": "https://cdn.example/capa.png" },
};

function cenario(preparados: Record<string, string> = { "1": "{{saudacao}}, Ana", "2": "Super Presell" }) {
  const campanha: Linha = {
    id: "c-1",
    organization_id: "o-1",
    channel_session_id: "s-1",
    name: "Promo",
    status: "running",
    message_body: null,
    content_version: 1,
    message_mode: "template",
    template_name: "chegou",
    template_language: "pt_BR",
    template_contract_hash: "h1",
    template_slot_map: { "1": "{{saudacao}}, {{nome}}", "2": "Super Presell" },
    intervalo_segundos: null,
    janela_inicio_hora: null,
    janela_fim_hora: null,
    teto_diario: null,
    teto_horario: null,
    started_at: "2026-10-20T10:00:00.000Z",
    organizations: { status: "active" },
  };
  const destinatario: Linha = {
    id: "r-1",
    campaign_id: "c-1",
    status: "pending",
    contact_id: "k-1",
    recipient_address: "+5551999990000",
    rendered_body: null,
    variables: { nome: "Ana", template_values: preparados },
    contacts: {
      id: "k-1",
      name: "Ana",
      display_name: null,
      phone_number: "+5551999990000",
      is_blocked: false,
      is_personal: false,
      is_anonymized: false,
      consent: null,
    },
  };
  const banco = bancoEmMemoria({
    campaigns: [campanha],
    campaign_recipients: [destinatario],
    campaign_suppressions: [],
    campaign_channel_sessions: [],
    channel_sessions: [
      { id: "s-1", organization_id: "o-1", status: "WORKING", daily_message_limit: null, provider: CHANNEL_PROVIDER_META },
    ],
    conversations: [],
  });
  return { ...banco, campanha, destinatario };
}

const reservou = (updates: Array<{ tabela: string; valor: Linha }>) =>
  updates.some((u) => u.tabela === "campaign_recipients" && u.valor.status === "sending");

beforeEach(() => {
  dubles.linha = LINHA;
  dubles.resposta = { id: "m-1", status: "sent" };
  dubles.enviar.mockClear();
});

describe("rodada × template (comportamento)", () => {
  it("caminho feliz: envia type template com o link salvo do cabeçalho", async () => {
    const { admin, destinatario } = cenario();
    await rodarUmaRodadaDeCampanha(admin, AGORA);
    expect(dubles.enviar).toHaveBeenCalledTimes(1);
    expect(dubles.enviar.mock.calls[0]?.[2]).toMatchObject({
      type: "template",
      template_name: "chegou",
      template_values: { "header:1": "https://cdn.example/capa.png", "1": "Boa tarde, Ana", "2": "Super Presell" },
    });
    expect(destinatario.status).toBe("sent");
  });

  it("template pausado na plataforma: pausa a campanha e NÃO reserva o destinatário", async () => {
    dubles.linha = { ...LINHA, status: "PAUSED" };
    const { admin, updates, campanha, destinatario } = cenario();
    await rodarUmaRodadaDeCampanha(admin, AGORA);
    expect(campanha).toMatchObject({ status: "paused", failure_code: "template_nao_aprovado" });
    expect(reservou(updates)).toBe(false);
    expect(destinatario.status).toBe("pending");
    expect(dubles.enviar).not.toHaveBeenCalled();
  });

  it("template mudado entre o agendamento e o envio pausa (template_mudou)", async () => {
    dubles.linha = { ...LINHA, contract_hash: "h2" };
    const { admin, updates, campanha } = cenario();
    await rodarUmaRodadaDeCampanha(admin, AGORA);
    expect(campanha).toMatchObject({ status: "paused", failure_code: "template_mudou" });
    expect(reservou(updates)).toBe(false);
  });

  it("valor que falta só para esta pessoa: ela falha, a campanha segue, nada sai com lacuna", async () => {
    const { admin, updates, campanha, destinatario } = cenario({ "1": "{{saudacao}}, Ana" });
    await rodarUmaRodadaDeCampanha(admin, AGORA);
    expect(campanha.status).toBe("running");
    expect(destinatario.status).toBe("failed");
    expect(String(destinatario.last_error_detail)).toMatch(/^Faltam valores do template para esta pessoa/);
    expect(reservou(updates)).toBe(false);
    expect(dubles.enviar).not.toHaveBeenCalled();
  });

  it("recusa síncrona do TEMPLATE (132015): pausa e devolve a pessoa à fila", async () => {
    dubles.resposta = { id: "m-1", status: "failed", error_code: "meta_error", error_message: "meta_132015: Template paused" };
    const { admin, campanha, destinatario } = cenario();
    await rodarUmaRodadaDeCampanha(admin, AGORA);
    expect(campanha).toMatchObject({ status: "paused", failure_code: "template_nao_aprovado" });
    expect(destinatario).toMatchObject({
      status: "pending",
      sending_at: null,
      last_error_detail: "meta_132015: Template paused",
      attempt_count: 1,
    });
    // A mensagem que falhou não fica ligada à pessoa: o reenvio grava a nova.
    expect(destinatario.message_id).toBeUndefined();
  });

  it("recusa síncrona da PESSOA (131026): só ela falha, a campanha segue", async () => {
    dubles.resposta = { id: "m-1", status: "failed", error_code: "meta_error", error_message: "meta_131026: undeliverable" };
    const { admin, campanha, destinatario } = cenario();
    await rodarUmaRodadaDeCampanha(admin, AGORA);
    expect(campanha.status).toBe("running");
    expect(destinatario).toMatchObject({ status: "failed", last_error_detail: "meta_131026: undeliverable" });
  });
});
