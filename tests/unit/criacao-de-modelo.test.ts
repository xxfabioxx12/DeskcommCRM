/**
 * O TEMPLATE QUE VAI PARA A REVISÃO DA META, conferido ANTES — no servidor.
 *
 * Recusa da plataforma chega horas depois e sem dizer o porquê; o que dá para
 * saber antes (nome fora do formato, exemplo faltando, variável na ponta,
 * categoria fora do escopo) é recusado aqui, na hora, com a frase certa.
 */
import { describe, expect, it } from "vitest";

import {
  CATEGORIAS_DA_CRIACAO,
  MENSAGENS_DO_FORMULARIO,
  ROTULO_DO_ESTADO_DO_MODELO,
  acaoDoModeloOficialSchema,
  componentsDoFormulario,
  criarModeloSchema,
  formularioDoModelo,
  variaveisEmSequencia,
  variavelNaPonta,
} from "@/lib/channels/criacao-de-modelo";
import {
  FRASES_DA_CRIACAO,
  MOTIVOS_DA_RECUSA,
  explicarErroDaCriacao,
} from "@/lib/channels/meta/erros-para-operador";
import { DICIONARIO } from "@/lib/i18n/dicionario";

const CRIAR = {
  acao: "criar" as const,
  name: "pedido_chegou",
  language: "pt_BR",
  category: "UTILITY" as const,
  corpo: "Oi {{1}}, seu pedido {{2}} chegou.",
  exemplos: ["Ana", "123"],
  rodape: "Loja da Ana",
  respostasRapidas: ["Quero ver", "Não agora"],
};

describe("criarModeloSchema", () => {
  it("o formulário completo passa", () => {
    expect(criarModeloSchema.safeParse(CRIAR).success).toBe(true);
  });
  it.each([
    ["nome com maiúscula e espaço", { name: "Pedido Chegou" }],
    ["categoria de autenticação", { category: "AUTHENTICATION" }],
    ["idioma fora da lista", { language: "español" }],
    ["um exemplo a menos", { exemplos: ["Ana"] }],
    ["exemplo vazio", { exemplos: ["Ana", " "] }],
    ["variável com buraco", { corpo: "Oi {{1}}, pedido {{3}} chegou.", exemplos: ["Ana", "x", "y"] }],
    ["variável no começo", { corpo: "{{1}}, seu pedido chegou.", exemplos: ["Ana"] }],
    ["variável no fim", { corpo: "Seu pedido chegou, {{1}}", exemplos: ["Ana"] }],
    ["cabeçalho com variável", { cabecalho: "Oi {{1}}", corpo: "Seu pedido chegou.", exemplos: [] }],
    ["quatro respostas rápidas", { respostasRapidas: ["a", "b", "c", "d"] }],
    ["resposta rápida longa demais", { respostasRapidas: ["x".repeat(26)] }],
    ["rodapé longo demais", { rodape: "x".repeat(61) }],
  ])("recusa: %s", (_caso, troca) => {
    expect(criarModeloSchema.safeParse({ ...CRIAR, ...troca }).success).toBe(false);
  });
  it("só Marketing e Utilidade", () => {
    expect([...CATEGORIAS_DA_CRIACAO]).toEqual(["MARKETING", "UTILITY"]);
  });
  it("corpo vazio de pedido é sincronizar (compatível com o botão de hoje)", () => {
    expect(acaoDoModeloOficialSchema.safeParse({ acao: "sincronizar" }).success).toBe(true);
    expect(acaoDoModeloOficialSchema.safeParse({ acao: "apagar", name: "x", language: "pt_BR" }).success).toBe(true);
  });
});

describe("regras do corpo", () => {
  it("sequência e ponta", () => {
    expect(variaveisEmSequencia("a {{1}} b {{2}} c {{1}}")).toBe(true);
    expect(variaveisEmSequencia("a {{2}} b")).toBe(false);
    expect(variavelNaPonta("{{1}} oi")).toBe(true);
    expect(variavelNaPonta("oi {{1}}.")).toBe(false);
  });
});

describe("components para a Meta", () => {
  it("cabeçalho de texto, corpo com example.body_text, rodapé e respostas rápidas num BUTTONS só", () => {
    expect(
      componentsDoFormulario({
        cabecalho: "Pedido",
        corpo: CRIAR.corpo,
        exemplos: CRIAR.exemplos,
        rodape: CRIAR.rodape,
        respostasRapidas: CRIAR.respostasRapidas,
      }),
    ).toEqual([
      { type: "HEADER", format: "TEXT", text: "Pedido" },
      { type: "BODY", text: CRIAR.corpo, example: { body_text: [["Ana", "123"]] } },
      { type: "FOOTER", text: "Loja da Ana" },
      { type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: "Quero ver" }, { type: "QUICK_REPLY", text: "Não agora" }] },
    ]);
  });
  it("ida e volta: o template só texto volta para o formulário; com mídia ou link, não", () => {
    const components = componentsDoFormulario({ cabecalho: "", corpo: CRIAR.corpo, exemplos: CRIAR.exemplos, rodape: "", respostasRapidas: ["Sim"] });
    expect(formularioDoModelo(components)).toEqual({
      cabecalho: "",
      corpo: CRIAR.corpo,
      exemplos: CRIAR.exemplos,
      rodape: "",
      respostasRapidas: ["Sim"],
    });
    expect(formularioDoModelo([{ type: "HEADER", format: "IMAGE" }, { type: "BODY", text: "Oi" }])).toBeNull();
    expect(formularioDoModelo([{ type: "BODY", text: "Oi" }, { type: "BUTTONS", buttons: [{ type: "URL", text: "Ver", url: "https://x.example" }] }])).toBeNull();
  });
});

describe("erros da criação em português", () => {
  it.each([
    ["meta_template_failed: 400 Message template already exists", "Já existe um template com este nome e idioma nesta conta. Use outro nome."],
    ["meta_template_failed: 400 Invalid category for this content", "A Meta não aceitou a categoria escolhida para este texto. Confira se é Marketing ou Utilidade."],
    ["meta_template_failed: 400 Invalid parameter", "A Meta recusou o formato do template: confira o nome, as variáveis e os exemplos."],
  ])("%s", (mensagem, frase) => {
    expect(explicarErroDaCriacao(mensagem)).toMatchObject({ frase, traduzivel: true });
  });
  it("erro desconhecido devolve o texto da Meta, sem o prefixo", () => {
    expect(explicarErroDaCriacao("meta_template_failed: 500 Something odd")).toMatchObject({
      frase: "Something odd",
      traduzivel: false,
    });
  });
});

it("toda frase nova tem espanhol", () => {
  const frases = [
    ...FRASES_DA_CRIACAO,
    ...Object.values(MOTIVOS_DA_RECUSA),
    ...Object.values(MENSAGENS_DO_FORMULARIO),
    ...Object.values(ROTULO_DO_ESTADO_DO_MODELO),
  ];
  for (const frase of frases) expect(DICIONARIO[frase]?.es, frase).toBeTruthy();
});
