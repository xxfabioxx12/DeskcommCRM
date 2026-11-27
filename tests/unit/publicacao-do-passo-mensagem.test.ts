/**
 * A PUBLICAÇÃO DO PASSO "MENSAGEM" — pelo menos uma versão; template que existe
 * na conta, aprovado, em dia e com as lacunas cobertas; variável que resolve; e
 * o template conta como "mensagem que sai fora das 24 h" (Divergência D8).
 */
import { describe, expect, it } from "vitest";

import type { LinhaDoModelo } from "@/lib/campanhas/conferir-template";
import { flowGraphSchema } from "@/lib/followup/graph-schema";
import { chaveDoModelo } from "@/lib/followup/mensagem-do-passo";
import { modelosDaMensagemCitados } from "@/lib/followup/modelos-citados";
import { validateFlowForPublish } from "@/lib/followup/validate-publish";

const COMPONENTES = [{ type: "BODY", text: "Oi {{1}}" }];
// O carimbo é o `meta_templates.contract_hash` gravado pelo sync; aqui basta ser igual dos dois lados.
const HASH = "h1";
const LINHA: LinhaDoModelo = { name: "oi", language: "pt_BR", status: "APPROVED", contract_hash: HASH, components: COMPONENTES, parameter_format: "POSITIONAL", saved_values: {} };
const MODELO = { name: "oi", language: "pt_BR", contract_hash: HASH, slot_map: { "1": "{{primeiro_nome}}" } };
const NA_CONTA = new Map([[chaveDoModelo("oi", "pt_BR"), [LINHA]]]);
const DIA = 86_400_000;

function grafo(config: Record<string, unknown>, esperaMs?: number) {
  const nodes: Array<Record<string, unknown>> = [{ id: "t", type: "trigger", label: "início", position: { x: 0, y: 0 }, config: {} }];
  const edges: Array<Record<string, unknown>> = [];
  let anterior = "t";
  if (esperaMs) {
    nodes.push({ id: "w", type: "wait", label: "espera", position: { x: 1, y: 0 }, config: { mode: "fixed", duration_ms: esperaMs } });
    edges.push({ id: "e-w", source: "t", target: "w", condition: { type: "always" } });
    anterior = "w";
  }
  nodes.push({ id: "m", type: "action", label: "Manda acesso", position: { x: 2, y: 0 }, config });
  nodes.push({ id: "fim", type: "end", label: "fim", position: { x: 3, y: 0 }, config: { outcome: "converted" } });
  edges.push({ id: "e-m", source: anterior, target: "m", condition: { type: "always" } });
  edges.push({ id: "e-f", source: "m", target: "fim", condition: { type: "always" } });
  return flowGraphSchema.parse({ nodes, edges });
}

const codigos = (config: Record<string, unknown>, contexto: Parameters<typeof validateFlowForPublish>[1] = {}, esperaMs?: number) => {
  const r = validateFlowForPublish(grafo(config, esperaMs), contexto);
  return r.ok ? [] : r.errors.map((e) => e.code);
};

describe("publicação do passo Mensagem", () => {
  it("sem nenhuma versão: mensagem_sem_versao", () => {
    expect(codigos({ mode: "mensagem" })).toEqual(["mensagem_sem_versao"]);
  });

  it("só texto, com variável que resolve: publica", () => {
    expect(codigos({ mode: "mensagem", texto: { body: "Oi {{primeiro_nome}}" } })).toEqual([]);
  });

  it("variável desconhecida no texto ou no mapa: variavel_desconhecida", () => {
    expect(codigos({ mode: "mensagem", texto: { body: "Oi {{sobrenome}}" } })).toEqual(["variavel_desconhecida"]);
    expect(codigos({ mode: "mensagem", modelo: { ...MODELO, slot_map: { "1": "{{nome completo}}" } } }, { modelosDaMensagem: NA_CONTA })).toContain("variavel_desconhecida");
  });

  it("template aprovado, em dia e com as lacunas cobertas: publica", () => {
    expect(codigos({ mode: "mensagem", modelo: MODELO }, { modelosDaMensagem: NA_CONTA })).toEqual([]);
  });

  it("template inexistente, pausado, mudado ou com lacuna vazia: modelo_da_mensagem_invalido com o motivo", () => {
    const vazio = new Map<string, LinhaDoModelo[]>();
    const r = validateFlowForPublish(grafo({ mode: "mensagem", modelo: MODELO }), { modelosDaMensagem: vazio });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatchObject({ code: "modelo_da_mensagem_invalido", message: 'A caixa "Manda acesso": o template "oi" não existe nesta conta.' });
    const pausado = new Map([[chaveDoModelo("oi", "pt_BR"), [{ ...LINHA, status: "PAUSED" }]]]);
    expect(codigos({ mode: "mensagem", modelo: MODELO }, { modelosDaMensagem: pausado })).toEqual(["modelo_da_mensagem_invalido"]);
    expect(codigos({ mode: "mensagem", modelo: { ...MODELO, contract_hash: "velho" } }, { modelosDaMensagem: NA_CONTA })).toEqual(["modelo_da_mensagem_invalido"]);
    expect(codigos({ mode: "mensagem", modelo: { ...MODELO, slot_map: {} } }, { modelosDaMensagem: NA_CONTA })).toEqual(["modelo_da_mensagem_invalido"]);
  });

  it("≥ 24 h de espera: só texto recusa (long_wait_needs_template); com template passa", () => {
    expect(codigos({ mode: "mensagem", texto: { body: "Oi" } }, {}, 2 * DIA)).toEqual(["long_wait_needs_template"]);
    expect(codigos({ mode: "mensagem", modelo: MODELO }, { modelosDaMensagem: NA_CONTA }, 2 * DIA)).toEqual([]);
    expect(codigos({ mode: "mensagem", texto: { body: "Oi" } }, { exigeModeloForaDaJanela: false }, 2 * DIA)).toEqual([]);
  });

  it("controle: modos antigos não mudam (texto com 24 h continua passando)", () => {
    expect(codigos({ mode: "text", body: "Oi" }, {}, 2 * DIA)).toEqual([]);
    expect(codigos({ mode: "ai_message", prompt_hint: "x" }, {}, 2 * DIA)).toEqual(["long_wait_needs_template"]);
  });

  it("os templates citados saem do grafo sem repetição", () => {
    expect(modelosDaMensagemCitados(grafo({ mode: "mensagem", modelo: MODELO }).nodes)).toEqual([{ name: "oi", language: "pt_BR" }]);
    expect(modelosDaMensagemCitados(grafo({ mode: "mensagem", texto: { body: "Oi" } }).nodes)).toEqual([]);
  });
});
