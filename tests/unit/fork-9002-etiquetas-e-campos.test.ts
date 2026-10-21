/**
 * A 9002 DO FORK — TIRAR ETIQUETA E GRAVAR CAMPO, ATÔMICOS COMO A 0682 E A 0502.
 *
 * Cerca estática (lê arquivo). O comportamento em Postgres de verdade (ordem,
 * nulo no pedido, concorrência) é `tests/invariants/fork-9002-etiquetas-e-campos.test.ts`,
 * que roda no `pnpm test:db` (Docker).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const RAIZ = join(__dirname, "..", "..");
const MIGRATION = "supabase/migrations/20261021150000_9002_etiquetas_e_campos_do_fluxo.sql";
const BLOCO = "supabase/fork/9002.sql";
const CABECALHO = "-- ---- etiquetas e campos do motor de fluxo (migration 9002, fork) ----";
const VARREDURA = "-- ---- VARREDURA anon: função nova nasce exposta em quem ATUALIZA (migration 0116) ----";

const ler = (caminho: string) => readFileSync(join(RAIZ, caminho), "utf8");

describe("migration 9002 — etiquetas e campos do motor de fluxo", () => {
  it("controle: existe, linha 1 é o manifest e o resto é o bloco do fork", () => {
    expect(existsSync(join(RAIZ, MIGRATION))).toBe(true);
    const sql = ler(MIGRATION);
    expect(sql.split("\n")[0]).toMatch(/^-- manifest: \S/);
    expect(ler(BLOCO).startsWith(CABECALHO)).toBe(true);
    expect(sql.endsWith(ler(BLOCO))).toBe(true);
  });

  it("⭐ as três funções com a assinatura combinada", () => {
    const sql = ler(MIGRATION);
    for (const assinatura of [
      "create or replace function public.fn_contato_remover_etiquetas(\n  p_org uuid,\n  p_contato uuid,\n  p_tags text[]\n)",
      "create or replace function public.fn_lead_remover_etiquetas(\n  p_org uuid,\n  p_lead uuid,\n  p_tags text[]\n)",
      "create or replace function public.fn_contato_anotar_campos(\n  p_org uuid,\n  p_contato uuid,\n  p_campos jsonb\n)",
    ]) {
      expect(sql).toContain(assinatura);
    }
  });

  it("⭐ tirar é DENTRO do UPDATE, preservando a ordem das que ficam", () => {
    const sql = ler(MIGRATION);
    expect(sql.match(/with ordinality as t\(etiqueta, ordem\)/g)).toHaveLength(2);
    expect(sql.match(/returning tags into v_depois;/g)).toHaveLength(2);
    expect(sql.match(/ for update;/g)).toHaveLength(2);
  });

  it("⭐ etiqueta nula no pedido é descartada antes de comparar (senão `<> all` apagaria tudo)", () => {
    expect(ler(MIGRATION).match(/where x is not null/g)).toHaveLength(2);
  });

  it("⭐ campos: merge raso `||` numa instrução só, e contato anonimizado não é tocado", () => {
    const sql = ler(MIGRATION);
    expect(sql).toContain("set custom_fields = coalesce(custom_fields, '{}'::jsonb) || p_campos,");
    expect(sql).toContain("and is_anonymized is not true");
  });

  it("⭐ EXECUTE só para service_role, revogado de public/anon/authenticated", () => {
    const sql = ler(MIGRATION);
    expect(sql.match(/^security definer$/gm)).toHaveLength(3);
    for (const assinatura of [
      "fn_contato_remover_etiquetas(uuid, uuid, text[])",
      "fn_lead_remover_etiquetas(uuid, uuid, text[])",
      "fn_contato_anotar_campos(uuid, uuid, jsonb)",
    ]) {
      expect(sql).toContain(`revoke all on function public.${assinatura} from public, anon, authenticated;`);
      expect(sql).toContain(`grant execute on function public.${assinatura} to service_role;`);
    }
  });

  it("⭐ o bloco está no baseline UMA vez, ANTES da varredura anon", () => {
    const baseline = ler("supabase/baseline.sql");
    const bloco = ler(BLOCO);
    expect(baseline.split(bloco)).toHaveLength(2);
    expect(baseline.indexOf(bloco)).toBeLessThan(baseline.indexOf(VARREDURA));
  });
});
