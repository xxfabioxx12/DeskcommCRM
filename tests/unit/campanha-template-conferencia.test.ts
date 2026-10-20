/**
 * A CONFERÊNCIA NO SERVIDOR — não só na tela.
 *
 * Hoje uma campanha de texto num número oficial passa calada e falha cliente por
 * cliente (131047). A partir daqui, salvar/preparar/iniciar recusam com 422 e a
 * frase que diz o que fazer.
 */
import { describe, expect, it } from "vitest";

import {
  CHANNEL_PROVIDER_META,
  CHANNEL_PROVIDER_WAHA,
  CHANNEL_PROVIDER_ZERNIO,
} from "@/lib/channels/capabilities";
import { DICIONARIO } from "@/lib/i18n/dicionario";
import {
  CONTEUDO_EM_TEXTO,
  MENSAGENS_DA_CONFERENCIA,
  avaliarConteudoDaCampanha,
  colunasDoConteudo,
  conteudoDaLinha,
  conteudoDoTemplateMudou,
  conteudoMesclado,
  type ConteudoDaCampanha,
  type LinhaDoModelo,
} from "@/lib/campanhas/conferir-template";
import { TEXTO_DA_FALHA_DA_CAMPANHA } from "@/lib/campanhas/tipos";

const OFICIAL = { id: "s-oficial", provider: CHANNEL_PROVIDER_META };
const OFICIAL_2 = { id: "s-oficial-2", provider: CHANNEL_PROVIDER_META };
const PARCEIRO = { id: "s-parceiro", provider: CHANNEL_PROVIDER_ZERNIO };
const QR = { id: "s-qr", provider: CHANNEL_PROVIDER_WAHA };

const linha = (over: Partial<LinhaDoModelo> = {}): LinhaDoModelo => ({
  name: "boas_vindas",
  language: "pt_BR",
  status: "APPROVED",
  contract_hash: "h1",
  components: [{ type: "BODY", text: "Oi {{1}}, o {{2}} chegou." }],
  parameter_format: "POSITIONAL",
  saved_values: {},
  ...over,
});

const TEMPLATE: ConteudoDaCampanha = {
  messageMode: "template",
  templateName: "boas_vindas",
  templateLanguage: "pt_BR",
  templateContractHash: "h1",
  slotMap: { "1": "{{primeiro_nome}}", "2": "Super Presell" },
};

const linhas = (pares: Array<[string, LinhaDoModelo | null]>) => new Map(pares);

describe("a capacidade do número decide texto × template", () => {
  it("número oficial recusa texto livre com 422 e a explicação das 24 horas", () => {
    const r = avaliarConteudoDaCampanha(CONTEUDO_EM_TEXTO, [OFICIAL], linhas([]));
    expect(r).toMatchObject({ ok: false, codigo: "campanha_exige_template", status: 422 });
    expect(!r.ok && r.mensagem).toBe(MENSAGENS_DA_CONFERENCIA.exige_template);
  });
  it("parceiro oficial também exige (capacidade, não nome)", () => {
    expect(avaliarConteudoDaCampanha(CONTEUDO_EM_TEXTO, [PARCEIRO], linhas([])).ok).toBe(false);
  });
  it("QR Code recusa template", () => {
    const r = avaliarConteudoDaCampanha(TEMPLATE, [QR], linhas([]));
    expect(r).toMatchObject({ ok: false, codigo: "campanha_template_invalido", status: 422 });
    expect(!r.ok && r.mensagem).toBe(MENSAGENS_DA_CONFERENCIA.nao_usa_template);
  });
  it("QR Code com texto segue como hoje", () => {
    expect(avaliarConteudoDaCampanha(CONTEUDO_EM_TEXTO, [QR], linhas([]))).toEqual({ ok: true, definicao: null });
  });
  it("números de tipos diferentes recusam", () => {
    const r = avaliarConteudoDaCampanha(TEMPLATE, [OFICIAL, QR], linhas([[OFICIAL.id, linha()]]));
    expect(!r.ok && r.mensagem).toBe(MENSAGENS_DA_CONFERENCIA.numeros_misturados);
  });
  it("número principal desconhecido é 409", () => {
    expect(avaliarConteudoDaCampanha(TEMPLATE, [], linhas([]))).toMatchObject({
      ok: false,
      codigo: "campanha_canal_indisponivel",
      status: 409,
    });
    expect(
      avaliarConteudoDaCampanha(TEMPLATE, [{ id: "x", provider: "telegram" }], linhas([])),
    ).toMatchObject({ ok: false, codigo: "campanha_canal_indisponivel" });
  });
});

describe("o vínculo com o template, em cada número", () => {
  it("template aprovado, mesmo carimbo e mapa completo: ok com a definição", () => {
    const r = avaliarConteudoDaCampanha(TEMPLATE, [OFICIAL], linhas([[OFICIAL.id, linha()]]));
    expect(r.ok).toBe(true);
    expect(r.ok && r.definicao).toMatchObject({ name: "boas_vindas", language: "pt_BR", parameterFormat: "POSITIONAL", salvos: {} });
  });
  it("template que não existe mais no número", () => {
    const r = avaliarConteudoDaCampanha(TEMPLATE, [OFICIAL], linhas([[OFICIAL.id, null]]));
    expect(r).toMatchObject({ ok: false, codigo: "campanha_template_invalido", falha: "template_nao_aprovado" });
    expect(!r.ok && r.mensagem).toBe(MENSAGENS_DA_CONFERENCIA.template_inexistente);
  });
  it("template pausado pela Meta", () => {
    const r = avaliarConteudoDaCampanha(TEMPLATE, [OFICIAL], linhas([[OFICIAL.id, linha({ status: "PAUSED" })]]));
    expect(r).toMatchObject({ ok: false, falha: "template_nao_aprovado" });
    expect(!r.ok && r.mensagem).toBe(TEXTO_DA_FALHA_DA_CAMPANHA.template_nao_aprovado);
  });
  it("template que mudou na Meta (carimbo diferente)", () => {
    const r = avaliarConteudoDaCampanha(TEMPLATE, [OFICIAL], linhas([[OFICIAL.id, linha({ contract_hash: "h2" })]]));
    expect(r).toMatchObject({ ok: false, falha: "template_mudou" });
    expect(!r.ok && r.mensagem).toBe(TEXTO_DA_FALHA_DA_CAMPANHA.template_mudou);
  });
  it("número extra sem o template recusa", () => {
    const r = avaliarConteudoDaCampanha(
      TEMPLATE,
      [OFICIAL, OFICIAL_2],
      linhas([
        [OFICIAL.id, linha()],
        [OFICIAL_2.id, null],
      ]),
    );
    expect(r).toMatchObject({ ok: false, falha: "template_nao_aprovado" });
  });
  it("cabeçalho de mídia sem link salvo é recusado; com o link, passa e o link vai junto", () => {
    const comImagem = [{ type: "HEADER", format: "IMAGE" }, { type: "BODY", text: "Oi {{1}}, o {{2}} chegou." }];
    const sem = avaliarConteudoDaCampanha(TEMPLATE, [OFICIAL], linhas([[OFICIAL.id, linha({ components: comImagem })]]));
    expect(!sem.ok && sem.mensagem).toBe(MENSAGENS_DA_CONFERENCIA.midia_sem_link);
    const com = avaliarConteudoDaCampanha(
      TEMPLATE,
      [OFICIAL],
      linhas([[OFICIAL.id, linha({ components: comImagem, saved_values: { "header:1": "https://cdn.example/capa.png" } })]]),
    );
    expect(com.ok && com.definicao?.salvos).toEqual({ "header:1": "https://cdn.example/capa.png" });
  });
  it("mapa incompleto e mapa com sobra são recusados", () => {
    const incompleto = avaliarConteudoDaCampanha({ ...TEMPLATE, slotMap: { "1": "{{nome}}" } }, [OFICIAL], linhas([[OFICIAL.id, linha()]]));
    expect(!incompleto.ok && incompleto.mensagem).toBe(MENSAGENS_DA_CONFERENCIA.variaveis_faltando);
    const sobra = avaliarConteudoDaCampanha(
      { ...TEMPLATE, slotMap: { ...TEMPLATE.slotMap, "3": "x" } },
      [OFICIAL],
      linhas([[OFICIAL.id, linha()]]),
    );
    expect(!sobra.ok && sobra.mensagem).toBe(MENSAGENS_DA_CONFERENCIA.variaveis_sobrando);
  });
});

describe("mesclar e comparar o conteúdo", () => {
  it("a linha do banco vira conteúdo; campanha antiga é texto", () => {
    expect(conteudoDaLinha({})).toEqual(CONTEUDO_EM_TEXTO);
    expect(
      conteudoDaLinha({
        message_mode: "template",
        template_name: "boas_vindas",
        template_language: "pt_BR",
        template_contract_hash: "h1",
        template_slot_map: { "1": "{{primeiro_nome}}", "2": "Super Presell", "3": 9 },
      }),
    ).toEqual(TEMPLATE);
  });
  it("PATCH parcial mescla sobre o que estava; voltar para texto limpa o template", () => {
    expect(conteudoMesclado(TEMPLATE, { template_slot_map: { "1": "{{nome}}", "2": "x" } }).slotMap).toEqual({ "1": "{{nome}}", "2": "x" });
    expect(conteudoMesclado(TEMPLATE, { message_mode: "text" })).toEqual(CONTEUDO_EM_TEXTO);
  });
  it("mudar mapa, nome, idioma ou carimbo muda o conteúdo; reordenar o mapa não", () => {
    expect(conteudoDoTemplateMudou(TEMPLATE, { ...TEMPLATE, slotMap: { "2": "Super Presell", "1": "{{primeiro_nome}}" } })).toBe(false);
    expect(conteudoDoTemplateMudou(TEMPLATE, { ...TEMPLATE, slotMap: { "1": "{{nome}}", "2": "Super Presell" } })).toBe(true);
    expect(conteudoDoTemplateMudou(TEMPLATE, { ...TEMPLATE, templateContractHash: "h2" })).toBe(true);
    expect(conteudoDoTemplateMudou(CONTEUDO_EM_TEXTO, CONTEUDO_EM_TEXTO)).toBe(false);
  });
  it("as colunas gravadas são as da migration 0704", () => {
    expect(Object.keys(colunasDoConteudo(TEMPLATE)).sort()).toEqual(
      ["message_mode", "template_contract_hash", "template_language", "template_name", "template_slot_map"],
    );
  });
});

describe("variável desconhecida no mapa (P17)", () => {
  it("recusa {{nmae}} com 422 e a frase que lista as variáveis válidas", () => {
    const r = avaliarConteudoDaCampanha(
      { ...TEMPLATE, slotMap: { "1": "{{nmae}}", "2": "Super Presell" } },
      [OFICIAL],
      linhas([[OFICIAL.id, linha()]]),
    );
    expect(r).toMatchObject({ ok: false, codigo: "campanha_template_invalido", status: 422 });
    expect(!r.ok && r.mensagem).toBe(MENSAGENS_DA_CONFERENCIA.variavel_desconhecida);
  });
  it("aceita as variáveis conhecidas, inclusive contato.x e lead.x", () => {
    const r = avaliarConteudoDaCampanha(
      { ...TEMPLATE, slotMap: { "1": "{{contato.cidade}} {{saudacao}}", "2": "{{lead.gancho}} {{nome}}" } },
      [OFICIAL],
      linhas([[OFICIAL.id, linha()]]),
    );
    expect(r.ok).toBe(true);
  });
});

it("toda mensagem da conferência tem espanhol", () => {
  for (const mensagem of Object.values(MENSAGENS_DA_CONFERENCIA)) {
    expect(DICIONARIO[mensagem]?.es, mensagem).toBeTruthy();
  }
});
