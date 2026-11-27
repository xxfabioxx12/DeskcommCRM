import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api/client", () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

import { CURATED_FIELDS } from "@/app/app/webhooks/_components/RuleEditor";
import { TRIGGER_LABELS } from "@/app/app/webhooks/_components/labels";
import { telaDoGatilho, triggerConfigDaTela } from "@/lib/automation/desenho-da-regra";
import { DICIONARIO } from "@/lib/i18n/dicionario";
import {
  ENTIDADE_ESPERADA_POR_GATILHO,
  MENSAGEM_DA_CONFIG_DA_VENDA,
  TRIGGER_EVENTS,
  createAutomationRuleSchema,
  updateAutomationRuleSchema,
} from "@/lib/schemas/webhooks";
import {
  CONFIG_DA_VENDA_VAZIA,
  configDaVendaAoSalvar,
  configDaVendaNaTela,
  vendaCasaComARegra,
} from "@/lib/vendas/filtro-da-regra";

const CONEXAO = "66666666-6666-4666-8666-666666666666";
const ETIQUETA = { type: "add_tag", config: { tags: ["comprou"] } };
const PAYLOAD = {
  evento: "compra.aprovada",
  plataforma: "hotmart",
  conexao_id: CONEXAO,
  produto_id: "4455",
  order_bump: false,
};

describe("o gatilho sale.received", () => {
  it("é gatilho de contato, com rótulo em espanhol e campos de condição", () => {
    expect(TRIGGER_EVENTS).toContain("sale.received");
    expect(ENTIDADE_ESPERADA_POR_GATILHO["sale.received"]).toBe("contact");
    expect(TRIGGER_LABELS["sale.received"]).toBe("Venda recebida");
    expect(DICIONARIO["Venda recebida"]?.es).toBe("Venta recibida");
    expect(CURATED_FIELDS["sale.received"].map((c) => c.value)).toContain("contact.tags");
  });

  it("a regra aceita os filtros da venda e recusa evento fora do vocabulário", () => {
    const regra = (trigger_config: Record<string, unknown>) => ({
      name: "Comprou o curso",
      trigger_event: "sale.received",
      actions: [ETIQUETA],
      trigger_config,
    });
    expect(
      createAutomationRuleSchema.safeParse(
        regra({ conexao_id: CONEXAO, produto_id: "4455", evento: "compra.aprovada", ignorar_order_bump: true }),
      ).success,
    ).toBe(true);
    expect(createAutomationRuleSchema.safeParse(regra({ evento: "custom.aula_vista" })).success).toBe(true);
    const ruim = createAutomationRuleSchema.safeParse(regra({ evento: "compra.qualquer" }));
    expect(ruim.success).toBe(false);
    expect(ruim.error?.issues.map((i) => i.message)).toContain(MENSAGEM_DA_CONFIG_DA_VENDA);
    expect(
      updateAutomationRuleSchema.safeParse({ trigger_event: "sale.received", trigger_config: { conexao_id: "x" } }).success,
    ).toBe(false);
  });
});

describe("vendaCasaComARegra", () => {
  it("sem filtro (ou config nula): qualquer venda", () => {
    expect(vendaCasaComARegra(PAYLOAD, {})).toBe(true);
    expect(vendaCasaComARegra(PAYLOAD, null)).toBe(true);
  });

  it("conexão, plataforma, produto (aparado), evento e order bump", () => {
    expect(vendaCasaComARegra(PAYLOAD, { conexao_id: CONEXAO })).toBe(true);
    expect(vendaCasaComARegra(PAYLOAD, { conexao_id: "77777777-7777-4777-8777-777777777777" })).toBe(false);
    expect(vendaCasaComARegra(PAYLOAD, { plataforma: "kiwify" })).toBe(false);
    expect(vendaCasaComARegra({ ...PAYLOAD, produto_id: " 4455 " }, { produto_id: "4455" })).toBe(true);
    expect(vendaCasaComARegra(PAYLOAD, { produto_id: "999" })).toBe(false);
    expect(vendaCasaComARegra(PAYLOAD, { evento: "carrinho.abandonado" })).toBe(false);
    expect(vendaCasaComARegra({ ...PAYLOAD, order_bump: true }, { ignorar_order_bump: true })).toBe(false);
    expect(vendaCasaComARegra({ ...PAYLOAD, order_bump: true }, { ignorar_order_bump: false })).toBe(true);
  });

  it("config torta não casa (falha fechada)", () => {
    expect(vendaCasaComARegra(PAYLOAD, { evento: "nada.disso" })).toBe(false);
  });
});

describe("tela ↔ config", () => {
  it("ida e volta; vazio é qualquer", () => {
    const tela = { conexao_id: CONEXAO, plataforma: "", produto_id: " 4455 ", evento: "compra.aprovada", ignorar_order_bump: true };
    const config = configDaVendaAoSalvar(tela);
    expect(config).toEqual({ conexao_id: CONEXAO, plataforma: null, produto_id: "4455", evento: "compra.aprovada", ignorar_order_bump: true });
    expect(configDaVendaNaTela(config)).toEqual({ ...tela, produto_id: "4455" });
    expect(configDaVendaNaTela({ evento: "nada.disso" })).toEqual(CONFIG_DA_VENDA_VAZIA);
  });

  it("desenho salva regra de venda sem apagar os filtros", () => {
    const config = { conexao_id: CONEXAO, produto_id: "4455", evento: "compra.aprovada", ignorar_order_bump: true };
    expect(
      triggerConfigDaTela("sale.received", telaDoGatilho(config), { trigger_event: "sale.received", trigger_config: config }),
    ).toEqual(config);
  });
});
