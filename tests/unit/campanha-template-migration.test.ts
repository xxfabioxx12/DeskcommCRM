/**
 * A MIGRATION 9001 (campanha com template aprovado) É TRIPLA E FALA A LÍNGUA DO TYPESCRIPT.
 *
 * O kit self-host aplica SÓ o `supabase/baseline.sql`: migration sem apêndice não
 * chega a quem instalou numa VPS, e a rota de campanhas passaria a gravar colunas
 * que o banco do cliente não tem (42703). E o CHECK de `message_mode` tem par em
 * `MODOS_DA_MENSAGEM` — um valor só de um lado vira 23514 no caminho pouco usado.
 *
 * Cerca estática (lê arquivo), sem Postgres: o ciclo install→update de verdade é
 * o `pnpm test:db`, que precisa de Docker.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { DICIONARIO } from "@/lib/i18n/dicionario";
import {
  FALHAS_QUE_PAUSAM_A_CAMPANHA,
  FALHAS_DE_TEMPLATE_DA_CAMPANHA,
  MODOS_DA_MENSAGEM,
  TEXTO_DA_FALHA_DA_CAMPANHA,
  ehFalhaDeTemplateDaCampanha,
  ehFalhaQuePausaACampanha,
} from "@/lib/campanhas/tipos";

const RAIZ = join(__dirname, "..", "..");
const MIGRATION = "supabase/migrations/20261021130704_9001_campanha_com_template.sql";

function ler(caminho: string): string {
  return readFileSync(join(RAIZ, caminho), "utf8");
}

/** O SQL executável da migration: do primeiro `alter table` ao `notify`. */
function corpoSql(texto: string): string {
  const inicio = texto.indexOf("alter table public.campaigns\n  add column if not exists message_mode");
  const fim = "notify pgrst, 'reload schema';";
  const j = texto.indexOf(fim, inicio);
  return inicio >= 0 && j > inicio ? texto.slice(inicio, j + fim.length) : "";
}

describe("migration 9001 — campanha com template aprovado", () => {
  it("existe e a primeira linha é a descrição `-- manifest:`", () => {
    expect(existsSync(join(RAIZ, MIGRATION))).toBe(true);
    expect(ler(MIGRATION).split("\n")[0]).toMatch(/^-- manifest: \S/);
  });

  it("acrescenta as seis colunas com `add column if not exists`", () => {
    const sql = ler(MIGRATION);
    for (const coluna of [
      "message_mode text not null default 'text'",
      "template_name text",
      "template_language text",
      "template_contract_hash text",
      "template_slot_map jsonb not null default '{}'::jsonb",
      "duplicated_from_campaign_id uuid",
    ]) {
      expect(sql, coluna).toContain(`add column if not exists ${coluna}`);
    }
  });

  it("o CHECK de vocabulário tem exatamente os valores de MODOS_DA_MENSAGEM", () => {
    const m = /campaigns_message_mode_check\s+check \(message_mode in \(([^)]*)\)\)/.exec(ler(MIGRATION));
    expect(m, "constraint campaigns_message_mode_check não encontrada").not.toBeNull();
    const valores = [...m![1]!.matchAll(/'([^']+)'/g)].map((v) => v[1]);
    expect(valores).toEqual([...MODOS_DA_MENSAGEM]);
  });

  it("o apêndice do baseline contém o SQL da migration sem uma diferença", () => {
    const corpo = corpoSql(ler(MIGRATION));
    // Guarda de vacuidade: um recorte vazio estaria "contido" em qualquer arquivo.
    expect(corpo.length).toBeGreaterThan(400);
    const baseline = ler("supabase/baseline.sql");
    expect(baseline).toContain("(migration 9001");
    expect(baseline.includes(corpo)).toBe(true);
  });

  it("a cópia do fork (supabase/fork/9001.sql) está no baseline uma vez, depois da varredura e antes do 9004", () => {
    // O script scripts/fork/reaplicar-bloco-do-fork.sh reacrescenta esta cópia
    // depois de cada atualização do oficial; cópia diferente reaplicaria outro SQL.
    // Blocos sem função ficam depois da varredura anon, em ordem de número.
    const copia = ler("supabase/fork/9001.sql");
    expect(copia.startsWith("-- ---- campanha com template aprovado (migration 9001")).toBe(true);
    const baseline = ler("supabase/baseline.sql");
    expect(baseline.split(copia)).toHaveLength(2);
    const onde = baseline.indexOf(copia);
    expect(onde).toBeGreaterThan(baseline.indexOf("-- ---- VARREDURA anon:"));
    expect(onde).toBeLessThan(baseline.indexOf(ler("supabase/fork/9004.sql")));
  });

  it("toda falha de template da campanha tem frase, e a frase tem espanhol", () => {
    for (const falha of FALHAS_DE_TEMPLATE_DA_CAMPANHA) {
      const frase = TEXTO_DA_FALHA_DA_CAMPANHA[falha];
      expect(frase.length).toBeGreaterThan(10);
      expect(DICIONARIO[frase]?.es, frase).toBeTruthy();
      expect(ehFalhaDeTemplateDaCampanha(falha)).toBe(true);
    }
    expect(ehFalhaDeTemplateDaCampanha("audiencia_vazia")).toBe(false);
    // O disjuntor pausa por motivo que NÃO é do template, e também tem frase.
    expect(FALHAS_QUE_PAUSAM_A_CAMPANHA).toEqual(
      expect.arrayContaining([...FALHAS_DE_TEMPLATE_DA_CAMPANHA, "numero_com_problema", "falhas_seguidas"]),
    );
    for (const falha of FALHAS_QUE_PAUSAM_A_CAMPANHA) {
      const frase = TEXTO_DA_FALHA_DA_CAMPANHA[falha];
      expect(DICIONARIO[frase]?.es, frase).toBeTruthy();
      expect(ehFalhaQuePausaACampanha(falha)).toBe(true);
    }
    expect(ehFalhaDeTemplateDaCampanha("falhas_seguidas")).toBe(false);
    expect(ehFalhaQuePausaACampanha("audiencia_vazia")).toBe(false);
    expect(ehFalhaDeTemplateDaCampanha(null)).toBe(false);
  });
});
