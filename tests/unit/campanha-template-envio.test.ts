/**
 * O ENVIO POR TEMPLATE: conferido na hora, pausa em vez de queimar a lista, e o
 * link salvo do cabeçalho vai junto (o handler NÃO mescla `saved_values`).
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

import type { LinhaDoModelo } from "@/lib/campanhas/conferir-template";
import {
  falhaDoEnvioParaACampanha,
  montarEnvioDoTemplate,
  pausarPorTemplate,
} from "@/lib/campanhas/envio-por-template";
import { intervaloDoCanalCumprido } from "@/lib/campanhas/ritmo";

const LINHA: LinhaDoModelo = {
  name: "chegou",
  language: "pt_BR",
  status: "APPROVED",
  contract_hash: "h1",
  components: [{ type: "HEADER", format: "IMAGE" }, { type: "BODY", text: "{{1}}! O {{2}} chegou." }],
  parameter_format: "POSITIONAL",
  saved_values: { "header:1": "https://cdn.example/capa.png" },
};
const CAMPANHA = {
  templateName: "chegou",
  templateLanguage: "pt_BR",
  templateContractHash: "h1",
  // O que a campanha preenche (o cabeçalho de imagem vem do link salvo).
  slotMap: { "1": "{{saudacao}}, {{nome}}", "2": "Super Presell" },
};
// 15h em São Paulo.
const QUANDO = { agora: new Date("2026-10-20T18:00:00.000Z"), fuso: "America/Sao_Paulo" };
const PREPARADOS = { "1": "{{saudacao}}, Ana", "2": "Super Presell" };

describe("montarEnvioDoTemplate", () => {
  it("o link salvo do cabeçalho entra no template_values, e a saudação sai na hora", () => {
    const r = montarEnvioDoTemplate({ campanha: CAMPANHA, linha: LINHA, preparados: PREPARADOS, nome: "Ana", quando: QUANDO });
    expect(r).toEqual({
      ok: true,
      envio: {
        type: "template",
        template_name: "chegou",
        template_language: "pt_BR",
        template_values: { "header:1": "https://cdn.example/capa.png", "1": "Boa tarde, Ana", "2": "Super Presell" },
        body: "Boa tarde, Ana! O Super Presell chegou.",
      },
    });
  });
  it("template PAUSED pausa a campanha (template_nao_aprovado)", () => {
    const r = montarEnvioDoTemplate({ campanha: CAMPANHA, linha: { ...LINHA, status: "PAUSED" }, preparados: PREPARADOS, nome: "Ana", quando: QUANDO });
    expect(r).toMatchObject({ ok: false, falha: "template_nao_aprovado" });
  });
  it("template que sumiu do número também é template_nao_aprovado", () => {
    expect(montarEnvioDoTemplate({ campanha: CAMPANHA, linha: null, preparados: PREPARADOS, nome: "Ana", quando: QUANDO })).toMatchObject({
      ok: false,
      falha: "template_nao_aprovado",
    });
  });
  it("contrato mudou pausa (template_mudou)", () => {
    expect(
      montarEnvioDoTemplate({ campanha: CAMPANHA, linha: { ...LINHA, contract_hash: "h2" }, preparados: PREPARADOS, nome: "Ana", quando: QUANDO }),
    ).toMatchObject({ ok: false, falha: "template_mudou" });
  });
  it("link do cabeçalho apagado depois da preparação pausa em vez de mandar sem mídia", () => {
    expect(
      montarEnvioDoTemplate({ campanha: CAMPANHA, linha: { ...LINHA, saved_values: {} }, preparados: PREPARADOS, nome: "Ana", quando: QUANDO }),
    ).toMatchObject({ ok: false, alcance: "campanha", falha: "template_mudou" });
  });
  it("mapa da campanha que não cobre mais um slot do contrato pausa (vale para todos)", () => {
    expect(
      montarEnvioDoTemplate({
        campanha: { ...CAMPANHA, slotMap: { "1": "{{saudacao}}, {{nome}}" } },
        linha: LINHA,
        preparados: { "1": "{{saudacao}}, Ana" },
        nome: "Ana",
        quando: QUANDO,
      }),
    ).toMatchObject({ ok: false, alcance: "campanha", falha: "template_mudou" });
  });
  it("valor que falta só para ESTA pessoa não pausa: falha a pessoa", () => {
    const r = montarEnvioDoTemplate({
      campanha: CAMPANHA,
      linha: LINHA,
      preparados: { "1": "{{saudacao}}, Ana" },
      nome: "Ana",
      quando: QUANDO,
    });
    expect(r).toMatchObject({ ok: false, alcance: "pessoa" });
    expect(r.ok === false && r.detalhe.startsWith("Faltam valores do template para esta pessoa")).toBe(true);
    expect(r).not.toHaveProperty("falha");
  });
  it("variável que só resolve no envio e falta para a pessoa (sem nome) também é da pessoa", () => {
    expect(
      montarEnvioDoTemplate({
        campanha: CAMPANHA,
        linha: LINHA,
        preparados: { "1": "{{saudacao}}, {{nome}}", "2": "x" },
        nome: null,
        quando: QUANDO,
      }),
    ).toMatchObject({ ok: false, alcance: "pessoa" });
  });
  it("valor do cadastro com cara de variável sai literal (blindagem da preparação)", () => {
    const r = montarEnvioDoTemplate({
      campanha: CAMPANHA,
      linha: LINHA,
      preparados: { "1": "{⁠{saudacao}}", "2": "x" },
      nome: "Ana",
      quando: QUANDO,
    });
    expect(r.ok && r.envio.template_values["1"]).toBe("{{saudacao}}");
  });
});

describe("falhaDoEnvioParaACampanha", () => {
  it("falha 132015 no envio síncrono pausa (template_nao_aprovado)", () => {
    expect(falhaDoEnvioParaACampanha("meta_error", "meta_132015: Template paused")).toBe("template_nao_aprovado");
  });
  it("parâmetros que não batem pausam (template_mudou)", () => {
    expect(falhaDoEnvioParaACampanha("meta_error", "template_missing_values: 2")).toBe("template_mudou");
  });
  it("template que não existe na conta (132001) pausa (template_nao_aprovado)", () => {
    expect(falhaDoEnvioParaACampanha("meta_error", "meta_132001: Template name does not exist in the translation")).toBe(
      "template_nao_aprovado",
    );
  });
  it("falha da pessoa não pausa a campanha", () => {
    expect(falhaDoEnvioParaACampanha("meta_error", "meta_131026: undeliverable")).toBeNull();
  });
});

describe("pausarPorTemplate", () => {
  function fakeAdmin(linhas: unknown[] | null, erro: { message: string } | null = null) {
    const chamadas: { update?: Record<string, unknown>; eq: Array<[string, unknown]> } = { eq: [] };
    const b: Record<string, unknown> = {
      update: (valor: Record<string, unknown>) => {
        chamadas.update = valor;
        return b;
      },
      eq: (coluna: string, valor: unknown) => {
        chamadas.eq.push([coluna, valor]);
        return b;
      },
      select: async () => ({ data: linhas, error: erro }),
    };
    return { admin: { from: () => b } as never, chamadas };
  }
  it("pausa só campanha em andamento, com o código e o detalhe", async () => {
    const { admin, chamadas } = fakeAdmin([{ id: "c-1" }]);
    expect(await pausarPorTemplate(admin, "c-1", "template_mudou", "chegou (pt_BR): stale", QUANDO.agora)).toBe(true);
    expect(chamadas.update).toEqual({
      status: "paused",
      paused_at: QUANDO.agora.toISOString(),
      failure_code: "template_mudou",
      failure_detail: "chegou (pt_BR): stale",
    });
    expect(chamadas.eq).toContainEqual(["status", "running"]);
  });
  it("erro do banco não lança (a rodada não pode cair) e devolve false", async () => {
    const { admin } = fakeAdmin(null, { message: "boom" });
    expect(await pausarPorTemplate(admin, "c-1", "template_mudou", "x", QUANDO.agora)).toBe(false);
  });
});

describe("intervaloDoCanalCumprido", () => {
  const AGORA = new Date("2026-10-20T12:00:10.000Z");
  it("canal sem intervalo da plataforma, ou nunca enviou: pode", () => {
    expect(intervaloDoCanalCumprido(new Date("2026-10-20T12:00:09.000Z"), null, AGORA)).toBe(true);
    expect(intervaloDoCanalCumprido(null, 6000, AGORA)).toBe(true);
  });
  it("6 s no oficial: 5 s depois espera, 6 s depois pode", () => {
    expect(intervaloDoCanalCumprido(new Date("2026-10-20T12:00:05.000Z"), 6000, AGORA)).toBe(false);
    expect(intervaloDoCanalCumprido(new Date("2026-10-20T12:00:04.000Z"), 6000, AGORA)).toBe(true);
  });
});
