/**
 * A 9003 EM POSTGRES DE VERDADE — roda no `pnpm test:db` (banco efêmero com o
 * baseline aplicado). Neste Mac não há Docker: NÃO MEDIDO aqui; medir no
 * Postgres descartável da VPS antes de aplicar a 9003 em produção.
 */
import { beforeAll, describe, expect, it } from "vitest";

import { GOV_MANAGER, GOV_ORG, GOV_VIEWER, countAs, lastLine, seedGov, sql } from "./gov-helpers";
import { motivoDoErro } from "./psql-transporte";

const CONEXAO = "cccccccc-9003-4000-8000-000000000001";
const CONTATO = "cccccccc-9003-4000-8000-0000000000c1";
const ANONIMO = "cccccccc-9003-4000-8000-0000000000c2";
const REGRA = "cccccccc-9003-4000-8000-0000000000a1";
const EVENTO_DO_LOG = "cccccccc-9003-4000-8000-0000000000e1";

function erroDe(script: string): string | null {
  try {
    sql(script);
    return null;
  } catch (err) {
    return motivoDoErro(err);
  }
}

function venda(chave: string, extra = ""): string {
  return `insert into public.sales_events (organization_id, webhook_source_id, plataforma, chave_evento, status${extra ? ", " + extra.split("|")[0] : ""})
    values ('${GOV_ORG}', '${CONEXAO}', 'hotmart', ${chave === "" ? "null" : `'${chave}'`}, 'recebido'${extra ? ", " + extra.split("|")[1] : ""});`;
}

beforeAll(() => {
  seedGov();
  sql(`
    insert into public.webhook_sources (id, organization_id, name, path_token, kind)
      values ('${CONEXAO}', '${GOV_ORG}', 'Hotmart 9003', 'tok-9003-hotmart-aaaaaaaaaa', 'hotmart')
      on conflict do nothing;
    insert into public.contacts (id, organization_id, display_name, phone_number, email)
      values ('${CONTATO}', '${GOV_ORG}', 'Comprador 9003', '+5511999990903', 'comprador9003@example.com'),
             ('${ANONIMO}', '${GOV_ORG}', 'Vai anonimizar 9003', '+5511999990904', 'anonimo9003@example.com')
      on conflict do nothing;
    insert into public.automation_rules (id, organization_id, name, trigger_event, actions)
      values ('${REGRA}', '${GOV_ORG}', 'Venda 9003', 'sale.received', '[]'::jsonb)
      on conflict do nothing;
  `);
});

describe("webhook_sources na 9003", () => {
  it("a conexão de venda nasce sem funil", () => {
    expect(
      lastLine(sql(`select count(*) from public.webhook_sources where id = '${CONEXAO}' and default_pipeline_id is null;`)),
    ).toBe("1");
  });

  it("a captação sem funil continua recusada", () => {
    expect(
      erroDe(`insert into public.webhook_sources (organization_id, name, path_token, kind)
        values ('${GOV_ORG}', 'x', 'tok-9003-captacao-sem-funil', 'lead_capture');`),
    ).toContain("webhook_sources_captacao_tem_funil");
  });

  it("tipo fora da lista é recusado", () => {
    expect(
      erroDe(`insert into public.webhook_sources (organization_id, name, path_token, kind)
        values ('${GOV_ORG}', 'x', 'tok-9003-eduzz', 'eduzz');`),
    ).toContain("webhook_sources_kind_check");
  });
});

describe("sales_events", () => {
  it("a mesma entrega duas vezes: a segunda morre no índice único", () => {
    sql(venda("hm-9003-1"));
    expect(erroDe(venda("hm-9003-1"))).toContain("sales_events_uma_entrega_idx");
  });

  it("sem chave (recusa) entra quantas vezes vier", () => {
    expect(erroDe(venda(""))).toBeNull();
    expect(erroDe(venda(""))).toBeNull();
  });

  it("manager da organização lê; viewer não lê", () => {
    const q = `select count(*) from public.sales_events where webhook_source_id = '${CONEXAO}';`;
    expect(countAs(GOV_MANAGER, q)).toBeGreaterThan(0);
    expect(countAs(GOV_VIEWER, q)).toBe(0);
  });

  it("anonimizar o contato apaga os dados da pessoa nas vendas dele", () => {
    sql(venda("hm-9003-anon", `contact_id, email, telefone, venda, payload|'${ANONIMO}', 'anonimo9003@example.com', '+5511999990904', '{"nome":"Ana"}', '{"x":1}'`));
    // Sem contact_id (só registrando / sem_contato): a pessoa pelo e-mail ou pelo telefone.
    sql(venda("hm-9003-anon-email", `email, venda, payload|'anonimo9003@example.com', '{"nome":"Ana"}', '{"x":1}'`));
    sql(venda("hm-9003-anon-tel", `telefone, venda, payload|'+5511999990904', '{"nome":"Ana"}', '{"x":1}'`));
    sql(venda("hm-9003-outra", `email, telefone, venda, payload|'outra9003@example.com', '+5511999990999', '{"nome":"Bia"}', '{"x":1}'`));
    sql(`update public.contacts set is_anonymized = true, anonymized_at = now() where id = '${ANONIMO}';`);
    const linha = (chave: string) =>
      lastLine(
        sql(`select concat_ws('|', coalesce(email, '-'), coalesce(telefone, '-'), venda::text, coalesce(payload::text, '-'))
               from public.sales_events where chave_evento = '${chave}';`),
      );
    expect(linha("hm-9003-anon")).toBe("-|-|{}|-");
    expect(linha("hm-9003-anon-email")).toBe("-|-|{}|-");
    expect(linha("hm-9003-anon-tel")).toBe("-|-|{}|-");
    expect(linha("hm-9003-outra")).not.toBe("-|-|{}|-");
  });

  it("os dados da pessoa saem em 30 dias; o resto da linha fica", () => {
    sql(venda("hm-9003-velho", `evento, email, venda, payload, recebido_em|'compra.aprovada', 'velho@example.com', '{"nome":"V"}', '{"x":1}', now() - interval '31 days'`));
    sql(venda("hm-9003-novo", `evento, email, venda, payload, recebido_em|'compra.aprovada', 'novo@example.com', '{"nome":"N"}', '{"x":1}', now() - interval '29 days'`));
    sql(`select public.fn_vendas_limpar_dados_vencidos(30, 1000);`);
    expect(
      lastLine(sql(`select count(*) from public.sales_events where chave_evento = 'hm-9003-velho'
        and payload is null and email is null and venda = '{}'::jsonb and evento = 'compra.aprovada';`)),
    ).toBe("1");
    expect(
      lastLine(sql(`select count(*) from public.sales_events where chave_evento = 'hm-9003-novo'
        and payload is not null and email is not null;`)),
    ).toBe("1");
  });
});

describe("sales_rule_runs", () => {
  it("a mesma regra no mesmo pedido e evento: a segunda reserva é recusada", () => {
    const reserva = `insert into public.sales_rule_runs (organization_id, rule_id, webhook_source_id, entidade, evento, event_id)
      values ('${GOV_ORG}', '${REGRA}', '${CONEXAO}', 'hotmart:HP9003', 'compra.aprovada', '${EVENTO_DO_LOG}');`;
    sql(reserva);
    expect(erroDe(reserva)).toContain("sales_rule_runs_pkey");
  });
});

describe("sale.received no emit_event", () => {
  it("emitido pelo servidor, carimba a origem (o contato existe)", () => {
    const id = lastLine(
      sql(`select public.emit_event('sale.received', 'contact', '${CONTATO}'::uuid,
        '{"evento":"compra.aprovada"}'::jsonb, '{}'::jsonb, '${GOV_ORG}'::uuid);`),
    );
    expect(lastLine(sql(`select (payload ? 'service_origin')::text from public.event_log where id = '${id}';`))).toBe("true");
  });

  it("um viewer NÃO emite sale.received — 42501", () => {
    const erro = erroDe(`
      begin;
      set local role authenticated;
      select set_config('request.jwt.claims', '{"sub":"${GOV_VIEWER}"}', true) is not null;
      select public.emit_event('sale.received', 'contact', '${CONTATO}'::uuid, '{}'::jsonb, '{}'::jsonb, '${GOV_ORG}'::uuid);
      rollback;`);
    expect(erro, "um viewer emitiu sale.received SEM erro").not.toBeNull();
    expect(erro).toContain("reserved_message_received");
  });

  it("CONTROLE: o mesmo viewer emite um tipo não reservado", () => {
    const saida = sql(`
      begin;
      set local role authenticated;
      select set_config('request.jwt.claims', '{"sub":"${GOV_VIEWER}"}', true) is not null;
      select 'EMITIU:' || public.emit_event('contact.tag_added', 'contact', '${CONTATO}'::uuid, '{}'::jsonb, '{}'::jsonb, '${GOV_ORG}'::uuid);
      rollback;`);
    expect(saida).toContain("EMITIU:");
  });
});
