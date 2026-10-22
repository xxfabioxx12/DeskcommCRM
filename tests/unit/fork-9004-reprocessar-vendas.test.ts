/**
 * A 9004 DO FORK — REPROCESSAR AS VENDAS QUE FALHARAM (Parte 2b).
 *
 * Cerca estática (lê arquivo). O comportamento em Postgres de verdade é
 * `tests/invariants/fork-9004-reprocessar-vendas.test.ts` (`pnpm test:db`).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const RAIZ = join(__dirname, "..", "..");
const MIGRATION = "supabase/migrations/20261022141357_9004_reprocessar_vendas.sql";
const BLOCO = "supabase/fork/9004.sql";
const CABECALHO = "-- ---- reprocessar as vendas que falharam (migration 9004, fork) ----";
const VARREDURA = "-- ---- VARREDURA anon:";

const ler = (caminho: string) => readFileSync(join(RAIZ, caminho), "utf8");

describe("migration 9004 — reprocessar as vendas", () => {
  it("existe, com o manifest na linha 1, a linha 2 em branco e o bloco exato depois", () => {
    expect(existsSync(join(RAIZ, MIGRATION))).toBe(true);
    const sql = ler(MIGRATION);
    const [linha1, linha2] = sql.split("\n");
    expect(linha1).toMatch(/^-- manifest: \S/);
    expect(linha2).toBe("");
    expect(ler(BLOCO).startsWith(CABECALHO)).toBe(true);
    expect(sql.endsWith(ler(BLOCO))).toBe(true);
  });

  it("⭐ colunas: tentativas de 0 a 3 (padrão 0) e a próxima tentativa", () => {
    const sql = ler(BLOCO);
    expect(sql).toContain("alter table public.sales_events add column if not exists tentativas integer not null default 0;");
    expect(sql).toContain("alter table public.sales_events add column if not exists proxima_tentativa_em timestamptz;");
    expect(sql).toContain("alter table public.sales_events drop constraint if exists sales_events_tentativas_check;");
    expect(sql).toContain(
      "alter table public.sales_events add constraint sales_events_tentativas_check check (tentativas between 0 and 3);",
    );
  });

  it("⭐ índice parcial da fila: falhou com próxima tentativa e recebido com prazo (Divergência D1)", () => {
    expect(ler(BLOCO)).toContain(
      "create index if not exists sales_events_fila_da_tentativa_idx\n" +
        "  on public.sales_events (proxima_tentativa_em)\n" +
        "  where proxima_tentativa_em is not null and status in ('falhou', 'recebido');",
    );
  });

  it("não cria função (entra no FIM do baseline) e o PostgREST recarrega", () => {
    const sql = ler(BLOCO);
    expect(sql).not.toMatch(/^[ \t]*create[ \t]+(or[ \t]+replace[ \t]+)?function/im);
    expect(sql.trimEnd().endsWith("notify pgrst, 'reload schema';")).toBe(true);
  });

  it("⭐ o bloco está no baseline UMA vez, depois da varredura anon e depois do 9001", () => {
    const baseline = ler("supabase/baseline.sql");
    const bloco = ler(BLOCO);
    expect(baseline.split(bloco)).toHaveLength(2);
    expect(baseline.indexOf(bloco)).toBeGreaterThan(baseline.indexOf(VARREDURA));
    expect(baseline.indexOf(bloco)).toBeGreaterThan(baseline.indexOf(ler("supabase/fork/9001.sql")));
  });
});
