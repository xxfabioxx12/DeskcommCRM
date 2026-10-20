/**
 * A FALHA DA CAMPANHA EXPLICADA EM PORTUGUÊS — a partir do código da plataforma.
 *
 * "send_failed" e "131049" não dizem nada ao dono do negócio. O código chega por
 * dois caminhos (webhook de status: número puro; envio síncrono: dentro do texto,
 * `meta_131026: …`) e os dois têm de dar a MESMA frase.
 */
import { describe, expect, it } from "vitest";

import { DICIONARIO } from "@/lib/i18n/dicionario";

import {
  FRASES_PARA_OPERADOR,
  codigoDaPlataforma,
  explicarFalhaDoEnvio,
  falhaDeTemplate,
} from "./erros-para-operador";

describe("codigoDaPlataforma", () => {
  it("código numérico do webhook de status", () => {
    expect(codigoDaPlataforma("131047", "Re-engagement message")).toBe("131047");
  });
  it("código dentro do texto da falha síncrona, com o prefixo do transporte", () => {
    expect(codigoDaPlataforma("send_failed", "meta_131026: Message undeliverable")).toBe("131026");
  });
  it("pré-voo sem número não inventa código", () => {
    expect(codigoDaPlataforma("send_failed", "template_stale: x mudou")).toBeNull();
    expect(codigoDaPlataforma(null, null)).toBeNull();
  });
});

describe("explicarFalhaDoEnvio — a tabela da especificação", () => {
  it.each([
    ["131026", "Número sem WhatsApp ou que não aceitou os termos novos"],
    ["131047", "Fora das 24 horas: só template"],
    [
      "131049",
      "A Meta segurou para proteger a qualidade do número (a pessoa recebeu muitas mensagens de empresas)",
    ],
    ["132000", "Variáveis não batem com o template"],
    ["132012", "Variáveis não batem com o template"],
    ["132015", "Template pausado pela Meta"],
    ["132016", "Template desativado pela Meta"],
    ["130429", "Limite de envio atingido: tente mais tarde"],
    ["131056", "Limite de envio atingido: tente mais tarde"],
  ])("%s → frase traduzível", (codigo, frase) => {
    expect(explicarFalhaDoEnvio(codigo, "texto original")).toEqual({ frase, traduzivel: true, codigo });
    // O mesmo código, chegando pelo envio síncrono, dá a MESMA frase.
    expect(explicarFalhaDoEnvio("send_failed", `meta_${codigo}: texto original`)?.frase).toBe(frase);
  });

  it("pré-voo do envio vira frase", () => {
    expect(explicarFalhaDoEnvio("send_failed", "template_stale: promo mudou na Meta desde a configuração")?.frase).toBe(
      "O template mudou na Meta: escolha de novo",
    );
    expect(explicarFalhaDoEnvio("send_failed", "template_not_approved: promo (pt_BR)")?.frase).toBe(
      "Template pausado ou não aprovado pela Meta",
    );
    expect(explicarFalhaDoEnvio("send_failed", "template_missing_values: 2")?.frase).toBe(
      "Variáveis não batem com o template",
    );
    expect(explicarFalhaDoEnvio("send_failed", "template_missing: promo (pt_BR) não está no espelho")?.frase).toBe(
      "O template não existe mais neste número",
    );
  });

  it("código desconhecido mostra o texto ORIGINAL da plataforma, sem o prefixo", () => {
    expect(explicarFalhaDoEnvio("131999", "Some brand new error")).toEqual({
      frase: "Some brand new error",
      traduzivel: false,
      codigo: "131999",
    });
    expect(explicarFalhaDoEnvio("send_failed", "meta_999999: Weird thing")).toEqual({
      frase: "Weird thing",
      traduzivel: false,
      codigo: "999999",
    });
  });

  it("sem código conhecido e sem texto: nada a explicar", () => {
    expect(explicarFalhaDoEnvio("send_failed", null)).toBeNull();
    expect(explicarFalhaDoEnvio(null, "   ")).toBeNull();
  });
});

describe("falhaDeTemplate — o que pausa a campanha", () => {
  it("pausado/desativado/sumido → template_parado", () => {
    expect(falhaDeTemplate("132015", null)).toBe("template_parado");
    expect(falhaDeTemplate("send_failed", "meta_132016: disabled")).toBe("template_parado");
    expect(falhaDeTemplate("send_failed", "template_not_approved: x (pt_BR)")).toBe("template_parado");
    expect(falhaDeTemplate("send_failed", "template_missing: x (pt_BR) não está no espelho")).toBe("template_parado");
  });
  it("parâmetros que não batem → template_desatualizado", () => {
    expect(falhaDeTemplate("132000", null)).toBe("template_desatualizado");
    expect(falhaDeTemplate("send_failed", "meta_132012: param mismatch")).toBe("template_desatualizado");
    expect(falhaDeTemplate("send_failed", "template_stale: x mudou")).toBe("template_desatualizado");
    expect(falhaDeTemplate("send_failed", "template_missing_values: 1")).toBe("template_desatualizado");
  });
  it("falha da PESSOA (fora da janela, número sem WhatsApp) não pausa a campanha", () => {
    expect(falhaDeTemplate("131047", null)).toBeNull();
    expect(falhaDeTemplate("send_failed", "meta_131026: undeliverable")).toBeNull();
    expect(falhaDeTemplate(null, null)).toBeNull();
  });
});

it("toda frase do tradutor tem espanhol no dicionário", () => {
  expect(FRASES_PARA_OPERADOR.length).toBeGreaterThanOrEqual(10);
  for (const frase of FRASES_PARA_OPERADOR) expect(DICIONARIO[frase]?.es, frase).toBeTruthy();
});
