/**
 * OS BLOCOS DO FORK (faixa 9000) NO BASELINE — vários, cada um no seu lugar.
 *
 * O kit self-host aplica SÓ o `supabase/baseline.sql`. O fork guarda cada bloco
 * seu em `supabase/fork/9NNN.sql` e, a cada versão nova do oficial, fica com o
 * baseline DELES e reaplica os blocos pelo script. Esta cerca prova três coisas:
 *
 *   1. o código de cada bloco é o código da migration 9NNN (sem uma diferença);
 *   2. cada bloco está no baseline UMA vez, no lugar certo — bloco que cria
 *      função ANTES da varredura anon (função depois dela nasce exposta à anon
 *      key em quem atualiza), bloco sem função no fim;
 *   3. o script, rodado sobre o baseline do oficial (o de hoje sem os blocos),
 *      devolve o baseline de hoje byte a byte — e rodar de novo não muda nada.
 *
 * Estático + um `bash` numa cópia temporária: o banco de verdade é o `test:db`.
 */
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

const RAIZ = join(__dirname, "..", "..");
const VARREDURA = "-- ---- VARREDURA anon:";
const CRIA_FUNCAO = /^[ \t]*create[ \t]+(?:or[ \t]+replace[ \t]+)?function/im;

const ler = (caminho: string) => readFileSync(join(RAIZ, caminho), "utf8");
const BLOCOS = readdirSync(join(RAIZ, "supabase", "fork"))
  .filter((f) => /^9\d{3}\.sql$/.test(f))
  .sort();

/** As linhas de CÓDIGO (sem comentário nem linha em branco) — o que o Postgres executa. */
function codigo(sql: string): string[] {
  return sql
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l.trim() !== "" && !l.trim().startsWith("--"));
}

function migrationDo(numero: string): string {
  const achadas = readdirSync(join(RAIZ, "supabase", "migrations")).filter(
    (f) => f.endsWith(".sql") && f.includes(`_${numero}_`),
  );
  expect(achadas, `migration ${numero}`).toHaveLength(1);
  return ler(join("supabase", "migrations", achadas[0]!));
}

/** O baseline sem os blocos do fork — o que o oficial entrega. */
function semOsBlocos(baseline: string): string {
  let saida = baseline;
  for (const arquivo of BLOCOS) {
    const bloco = ler(join("supabase", "fork", arquivo));
    saida = CRIA_FUNCAO.test(bloco) ? saida.replace(`${bloco}\n`, "") : saida.replace(`\n${bloco}`, "");
  }
  return saida;
}

const temporarios: string[] = [];
afterAll(() => {
  for (const pasta of temporarios) rmSync(pasta, { recursive: true, force: true });
});

function arvoreTemporaria(baseline: string): string {
  const raiz = mkdtempSync(join(tmpdir(), "blocos-do-fork-"));
  temporarios.push(raiz);
  mkdirSync(join(raiz, "supabase"), { recursive: true });
  cpSync(join(RAIZ, "supabase", "fork"), join(raiz, "supabase", "fork"), { recursive: true });
  writeFileSync(join(raiz, "supabase", "baseline.sql"), baseline);
  return raiz;
}

function reaplicar(raiz: string): string {
  return execFileSync("bash", [join(RAIZ, "scripts", "fork", "reaplicar-bloco-do-fork.sh"), raiz], {
    encoding: "utf8",
  });
}

describe("blocos do fork no baseline", () => {
  it("controle: há blocos, e o 9001 é um deles", () => {
    expect(BLOCOS.length).toBeGreaterThan(0);
    expect(BLOCOS).toContain("9001.sql");
  });

  it.each(BLOCOS)("%s: a primeira linha é a marca `-- ---- … (migration 9NNN …) ----`", (arquivo) => {
    const marca = ler(join("supabase", "fork", arquivo)).split("\n")[0]!;
    expect(marca).toMatch(new RegExp(`^-- ---- .* \\(migration ${arquivo.slice(0, 4)}\\b.*\\) ----$`));
  });

  it.each(BLOCOS)("%s: o código do bloco é o código da migration, sem uma diferença", (arquivo) => {
    const bloco = ler(join("supabase", "fork", arquivo));
    expect(codigo(bloco).length).toBeGreaterThan(3);
    expect(codigo(bloco)).toEqual(codigo(migrationDo(arquivo.slice(0, 4))));
  });

  it.each(BLOCOS)("%s: aparece UMA vez no baseline, no lugar certo", (arquivo) => {
    const bloco = ler(join("supabase", "fork", arquivo));
    const baseline = ler("supabase/baseline.sql");
    expect(baseline.split(bloco)).toHaveLength(2);
    const onde = baseline.indexOf(bloco);
    const varredura = baseline.indexOf(VARREDURA);
    expect(varredura).toBeGreaterThan(-1);
    if (CRIA_FUNCAO.test(bloco)) expect(onde).toBeLessThan(varredura);
    else expect(onde).toBeGreaterThan(varredura);
  });

  it("⭐ o script reaplica os blocos no baseline do oficial e devolve o de hoje, byte a byte", () => {
    const hoje = ler("supabase/baseline.sql");
    const doOficial = semOsBlocos(hoje);
    expect(doOficial.length).toBeLessThan(hoje.length);
    const raiz = arvoreTemporaria(doOficial);
    reaplicar(raiz);
    expect(readFileSync(join(raiz, "supabase", "baseline.sql"), "utf8")).toBe(hoje);
  });

  it("rodar de novo não muda nada (idempotente)", () => {
    const hoje = ler("supabase/baseline.sql");
    const raiz = arvoreTemporaria(hoje);
    expect(reaplicar(raiz)).toMatch(/já está no baseline/);
    expect(readFileSync(join(raiz, "supabase", "baseline.sql"), "utf8")).toBe(hoje);
  });
});
