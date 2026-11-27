/**
 * A DECISÃO DO PASSO "MENSAGEM" — pura, sobre o que o worker leu.
 *
 * Número que exige template → o template, conferido e preenchido pelas MESMAS
 * funções da campanha; número comum → o texto; versão ausente, dado faltando e
 * template mudado → recusa com o motivo da spec.
 */
import { describe, expect, it } from "vitest";

import type { LinhaDoModelo } from "@/lib/campanhas/conferir-template";
import { CHANNEL_PROVIDER_META, CHANNEL_PROVIDER_WAHA } from "@/lib/channels/capabilities";
import { falhaDoModeloNaConta, fraseDaFalhaNoFluxo } from "@/lib/followup/mensagem-do-passo";
import { montarMensagemDoPasso } from "@/lib/followup/mensagem-do-passo-envio";

const COMPONENTES = [{ type: "BODY", text: "Oi {{1}}, seu acesso: {{2}}" }];
// O carimbo é o `meta_templates.contract_hash` gravado pelo sync; aqui basta ser igual dos dois lados.
const HASH = "h1";
const LINHA: LinhaDoModelo = {
  name: "acesso", language: "pt_BR", status: "APPROVED", contract_hash: HASH,
  components: COMPONENTES, parameter_format: "POSITIONAL", saved_values: {},
};
const MODELO = { name: "acesso", language: "pt_BR", contract_hash: HASH, slot_map: { "1": "{{primeiro_nome}}", "2": "{{contato.link}}" } };
const QUANDO = { agora: new Date("2026-10-21T15:00:00Z"), fuso: "America/Sao_Paulo" };
const ANA = { nome: "Ana Souza", contato: { link: "https://area" }, lead: null };

describe("montarMensagemDoPasso", () => {
  it("número oficial: o template com os valores na ordem do contrato", () => {
    const r = montarMensagemDoPasso({ mensagem: { modelo: MODELO }, provider: CHANNEL_PROVIDER_META, linha: LINHA, valores: ANA, quando: QUANDO });
    expect(r).toEqual({
      tipo: "modelo",
      body: "Oi Ana, seu acesso: https://area",
      modelo: { name: "acesso", language: "pt_BR", values: { "1": "Ana", "2": "https://area" } },
    });
  });

  it("número comum: o texto renderizado", () => {
    const r = montarMensagemDoPasso({
      mensagem: { modelo: MODELO, texto: { body: "Oi {{primeiro_nome}}, acesse {{contato.link}}" } },
      provider: CHANNEL_PROVIDER_WAHA, linha: null, valores: ANA, quando: QUANDO,
    });
    expect(r).toEqual({ tipo: "texto", body: "Oi Ana, acesse https://area" });
  });

  it("versão ausente para o tipo do número: sem mensagem para este tipo de número", () => {
    expect(montarMensagemDoPasso({ mensagem: { modelo: MODELO }, provider: CHANNEL_PROVIDER_WAHA, linha: null, valores: ANA, quando: QUANDO })).toEqual({
      tipo: "recusado",
      motivo: "sem mensagem para este tipo de número",
    });
    expect(montarMensagemDoPasso({ mensagem: { texto: { body: "Oi" } }, provider: CHANNEL_PROVIDER_META, linha: LINHA, valores: ANA, quando: QUANDO })).toEqual({
      tipo: "recusado",
      motivo: "sem mensagem para este tipo de número",
    });
  });

  it("dado faltando no texto: falta o dado: <campo>", () => {
    expect(
      montarMensagemDoPasso({ mensagem: { texto: { body: "Oi {{primeiro_nome}}" } }, provider: CHANNEL_PROVIDER_WAHA, linha: null, valores: { nome: null }, quando: QUANDO }),
    ).toEqual({ tipo: "recusado", motivo: "falta o dado: primeiro_nome" });
  });

  it("⭐ contato sem card: {{lead.x}} vira falta, nunca lacuna em branco", () => {
    const comLead = { ...MODELO, slot_map: { "1": "{{primeiro_nome}}", "2": "{{lead.link}}" } };
    expect(montarMensagemDoPasso({ mensagem: { modelo: comLead }, provider: CHANNEL_PROVIDER_META, linha: LINHA, valores: ANA, quando: QUANDO })).toEqual({
      tipo: "recusado",
      motivo: "falta o dado: lead.link",
    });
  });

  it("template mudou na Meta ou deixou de estar aprovado: recusa com motivo claro", () => {
    const mudou = montarMensagemDoPasso({ mensagem: { modelo: { ...MODELO, contract_hash: "antigo" } }, provider: CHANNEL_PROVIDER_META, linha: LINHA, valores: ANA, quando: QUANDO });
    expect(mudou).toEqual({ tipo: "recusado", motivo: 'o template "acesso" mudou na Meta: escolha de novo no passo do fluxo' });
    const pausado = montarMensagemDoPasso({ mensagem: { modelo: MODELO }, provider: CHANNEL_PROVIDER_META, linha: { ...LINHA, status: "PAUSED" }, valores: ANA, quando: QUANDO });
    expect(pausado).toEqual({ tipo: "recusado", motivo: 'o template "acesso" não está aprovado neste número' });
    const sumiu = montarMensagemDoPasso({ mensagem: { modelo: MODELO }, provider: CHANNEL_PROVIDER_META, linha: null, valores: ANA, quando: QUANDO });
    expect(sumiu).toEqual({ tipo: "recusado", motivo: 'o template "acesso" não existe no número desta conversa' });
  });

  it("conexão desconhecida (provider nulo): recusa sem tentar", () => {
    expect(montarMensagemDoPasso({ mensagem: { modelo: MODELO }, provider: null, linha: null, valores: ANA, quando: QUANDO })).toEqual({
      tipo: "recusado",
      motivo: "a conexão desta conversa não foi encontrada",
    });
  });
});

describe("regras da publicação (sem servidor)", () => {
  it("na conta: passa se alguma linha serve; sem linha = não existe nesta conta", () => {
    expect(falhaDoModeloNaConta(MODELO, [{ ...LINHA, status: "PAUSED" }, LINHA])).toBeNull();
    const falha = falhaDoModeloNaConta(MODELO, []);
    expect(falha).toEqual({ tipo: "vinculo", estado: "missing" });
    expect(fraseDaFalhaNoFluxo(falha!, "acesso", "conta")).toBe('o template "acesso" não existe nesta conta');
  });
});
