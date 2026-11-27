/**
 * A 9005 DO FORK — NÚMERO OFICIAL: CONTA DE MENSAGENS E RESPOSTA AUTOMÁTICA.
 *
 * Cerca estática (lê arquivo). O comportamento em Postgres de verdade é
 * `tests/invariants/fork-9005-numero-oficial.test.ts` (`pnpm test:db`).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const RAIZ = join(__dirname, "..", "..");
const MIGRATION = "supabase/migrations/20261022173418_9005_numero_oficial.sql";
const BLOCO = "supabase/fork/9005.sql";
const CABECALHO =
  "-- ---- número oficial: conta de mensagens e resposta automática (migration 9005, fork) ----";
const VARREDURA = "-- ---- VARREDURA anon:";

const ler = (caminho: string) => readFileSync(join(RAIZ, caminho), "utf8");

describe("migration 9005 — número oficial", () => {
  it("existe, com o manifest na linha 1, a linha 2 em branco e o bloco exato depois", () => {
    expect(existsSync(join(RAIZ, MIGRATION))).toBe(true);
    const sql = ler(MIGRATION);
    const [linha1, linha2] = sql.split("\n");
    expect(linha1).toMatch(/^-- manifest: \S/);
    expect(linha2).toBe("");
    expect(ler(BLOCO).startsWith(CABECALHO)).toBe(true);
    expect(sql.endsWith(ler(BLOCO))).toBe(true);
  });

  it("⭐ conta de mensagens: texto só de dígitos (5 a 30)", () => {
    const sql = ler(BLOCO);
    expect(sql).toContain(
      "alter table public.channel_sessions add column if not exists meta_messaging_account_id text;",
    );
    expect(sql).toContain(
      "alter table public.channel_sessions drop constraint if exists channel_sessions_meta_messaging_account_id_check;",
    );
    expect(sql).toContain(
      "alter table public.channel_sessions add constraint channel_sessions_meta_messaging_account_id_check check (meta_messaging_account_id ~ '^[0-9]{5,30}$');",
    );
  });

  it("⭐ resposta automática: boolean SEM padrão (nulo = padrão do provedor) e sem backfill", () => {
    const sql = ler(BLOCO);
    expect(sql).toContain("alter table public.channel_sessions add column if not exists responde_sozinho boolean;");
    expect(sql).not.toMatch(/responde_sozinho boolean\s+(not null|default)/i);
    expect(sql).not.toMatch(/^\s*update\s/im);
  });

  it("não cria função (entra no FIM do baseline) e o PostgREST recarrega", () => {
    const sql = ler(BLOCO);
    expect(sql).not.toMatch(/^[ \t]*create[ \t]+(or[ \t]+replace[ \t]+)?function/im);
    expect(sql.trimEnd().endsWith("notify pgrst, 'reload schema';")).toBe(true);
  });

  it("⭐ o bloco está no baseline UMA vez, depois da varredura anon e depois do 9004", () => {
    const baseline = ler("supabase/baseline.sql");
    const bloco = ler(BLOCO);
    expect(baseline.split(bloco)).toHaveLength(2);
    expect(baseline.indexOf(bloco)).toBeGreaterThan(baseline.indexOf(VARREDURA));
    expect(baseline.indexOf(bloco)).toBeGreaterThan(baseline.indexOf(ler("supabase/fork/9004.sql")));
  });
});
