/**
 * A CONFERÊNCIA DO TEMPLATE TEM UMA FONTE SÓ — a campanha e o passo "Mensagem"
 * do fluxo chamam a MESMA função (Risco 2 da spec: Supabase × pg no worker).
 */
import { describe, expect, it } from "vitest";

import {
  COLUNAS_DO_MODELO,
  COLUNAS_DO_MODELO_LISTA,
  avaliarConteudoDaCampanha,
  conferirModeloComMapa,
  type LinhaDoModelo,
} from "@/lib/campanhas/conferir-template";
import { CHANNEL_PROVIDER_META } from "@/lib/channels/capabilities";

const COMPONENTES = [{ type: "BODY", text: "Oi {{1}}, seu acesso: {{2}}" }];
// O carimbo é o `meta_templates.contract_hash` gravado pelo sync; aqui basta ser igual dos dois lados.
const HASH = "h1";

const linha = (extra: Partial<LinhaDoModelo> = {}): LinhaDoModelo => ({
  name: "acesso",
  language: "pt_BR",
  status: "APPROVED",
  contract_hash: HASH,
  components: COMPONENTES,
  parameter_format: "POSITIONAL",
  saved_values: {},
  ...extra,
});

const vinculo = (slotMap: Record<string, string>, hash = HASH) => ({
  templateName: "acesso",
  templateLanguage: "pt_BR",
  templateContractHash: hash,
  slotMap,
});

describe("conferirModeloComMapa", () => {
  it("as colunas viram a lista e a string de antes, sem um espaço a mais", () => {
    expect(COLUNAS_DO_MODELO).toBe("name, language, status, contract_hash, components, parameter_format, saved_values");
    expect(COLUNAS_DO_MODELO_LISTA.join(", ")).toBe(COLUNAS_DO_MODELO);
  });

  it("template aprovado, em dia e com as duas lacunas cobertas: ok, com os slots a preencher", () => {
    const r = conferirModeloComMapa(vinculo({ "1": "{{primeiro_nome}}", "2": "{{contato.link}}" }), linha());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.preencher.map((s) => s.valueKey)).toEqual(["1", "2"]);
  });

  it("sem linha, pausado e contrato diferente viram falha de vínculo, na precedência do binding", () => {
    expect(conferirModeloComMapa(vinculo({}), null)).toEqual({ ok: false, falha: { tipo: "vinculo", estado: "missing" } });
    expect(conferirModeloComMapa(vinculo({}), linha({ status: "PAUSED" }))).toEqual({ ok: false, falha: { tipo: "vinculo", estado: "not_approved" } });
    expect(conferirModeloComMapa(vinculo({}, "outro"), linha())).toEqual({ ok: false, falha: { tipo: "vinculo", estado: "stale" } });
  });

  it("lacuna sem expressão e expressão sobrando", () => {
    expect(conferirModeloComMapa(vinculo({ "1": "x" }), linha())).toEqual({ ok: false, falha: { tipo: "variaveis_faltando" } });
    expect(conferirModeloComMapa(vinculo({ "1": "x", "2": "y", "3": "z" }), linha())).toEqual({ ok: false, falha: { tipo: "variaveis_sobrando" } });
  });

  it("controle: a campanha continua com as MESMAS recusas (mapa faltando, variável desconhecida)", () => {
    const sessoes = [{ id: "s1", provider: CHANNEL_PROVIDER_META }];
    const conteudo = (slotMap: Record<string, string>) => ({ messageMode: "template" as const, ...vinculo(slotMap) });
    expect(avaliarConteudoDaCampanha(conteudo({ "1": "x" }), sessoes, new Map([["s1", linha()]]))).toMatchObject({
      ok: false,
      mensagem: "Preencha todas as variáveis do template.",
    });
    expect(avaliarConteudoDaCampanha(conteudo({ "1": "x", "2": "{{sobrenome}}" }), sessoes, new Map([["s1", linha()]]))).toMatchObject({
      ok: false,
      mensagem: expect.stringContaining("variável desconhecida"),
    });
    expect(avaliarConteudoDaCampanha(conteudo({ "1": "x", "2": "y" }), sessoes, new Map([["s1", linha()]]))).toMatchObject({ ok: true });
  });
});
