import { describe, expect, it, vi } from "vitest";

import "@/lib/automation/actions/set-field";
import { getAction } from "@/lib/automation/actions";
import type { ActionCtx } from "@/lib/automation/types";
import { problemaDasExpressoes, renderizar } from "@/lib/campanhas/renderizador";
import {
  FRASE_DO_PROBLEMA_DA_EXPRESSAO,
  problemaNoTexto,
  renderizarValorDoCampo,
  valoresDoContexto,
} from "@/lib/campanhas/valores-do-contexto";
import {
  MENSAGEM_DA_VENDA_FORA_DO_GATILHO,
  acoesUsamVendaForaDoGatilho,
  createAutomationRuleSchema,
} from "@/lib/schemas/webhooks";

const VENDA = {
  nome: "{{saudacao}} Ana",
  produto: "Curso Hotmart",
  oferta: null,
  extra: { link_magico_de_acesso: "https://area/x" },
  payload: { data: { purchase: { transaction: "HP0001" }, items: [{ id: "a" }] } },
};
const QUANDO = { agora: new Date("2026-10-21T15:00:00Z"), fuso: "America/Sao_Paulo" };

describe("renderizador com a raiz venda.", () => {
  it("campos fixos, extra e payload", () => {
    const r = renderizar(
      "{{venda.produto}} {{venda.extra.link_magico_de_acesso}} {{venda.payload.data.purchase.transaction}} {{venda.payload.data.items.0.id}}",
      { nome: "x", venda: VENDA },
      QUANDO,
    );
    expect(r).toEqual({ texto: "Curso Hotmart https://area/x HP0001 a", faltando: [], desconhecidas: [] });
  });

  it("campo sem valor é FALTA; nome errado e raiz sem caminho são desconhecidos; protótipo não atravessa", () => {
    const r = renderizar("{{venda.oferta}} {{venda.produtoo}} {{venda.extra}} {{venda.payload.__proto__}}", { nome: "x", venda: VENDA });
    expect([...r.faltando].sort()).toEqual(["venda.oferta", "venda.payload.__proto__"]);
    expect([...r.desconhecidas].sort()).toEqual(["venda.extra", "venda.produtoo"]);
  });

  it("fora do gatilho de venda, {{venda.x}} é desconhecida — campanha e fluxo não mudam", () => {
    expect(renderizar("{{venda.produto}}", { nome: "x" }).desconhecidas).toEqual(["venda.produto"]);
    expect("venda" in valoresDoContexto({ contact: { name: "Ana" } })).toBe(false);
  });

  it("dado do comprador com chaves entra como DADO, nunca como variável", () => {
    expect(renderizarValorDoCampo("{{venda.nome}}", { venda: VENDA }, QUANDO)).toEqual({ ok: true, valor: "{{saudacao}} Ana" });
  });

  it("problemaDasExpressoes conhece venda.* só quando pedido", () => {
    expect(problemaDasExpressoes(["{{venda.produto}}"])).toBe("variavel_desconhecida");
    expect(problemaDasExpressoes(["{{venda.produto}}"], { venda: true })).toBeNull();
    expect(problemaDasExpressoes(["{{venda.produtoo}}"], { venda: true })).toBe("variavel_desconhecida");
    expect(problemaNoTexto("{{sobrenome}}")).toBe(FRASE_DO_PROBLEMA_DA_EXPRESSAO.variavel_desconhecida);
    expect(problemaNoTexto("{{venda.produtoo}}", { venda: true })).toBe(FRASE_DO_PROBLEMA_DA_EXPRESSAO.variavel_desconhecida);
  });
});

describe("regra: {{venda.*}} só no gatilho de venda", () => {
  const gravar = (valor: string) => ({ type: "set_field", config: { destino: "contato", campo: "link_acesso", valor } });

  it("no gatilho de venda passa", () => {
    expect(
      createAutomationRuleSchema.safeParse({
        name: "Acesso",
        trigger_event: "sale.received",
        actions: [gravar("{{venda.extra.link_magico_de_acesso}}")],
      }).success,
    ).toBe(true);
  });

  it("em outro gatilho é recusada com a frase certa, inclusive dentro do ai_decide", () => {
    const r = createAutomationRuleSchema.safeParse({ name: "x", trigger_event: "contact.tag_added", actions: [gravar("{{venda.produto}}")] });
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => i.message)).toContain(MENSAGEM_DA_VENDA_FORA_DO_GATILHO);
    expect(
      acoesUsamVendaForaDoGatilho("contact.tag_added", [{ type: "ai_decide", config: { opcoes: [{ acao: gravar("{{venda.produto}}") }] } }]),
    ).toBe(true);
    expect(acoesUsamVendaForaDoGatilho("sale.received", [gravar("{{venda.produto}}")])).toBe(false);
    expect(acoesUsamVendaForaDoGatilho("contact.tag_added", [gravar("{{nome}}")])).toBe(false);
  });

  it("erro de digitação continua com a frase de sempre", () => {
    const r = createAutomationRuleSchema.safeParse({ name: "x", trigger_event: "contact.tag_added", actions: [gravar("{{sobrenome}}")] });
    expect(r.error?.issues[0]?.message).toBe(FRASE_DO_PROBLEMA_DA_EXPRESSAO.variavel_desconhecida);
  });
});

describe("set_field com {{venda.extra.link_magico_de_acesso}}", () => {
  const ctx = (rpc: ReturnType<typeof vi.fn>): ActionCtx => ({
    admin: { rpc } as never,
    organizationId: "org-1",
    ruleId: "r1",
    ruleName: "Venda",
    event: {} as never,
    context: { contact: { id: "c1" }, venda: VENDA },
    requestId: "e1",
  });

  it("grava o link da venda no campo do contato", async () => {
    const rpc = vi.fn(async () => ({ data: { link_acesso: "https://area/x" }, error: null }));
    const r = await getAction("set_field")!.execute(ctx(rpc), {
      destino: "contato",
      campo: "link_acesso",
      valor: "{{venda.extra.link_magico_de_acesso}}",
    });
    expect(r.status).toBe("success");
    expect(rpc).toHaveBeenCalledWith("fn_contato_anotar_campos", {
      p_org: "org-1",
      p_contato: "c1",
      p_campos: { link_acesso: "https://area/x" },
    });
  });

  it("venda sem o dado: falha com 'falta o dado' e não grava", async () => {
    const rpc = vi.fn();
    const r = await getAction("set_field")!.execute(ctx(rpc), { destino: "contato", campo: "oferta", valor: "{{venda.oferta}}" });
    expect(r).toMatchObject({ status: "failed", error: "falta o dado: venda.oferta" });
    expect(rpc).not.toHaveBeenCalled();
  });
});
