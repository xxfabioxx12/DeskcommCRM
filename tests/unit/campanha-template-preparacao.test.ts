/**
 * A PREPARAÇÃO POR TEMPLATE: cada pessoa com as SUAS variáveis, e quem fica sem
 * dado fica de fora com o motivo que já existe (`variavel_ausente`).
 *
 * Usa o MESMO `classificarAudiencia` da preparação — classificação que mede por
 * outro caminho é prévia que mente.
 */
import { describe, expect, it } from "vitest";

import { classificarAudiencia, type CandidatoDaAudiencia } from "@/lib/campanhas/elegibilidade";
import { classificadorDoConteudo } from "@/lib/campanhas/preparacao";
import { camposUsadosNoTexto, renderizar } from "@/lib/campanhas/renderizador";

const candidato = (over: Partial<CandidatoDaAudiencia>): CandidatoDaAudiencia => ({
  contactId: "c1",
  telefone: "+5511999990001",
  bloqueado: false,
  pessoal: false,
  anonimizado: false,
  recusouMarketing: false,
  nome: "Ana Souza",
  lead: null,
  contato: null,
  ...over,
});

const contexto = (renderizarCandidato: (c: CandidatoDaAudiencia) => { texto: string; faltando: string[] }) => ({
  excluidosAMao: new Set<string>(),
  jaEmCampanha: new Set<string>(),
  suprimidos: new Set<string>(),
  hashDoEndereco: (e: string) => e,
  renderizar: renderizarCandidato,
});

const MODELO = {
  name: "cidade",
  language: "pt_BR",
  parameterFormat: "POSITIONAL",
  components: [{ type: "BODY", text: "Oi {{1}}, você está em {{2}}." }],
};
const MAPA = { "1": "{{primeiro_nome}}", "2": "{{contato.cidade}}" };

describe("classificadorDoConteudo — template", () => {
  it("resolve por pessoa, congela os valores e monta a prévia do corpo", () => {
    const cls = classificadorDoConteudo({ corpo: "", slotMap: MAPA, modelo: MODELO });
    const [linha] = classificarAudiencia([candidato({ contato: { cidade: "Porto Alegre" } })], contexto(cls.renderizar));
    expect(linha).toMatchObject({ elegivel: true, corpo: "Oi Ana, você está em Porto Alegre." });
    expect(cls.valoresDe("c1")).toEqual({ "1": "Ana", "2": "Porto Alegre" });
  });

  it("variável vazia tira a pessoa da lista com `variavel_ausente`", () => {
    const cls = classificadorDoConteudo({ corpo: "", slotMap: MAPA, modelo: MODELO });
    const linhas = classificarAudiencia(
      [candidato({ contato: { cidade: "Porto Alegre" } }), candidato({ contactId: "c2", telefone: "+5511999990002", contato: {} })],
      contexto(cls.renderizar),
    );
    expect(linhas.map((l) => [l.candidato.contactId, l.motivo])).toEqual([
      ["c1", null],
      ["c2", "variavel_ausente"],
    ]);
    expect(cls.valoresDe("c2")).toBeNull();
  });

  it("campo de várias linhas vira uma linha só no valor congelado", () => {
    const cls = classificadorDoConteudo({ corpo: "", slotMap: MAPA, modelo: MODELO });
    classificarAudiencia([candidato({ contato: { cidade: "Porto\nAlegre" } })], contexto(cls.renderizar));
    expect(cls.valoresDe("c1")?.["2"]).toBe("Porto Alegre");
  });

  it("os campos personalizados só são buscados quando alguma expressão os usa", () => {
    expect(camposUsadosNoTexto(classificadorDoConteudo({ corpo: "", slotMap: MAPA }).textoParaCampos)).toEqual({
      lead: false,
      contato: true,
    });
    expect(
      camposUsadosNoTexto(classificadorDoConteudo({ corpo: "", slotMap: { "1": "{{nome}}" } }).textoParaCampos),
    ).toEqual({ lead: false, contato: false });
  });
});

describe("classificadorDoConteudo — texto (nada muda)", () => {
  it("renderiza exatamente como antes e não guarda valores de template", () => {
    const cls = classificadorDoConteudo({ corpo: "Oi {{nome}}, {{saudacao}}" });
    const c = candidato({});
    const antes = renderizar("Oi {{nome}}, {{saudacao}}", { nome: c.nome, lead: c.lead, contato: c.contato });
    expect(cls.renderizar(c)).toEqual({ texto: antes.texto, faltando: antes.faltando });
    expect(cls.textoParaCampos).toBe("Oi {{nome}}, {{saudacao}}");
    expect(cls.valoresDe("c1")).toBeNull();
  });
});
