/**
 * A 9004 EM POSTGRES DE VERDADE — roda no `pnpm test:db` (banco efêmero com o
 * baseline aplicado). Neste Mac não há Docker: NÃO MEDIDO aqui; medir no
 * Postgres descartável da VPS antes de aplicar a 9004 em produção.
 */
import { beforeAll, describe, expect, it } from "vitest";

import { GOV_ORG, columnExists, indexExists, lastLine, seedGov, sql } from "./gov-helpers";
import { motivoDoErro } from "./psql-transporte";

const CONEXAO = "cccccccc-9004-4000-8000-000000000001";
const VENDA = "cccccccc-9004-4000-8000-0000000000e1";

function erroDe(script: string): string | null {
  try {
    sql(script);
    return null;
  } catch (err) {
    return motivoDoErro(err);
  }
}

/** A mesma pega que `lib/vendas/banco.ts` (prender) faz pelo PostgREST. */
const PEGAR = `with pega as (
    update public.sales_events
       set status = 'recebido', tentativas = 1, proxima_tentativa_em = now() + interval '15 minutes'
     where id = '${VENDA}' and organization_id = '${GOV_ORG}'
       and status in ('falhou', 'recebido') and tentativas = 0
       and proxima_tentativa_em <= now() and payload is not null
    returning 1)
  select count(*) from pega;`;

beforeAll(() => {
  seedGov();
  sql(`
    insert into public.webhook_sources (id, organization_id, name, path_token, kind)
      values ('${CONEXAO}', '${GOV_ORG}', 'Hotmart 9004', 'tok-9004-hotmart-aaaaaaaaaa', 'hotmart')
      on conflict do nothing;
    insert into public.sales_events
        (id, organization_id, webhook_source_id, plataforma, chave_evento, status, payload, proxima_tentativa_em)
      values ('${VENDA}', '${GOV_ORG}', '${CONEXAO}', 'hotmart', 'evt-9004', 'falhou', '{"id":"evt-9004"}'::jsonb,
              now() - interval '1 minute')
      on conflict do nothing;
  `);
});

describe("sales_events na 9004", () => {
  it("as colunas e o índice da fila existem; tentativas nasce 0", () => {
    expect(columnExists("sales_events", "tentativas")).toBe(true);
    expect(columnExists("sales_events", "proxima_tentativa_em")).toBe(true);
    expect(indexExists("sales_events_fila_da_tentativa_idx")).toBe(true);
    expect(lastLine(sql(`select tentativas from public.sales_events where id = '${VENDA}';`))).toBe("0");
  });

  it("tentativas fora de 0..3 é recusado", () => {
    expect(erroDe(`update public.sales_events set tentativas = 4 where id = '${VENDA}';`)).toContain(
      "sales_events_tentativas_check",
    );
  });

  it("⭐ duas pegas da mesma venda: só a primeira muda a linha", () => {
    expect(lastLine(sql(PEGAR))).toBe("1");
    expect(lastLine(sql(PEGAR))).toBe("0");
    expect(lastLine(sql(`select status || '|' || tentativas from public.sales_events where id = '${VENDA}';`))).toBe(
      "recebido|1",
    );
  });
});
