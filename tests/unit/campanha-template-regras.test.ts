/**
 * AS REGRAS PURAS DA CAMPANHA POR TEMPLATE — a mesma função na tela e no servidor.
 *
 * O número decide o tipo de mensagem pela CAPACIDADE do canal; o template decide
 * quais variáveis existem (derivadas, nunca contadas à mão); e cada valor que vai
 * para a plataforma sai numa linha só — parâmetro com quebra de linha é recusado
 * para a lista inteira que tem aquele campo.
 */
import { describe, expect, it } from "vitest";

import { CHANNEL_PROVIDER_META, CHANNEL_PROVIDER_WAHA } from "@/lib/channels/capabilities";
import { deriveTemplateContract } from "@/lib/channels/meta/template-contract";
import { DICIONARIO } from "@/lib/i18n/dicionario";
import {
  CATEGORIA_DO_MODELO,
  MOTIVOS_DE_MODELO_INUTILIZAVEL,
  TEXTO_DO_MODELO_INUTILIZAVEL,
  avaliarModeloParaCampanha,
  canalExigeTemplate,
  conferirMapaDeSlots,
  finalizarValores,
  intervaloMinimoDoCanal,
  lerValoresPreparados,
  limparMapaDeSlots,
  mensagemPronta,
  normalizarValorDoSlot,
  payloadDaMensagem,
  resolverSlots,
  resumoDoCorpo,
  slotsDoContrato,
  textoDasExpressoes,
} from "@/lib/campanhas/template-da-campanha";

const CONTRATO = deriveTemplateContract({
  name: "chegou",
  language: "pt_BR",
  components: [
    { type: "HEADER", format: "IMAGE" },
    { type: "BODY", text: "Oi {{1}}, o {{2}} chegou." },
    { type: "BUTTONS", buttons: [{ type: "URL", text: "Ver", url: "https://loja.example/{{1}}" }] },
  ] as never,
});
const SLOTS = slotsDoContrato(CONTRATO);
// 15h em São Paulo: "Boa tarde".
const QUANDO = { agora: new Date("2026-10-20T18:00:00.000Z"), fuso: "America/Sao_Paulo" };

describe("capacidade do canal", () => {
  it("oficial exige template, QR Code não; desconhecido é null", () => {
    expect(canalExigeTemplate(CHANNEL_PROVIDER_META)).toBe(true);
    expect(canalExigeTemplate(CHANNEL_PROVIDER_WAHA)).toBe(false);
    expect(canalExigeTemplate("telegram")).toBeNull();
    expect(canalExigeTemplate(null)).toBeNull();
  });
  it("intervalo mínimo da plataforma: 6 s no oficial, nenhum no QR Code", () => {
    expect(intervaloMinimoDoCanal(CHANNEL_PROVIDER_META)).toBe(6000);
    expect(intervaloMinimoDoCanal(CHANNEL_PROVIDER_WAHA)).toBeNull();
    expect(intervaloMinimoDoCanal(undefined)).toBeNull();
  });
});

describe("slots e avaliação do template", () => {
  it("as chaves são as do slotKey: cabeçalho, corpo e botão", () => {
    expect(SLOTS.map((s) => s.valueKey)).toEqual(["header:1", "1", "2", "button0:1"]);
  });
  it("cabeçalho de mídia sem link salvo deixa o template inutilizável", () => {
    const r = avaliarModeloParaCampanha(SLOTS, {});
    expect(r).toMatchObject({ usavel: false, motivo: "midia_sem_link", slot: { valueKey: "header:1" } });
  });
  it("com o link salvo, a campanha preenche corpo e botão; a mídia vem do link", () => {
    const r = avaliarModeloParaCampanha(SLOTS, { "header:1": "https://cdn.example/capa.png" });
    expect(r.usavel).toBe(true);
    if (!r.usavel) return;
    expect(r.preencher.map((s) => s.valueKey)).toEqual(["1", "2", "button0:1"]);
    expect(r.midia.map((s) => s.valueKey)).toEqual(["header:1"]);
  });
  it("valor em dinheiro ou data fica de fora", () => {
    const r = avaliarModeloParaCampanha([{ key: "1", valueKey: "1", expects: "currency", onde: "corpo" }], {});
    expect(r).toMatchObject({ usavel: false, motivo: "tipo_nao_suportado" });
  });
  it("mapa incompleto e mapa com sobra são recusados", () => {
    const r = avaliarModeloParaCampanha(SLOTS, { "header:1": "https://cdn.example/capa.png" });
    if (!r.usavel) throw new Error("fixture");
    expect(conferirMapaDeSlots(r.preencher, { "1": "{{nome}}", "2": "x" })).toEqual({
      tipo: "faltando",
      chaves: ["button0:1"],
    });
    expect(conferirMapaDeSlots(r.preencher, { "1": "a", "2": "b", "button0:1": "c", "9": "d" })).toEqual({
      tipo: "sobrando",
      chaves: ["9"],
    });
    expect(conferirMapaDeSlots(r.preencher, { "1": "a", "2": "b", "button0:1": "c" })).toBeNull();
  });
});

describe("resolução por pessoa", () => {
  it("expressão vira valor; texto fixo passa direto", () => {
    expect(resolverSlots({ "1": "{{primeiro_nome}}", "2": "Super Presell" }, { nome: "Ana Souza" })).toEqual({
      valores: { "1": "Ana", "2": "Super Presell" },
      faltando: [],
    });
  });
  it("campo personalizado vazio é FALTA (a pessoa sai da lista)", () => {
    const r = resolverSlots({ "1": "{{contato.cidade}}" }, { nome: "Ana", contato: {} });
    expect(r.faltando).toEqual(["contato.cidade"]);
    expect(r.valores).toEqual({});
  });
  it("normaliza quebra de linha, tabulação e espaço repetido", () => {
    expect(normalizarValorDoSlot("Rua A\nnº 10\t\tcentro    sul ")).toBe("Rua A nº 10 centro sul");
    const r = resolverSlots({ "1": "{{contato.endereco}}" }, { nome: "Ana", contato: { endereco: "Rua A\r\nnº 10" } });
    expect(r.valores["1"]).toBe("Rua A nº 10");
  });
  it("{{saudacao}} fica para o envio, e o envio a resolve no fuso do número", () => {
    const preparado = resolverSlots({ "1": "{{saudacao}}, {{primeiro_nome}}" }, { nome: "Ana Souza" });
    expect(preparado.valores["1"]).toBe("{{saudacao}}, Ana");
    expect(finalizarValores(preparado.valores, "Ana Souza", QUANDO).valores["1"]).toBe("Boa tarde, Ana");
  });
  it("valor do cadastro com cara de variável NÃO vira variável na segunda passada", () => {
    const preparado = resolverSlots({ "1": "{{contato.apelido}}" }, { nome: "Ana", contato: { apelido: "{{saudacao}}" } });
    expect(finalizarValores(preparado.valores, "Ana", QUANDO).valores["1"]).toBe("{{saudacao}}");
  });
  it("as expressões juntas alimentam o detector de campos personalizados", () => {
    expect(textoDasExpressoes({ "1": "{{lead.gancho}}", "2": "fixo" })).toBe("{{lead.gancho}}\nfixo");
  });
  it("lê só valores em texto do jsonb do destinatário", () => {
    expect(lerValoresPreparados({ nome: "Ana", template_values: { "1": "Ana", "2": 3 } })).toEqual({ "1": "Ana" });
    expect(lerValoresPreparados(null)).toEqual({});
    expect(limparMapaDeSlots({ "1": " {{nome}} ", "2": "", "3": 4 })).toEqual({ "1": "{{nome}}" });
  });
});

describe("resumo do corpo no seletor", () => {
  it("uma linha, cortada com reticência", () => {
    expect(resumoDoCorpo([{ type: "HEADER", text: "Promo" }, { type: "BODY", text: "Oi {{1}},\n o pedido chegou" }])).toBe(
      "Oi {{1}}, o pedido chegou",
    );
    expect(resumoDoCorpo([{ type: "BODY", text: "x".repeat(80) }], 10)).toBe(`${"x".repeat(9)}…`);
    expect(resumoDoCorpo(null)).toBe("");
  });
});

describe("o formulário", () => {
  const modelo = { name: "chegou", language: "pt_BR", contractHash: "h1" };
  it("número de QR Code manda texto, como hoje", () => {
    expect(payloadDaMensagem({ texto: " Oi {{nome}} ", modelo: null, slotMap: {} }, false)).toEqual({
      message_mode: "text",
      message_body: "Oi {{nome}}",
      template_name: null,
      template_language: null,
      template_contract_hash: null,
      template_slot_map: {},
    });
  });
  it("número oficial manda o template e o mapa limpo, sem texto livre", () => {
    expect(
      payloadDaMensagem({ texto: "sobra", modelo, slotMap: { "1": " {{nome}} ", "2": "" } }, true),
    ).toEqual({
      message_mode: "template",
      message_body: null,
      template_name: "chegou",
      template_language: "pt_BR",
      template_contract_hash: "h1",
      template_slot_map: { "1": "{{nome}}" },
    });
  });
  it("pronto para salvar: texto no QR; template + todas as variáveis no oficial", () => {
    const preencher = [{ key: "1", valueKey: "1", expects: "text", onde: "corpo" }];
    expect(mensagemPronta({ texto: "Oi", modelo: null, slotMap: {} }, false, null)).toBe(true);
    expect(mensagemPronta({ texto: "", modelo: null, slotMap: {} }, false, null)).toBe(false);
    expect(mensagemPronta({ texto: "", modelo, slotMap: {} }, true, preencher)).toBe(false);
    expect(mensagemPronta({ texto: "", modelo, slotMap: { "1": "{{nome}}" } }, true, preencher)).toBe(true);
    expect(mensagemPronta({ texto: "", modelo, slotMap: { "1": "{{nome}}" } }, true, null)).toBe(false);
  });
});

it("todo rótulo de motivo e de categoria tem espanhol", () => {
  for (const motivo of MOTIVOS_DE_MODELO_INUTILIZAVEL) {
    expect(DICIONARIO[TEXTO_DO_MODELO_INUTILIZAVEL[motivo]]?.es, motivo).toBeTruthy();
  }
  for (const rotulo of Object.values(CATEGORIA_DO_MODELO)) expect(DICIONARIO[rotulo]?.es, rotulo).toBeTruthy();
});
