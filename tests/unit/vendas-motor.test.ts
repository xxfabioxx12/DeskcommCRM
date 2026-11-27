// @vitest-environment node
/**
 * O motor com o gatilho sale.received, num banco em memória que aplica `eq` e o
 * índice único de `sales_rule_runs` (o Postgres de verdade é o test:db da 9003).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const deps = vi.hoisted(() => ({
  executou: [] as Array<{ regra: string; config: unknown; contexto: Record<string, unknown> }>,
  adiarAte: null as string | null,
}));

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined), isServiceRoleConfigured: () => true }));
vi.mock("@/lib/automation/actions", () => ({
  getAction: (type: string) => ({
    type,
    postponeUntil: async () => deps.adiarAte,
    execute: async (ctx: { ruleId: string; context: Record<string, unknown> }, config: unknown) => {
      deps.executou.push({ regra: ctx.ruleId, config, contexto: ctx.context });
      return { type, status: "success" as const };
    },
  }),
}));

import { runAutomationForEvent } from "@/lib/automation/engine";
import type { EventRow } from "@/lib/event-log/dispatcher";

const ORG = "11111111-1111-4111-8111-111111111111";
const CONTATO = "22222222-2222-4222-8222-222222222222";
const CONEXAO = "33333333-3333-4333-8333-333333333333";
const SE = "44444444-4444-4444-8444-444444444444";

const PAYLOAD = {
  evento: "compra.aprovada",
  plataforma: "hotmart",
  conexao_id: CONEXAO,
  produto_id: "4455",
  produto: "Curso Hotmart",
  pedido: "HP0001",
  entidade: "hotmart:HP0001",
  valor: 29790,
  order_bump: false,
  sales_event_id: SE,
  contact_id: CONTATO,
  // Sem `venda` (ruling F1 da T9): os dados da pessoa ficam só em sales_events.
};

function regra(id: string, trigger_config: Record<string, unknown>) {
  return {
    id,
    organization_id: ORG,
    name: id,
    trigger_event: "sale.received",
    is_active: true,
    conditions: [],
    actions: [{ type: "add_tag", config: { tags: [id] } }],
    trigger_config,
    run_count: 0,
  };
}

/** `leitura`: tabelas cuja leitura falha; `insert`: código de erro do INSERT por tabela. */
interface Falhas {
  leitura?: string[];
  insert?: Record<string, string>;
}

function bancoEmMemoria(regras: Array<Record<string, unknown>>, falhas: Falhas = {}) {
  const tabelas: Record<string, Array<Record<string, unknown>>> = {
    automation_rules: regras,
    contacts: [{ id: CONTATO, organization_id: ORG, name: "João", is_personal: false, tags: [] }],
    sales_events: [
      {
        id: SE,
        organization_id: ORG,
        venda: { nome: "João Comprador", produto: "Curso Hotmart" },
        payload: { data: { purchase: { transaction: "HP0001" } } },
      },
    ],
    sales_rule_runs: [],
    automation_rule_runs: [],
  };
  const chaveUnica: Record<string, (l: Record<string, unknown>) => string> = {
    sales_rule_runs: (l) => [l.rule_id, l.webhook_source_id, l.entidade, l.evento].join("|"),
  };
  const admin = {
    from(tabela: string) {
      const filtros: Array<(l: Record<string, unknown>) => boolean> = [];
      let inserida: Record<string, unknown> | null = null;
      let erro: { code: string; message: string } | null = null;
      const linhas = () => (tabelas[tabela] ?? []).filter((l) => filtros.every((f) => f(l)));
      const erroDeLeitura = () =>
        erro ?? (!inserida && falhas.leitura?.includes(tabela) ? { code: "08006", message: "conexão caiu" } : null);
      const cadeia: Record<string, unknown> = {};
      Object.assign(cadeia, {
        select: () => cadeia,
        order: () => cadeia,
        limit: () => cadeia,
        update: () => cadeia,
        eq: (coluna: string, valor: unknown) => {
          filtros.push((l) => l[coluna] === valor);
          return cadeia;
        },
        insert: (linha: Record<string, unknown>) => {
          const lista = (tabelas[tabela] ??= []);
          const codigo = falhas.insert?.[tabela];
          if (codigo) {
            erro = { code: codigo, message: `falha ${codigo}` };
            return cadeia;
          }
          const chave = chaveUnica[tabela]?.(linha);
          if (chave !== undefined && lista.some((l) => chaveUnica[tabela]!(l) === chave)) {
            erro = { code: "23505", message: "duplicate key value violates unique constraint" };
          } else {
            inserida = { id: `id-${lista.length + 1}`, ...linha };
            lista.push(inserida);
          }
          return cadeia;
        },
        maybeSingle: async () => (erroDeLeitura() ? { data: null, error: erroDeLeitura() } : { data: inserida ?? linhas()[0] ?? null, error: null }),
        single: async () => (erroDeLeitura() ? { data: null, error: erroDeLeitura() } : { data: inserida ?? linhas()[0] ?? null, error: null }),
        then: (ok: (v: unknown) => unknown, falha?: (e: unknown) => unknown) =>
          Promise.resolve(
            erroDeLeitura() ? { data: null, error: erroDeLeitura() } : { data: inserida ? [inserida] : linhas(), error: null },
          ).then(ok, falha),
      });
      return cadeia;
    },
    rpc: async () => ({ data: null, error: null }),
  };
  return { admin, tabelas };
}

function evento(id: string, payload: Record<string, unknown> = PAYLOAD): EventRow {
  return {
    id,
    organization_id: ORG,
    event_type: "sale.received",
    entity_kind: "contact",
    entity_id: CONTATO,
    payload,
    metadata: {},
    created_at: "2026-10-21T15:00:00Z",
  } as unknown as EventRow;
}

beforeEach(() => {
  deps.executou.length = 0;
  deps.adiarAte = null;
});

describe("motor — sale.received", () => {
  it("a regra do produto roda, a de outro produto não; o contexto traz a venda (de sales_events) e o payload cru", async () => {
    const { admin } = bancoEmMemoria([regra("r-produto", { produto_id: "4455" }), regra("r-outro", { produto_id: "999" })]);
    await runAutomationForEvent(admin as never, evento("ev-1"));
    expect(deps.executou.map((e) => e.regra)).toEqual(["r-produto"]);
    const venda = deps.executou[0]!.contexto.venda as { produto: string; payload: { data: { purchase: { transaction: string } } } };
    expect(PAYLOAD).not.toHaveProperty("venda");
    expect((venda as unknown as { nome: string }).nome).toBe("João Comprador");
    expect(venda.produto).toBe("Curso Hotmart");
    expect(venda.payload.data.purchase.transaction).toBe("HP0001");
    expect(deps.executou[0]!.contexto.contact).toMatchObject({ id: CONTATO });
  });

  it("outro evento do log com o mesmo pedido: a regra não roda de novo", async () => {
    const { admin, tabelas } = bancoEmMemoria([regra("r1", {})]);
    await runAutomationForEvent(admin as never, evento("ev-1"));
    await runAutomationForEvent(admin as never, evento("ev-2"));
    expect(deps.executou).toHaveLength(1);
    expect(tabelas.sales_rule_runs).toHaveLength(1);
  });

  it("o MESMO evento reprocessado roda de novo (worker caiu antes de marcar o consumo)", async () => {
    const { admin } = bancoEmMemoria([regra("r1", {})]);
    await runAutomationForEvent(admin as never, evento("ev-1"));
    await runAutomationForEvent(admin as never, evento("ev-1"));
    expect(deps.executou).toHaveLength(2);
  });

  it("evento diferente do mesmo pedido roda (reembolso depois da aprovação)", async () => {
    const { admin } = bancoEmMemoria([regra("r1", {})]);
    await runAutomationForEvent(admin as never, evento("ev-1"));
    await runAutomationForEvent(admin as never, evento("ev-2", { ...PAYLOAD, evento: "compra.reembolsada" }));
    expect(deps.executou).toHaveLength(2);
  });

  it("ignorar order bump", async () => {
    const { admin } = bancoEmMemoria([regra("r-bump", { ignorar_order_bump: true })]);
    await runAutomationForEvent(admin as never, evento("ev-1", { ...PAYLOAD, order_bump: true }));
    expect(deps.executou).toHaveLength(0);
  });

  it("pedido já processado por outro evento: a regra sai antes da pré-checagem de adiamento (F8)", async () => {
    const { admin } = bancoEmMemoria([regra("r1", {})]);
    await runAutomationForEvent(admin as never, evento("ev-1"));
    deps.adiarAte = "2026-10-22T09:00:00Z";
    const resultado = await runAutomationForEvent(admin as never, evento("ev-2"));
    expect(resultado.status).not.toBe("retry");
    expect(deps.executou).toHaveLength(1);
  });

  it("o MESMO evento reprocessado ainda passa pela pré-checagem (adia de verdade)", async () => {
    const { admin } = bancoEmMemoria([regra("r1", {})]);
    await runAutomationForEvent(admin as never, evento("ev-1"));
    deps.adiarAte = "2026-10-22T09:00:00Z";
    const resultado = await runAutomationForEvent(admin as never, evento("ev-1"));
    expect(resultado.status).toBe("retry");
  });

  it("a venda ilegível (erro ao ler sales_events): nenhuma ação roda e o motor lança (o dispatcher tenta de novo)", async () => {
    const { admin } = bancoEmMemoria([regra("r1", {})], { leitura: ["sales_events"] });
    await expect(runAutomationForEvent(admin as never, evento("ev-1"))).rejects.toThrow(/sales_events/);
    expect(deps.executou).toHaveLength(0);
  });

  it("linha da venda ausente (redigida/apagada, sem erro): roda com a venda vazia", async () => {
    const { admin, tabelas } = bancoEmMemoria([regra("r1", {})]);
    tabelas.sales_events = [];
    await runAutomationForEvent(admin as never, evento("ev-1"));
    expect(deps.executou).toHaveLength(1);
    expect(deps.executou[0]!.contexto.venda).toEqual({ payload: null });
  });

  it("repetido (23505) e a leitura do event_id falha: lança em vez de pular a regra para sempre", async () => {
    const { admin, tabelas } = bancoEmMemoria([regra("r1", {})], { leitura: ["sales_rule_runs"] });
    await runAutomationForEvent(admin as never, evento("ev-1"));
    expect(tabelas.sales_rule_runs).toHaveLength(1);
    await expect(runAutomationForEvent(admin as never, evento("ev-1"))).rejects.toThrow(/sales_rule_runs/);
    expect(deps.executou).toHaveLength(1);
  });

  it("conexão ou regra apagada no meio (23503): a regra é pulada sem lançar", async () => {
    const { admin } = bancoEmMemoria([regra("r1", {})], { insert: { sales_rule_runs: "23503" } });
    await expect(runAutomationForEvent(admin as never, evento("ev-1"))).resolves.toBeDefined();
    expect(deps.executou).toHaveLength(0);
  });
});
