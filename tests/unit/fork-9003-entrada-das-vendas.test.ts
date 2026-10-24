/**
 * A 9003 DO FORK — ENTRADA DAS VENDAS (Parte 2 da migração do ManyChat).
 *
 * Cerca estática (lê arquivo). O comportamento em Postgres de verdade é
 * `tests/invariants/fork-9003-entrada-das-vendas.test.ts` (`pnpm test:db`).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const RAIZ = join(__dirname, "..", "..");
const MIGRATION = "supabase/migrations/20261021180903_9003_entrada_das_vendas.sql";
const BLOCO = "supabase/fork/9003.sql";
const DA_0670 = "20261017060002_0670_o_telefone_ganho_alcanca_a_origem.sql";
const CABECALHO = "-- ---- entrada das vendas (migration 9003, fork) ----";
const VARREDURA = "-- ---- VARREDURA anon: função nova nasce exposta em quem ATUALIZA (migration 0116) ----";

const ler = (caminho: string) => readFileSync(join(RAIZ, caminho), "utf8");

/** As duas funções da 0670 com `sale.received` acrescentado — e nada mais. */
function esperadoDa0670(): string {
  const sql = ler(join("supabase", "migrations", DA_0670));
  return sql
    .slice(sql.indexOf("create or replace function public.fn_service_event_contact("))
    .replace(
      "('contact.tag_added','contact.birthday','contact.phone_added')",
      "('contact.tag_added','contact.birthday','contact.phone_added','sale.received')",
    )
    .replace(
      "    'conversation.autonomous_turn_revoked'\n  ) then",
      "    'conversation.autonomous_turn_revoked','sale.received'\n  ) then",
    )
    .trimEnd();
}

describe("migration 9003 — entrada das vendas", () => {
  it("controle: existe, linha 1 é o manifest, linha 2 em branco e o resto é o bloco do fork", () => {
    expect(existsSync(join(RAIZ, MIGRATION))).toBe(true);
    const sql = ler(MIGRATION);
    const [linha1, linha2] = sql.split("\n");
    expect(linha1).toMatch(/^-- manifest: \S/);
    expect(linha2).toBe("");
    expect(ler(BLOCO).startsWith(CABECALHO)).toBe(true);
    expect(sql.endsWith(ler(BLOCO))).toBe(true);
  });

  it("⭐ webhook_sources: tipos de venda, funil só na captação, config", () => {
    const sql = ler(BLOCO);
    expect(sql).toContain("check (kind in ('lead_capture', 'hotmart', 'kiwify', 'kookie', 'personalizada'));");
    expect(sql).toContain("alter table public.webhook_sources alter column default_pipeline_id drop not null;");
    expect(sql).toContain("alter table public.webhook_sources alter column default_stage_id drop not null;");
    expect(sql).toContain(
      "check (kind <> 'lead_capture' or (default_pipeline_id is not null and default_stage_id is not null));",
    );
    expect(sql).toContain("alter table public.webhook_sources add column if not exists config jsonb not null default '{}'::jsonb;");
  });

  it("⭐ sales_events: repetido morre no índice; manager lê; só o servidor escreve", () => {
    const sql = ler(BLOCO);
    expect(sql).toContain(
      "create unique index if not exists sales_events_uma_entrega_idx\n  on public.sales_events (webhook_source_id, chave_evento) where chave_evento is not null;",
    );
    expect(sql).toContain("check (status in ('recebido', 'ignorado', 'sem_contato', 'processado', 'falhou', 'recusado'))");
    expect(sql).toContain("check (plataforma in ('hotmart', 'kiwify', 'kookie', 'personalizada'))");
    expect(sql).toContain("and public.fn_role_at_least(organization_id, 'manager'))");
    expect(sql).toContain("revoke all on public.sales_events from anon, authenticated;");
    expect(sql).toContain("grant select on public.sales_events to authenticated;");
    expect(sql).toContain("revoke all on public.sales_rule_runs from anon, authenticated;");
  });

  it("⭐ uma regra por (conexão, pedido, evento)", () => {
    expect(ler(BLOCO)).toContain("primary key (rule_id, webhook_source_id, entidade, evento)");
  });

  it("⭐ os dados da pessoa saem: na anonimização e em 30 dias", () => {
    const sql = ler(BLOCO);
    expect(sql).toContain("after update of is_anonymized on public.contacts");
    expect(sql.match(/set email = null, telefone = null, venda = '\{\}'::jsonb, payload = null/g)).toHaveLength(2);
    // A venda que não ganhou contato (só registrando, sem_contato) é da pessoa pelo e-mail ou telefone.
    expect(sql).toContain(
      "where organization_id = new.organization_id\n       and (contact_id = new.id\n" +
        "            or (old.email is not null and email = lower(trim(old.email)))\n" +
        "            or (old.phone_number is not null and telefone = old.phone_number));",
    );
  });

  it("⭐ índices para achar as vendas da pessoa (redação e export) e o PostgREST recarrega", () => {
    const sql = ler(BLOCO);
    expect(sql).toContain(
      "create index if not exists sales_events_contato_idx\n  on public.sales_events (organization_id, contact_id) where contact_id is not null;",
    );
    expect(sql).toContain(
      "create index if not exists sales_events_email_idx\n  on public.sales_events (organization_id, email) where email is not null;",
    );
    expect(sql).toContain(
      "create index if not exists sales_events_telefone_idx\n  on public.sales_events (organization_id, telefone) where telefone is not null;",
    );
    expect(sql.trimEnd().endsWith("notify pgrst, 'reload schema';")).toBe(true);
  });

  it("⭐ sale.received: as funções são as da 0670 com o tipo acrescentado, e mais nada", () => {
    const esperado = esperadoDa0670();
    expect(esperado.match(/'sale\.received'/g), "as duas trocas precisam acontecer").toHaveLength(2);
    expect(ler(BLOCO)).toContain(esperado);
  });

  it("⭐ a 0743 é a última do oficial que define emit_event e fn_service_event_contact, e a 9006 junta as duas", () => {
    // Se o oficial redefinir as duas depois, a 9003 (que entra depois dele no
    // baseline) desfaria a mudança deles. Vermelho aqui = refazer a 9003 a partir
    // da definição nova (docs/fork/ATUALIZAR-DO-OFICIAL.md).
    const pasta = join(RAIZ, "supabase", "migrations");
    const quemDefine = (re: RegExp) =>
      readdirSync(pasta)
        .filter((f) => f.endsWith(".sql") && !/_9\d{3}_/.test(f) && re.test(readFileSync(join(pasta, f), "utf8")))
        .sort();
    // Na 1.89 a 0743 redefiniu as duas; a 9006 (fork) vem depois e mantém o
    // tipo dela ('lead.date_field_due') e o nosso ('sale.received').
    const DA_0743 = "20261023150000_0743_gatilho_de_data_do_funil_alcanca_a_origem.sql";
    expect(quemDefine(/function public\.emit_event\(/i).at(-1)).toBe(DA_0743);
    expect(quemDefine(/function public\.fn_service_event_contact\(/i).at(-1)).toBe(DA_0743);
    const bloco9006 = ler(join("supabase", "fork", "9006.sql"));
    expect(bloco9006.match(/'sale\.received'/g)).toHaveLength(2);
    expect(bloco9006).toContain("'lead.date_field_due'");
  });

  it("⭐ as funções novas: security definer, search_path fixo, sem EXECUTE para anon/authenticated", () => {
    const sql = ler(BLOCO);
    for (const assinatura of ["fn_vendas_redigir_ao_anonimizar()", "fn_vendas_limpar_dados_vencidos(integer, integer)"]) {
      expect(sql).toContain(`revoke all on function public.${assinatura} from public, anon, authenticated;`);
    }
    expect(sql).toContain("grant execute on function public.fn_vendas_limpar_dados_vencidos(integer, integer) to service_role;");
    expect(sql.match(/^security definer\nset search_path = public, pg_temp$/gm)).toHaveLength(2);
  });

  it("⭐ o bloco está no baseline UMA vez, ANTES da varredura anon e depois do 9002", () => {
    const baseline = ler("supabase/baseline.sql");
    const bloco = ler(BLOCO);
    expect(baseline.split(bloco)).toHaveLength(2);
    expect(baseline.indexOf(bloco)).toBeLessThan(baseline.indexOf(VARREDURA));
    expect(baseline.indexOf(bloco)).toBeGreaterThan(baseline.indexOf(ler("supabase/fork/9002.sql")));
  });
});
