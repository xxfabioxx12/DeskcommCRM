/**
 * A 9005 EM POSTGRES DE VERDADE — roda no `pnpm test:db` (banco efêmero com o
 * baseline aplicado). Neste Mac não há Docker: NÃO MEDIDO aqui; medir no
 * Postgres descartável da VPS antes de aplicar a 9005 em produção.
 */
import { beforeAll, describe, expect, it } from "vitest";

import { GOV_ORG, GOV_SESSION, columnExists, lastLine, seedGov, sql } from "./gov-helpers";
import { motivoDoErro } from "./psql-transporte";

function erroDe(script: string): string | null {
  try {
    sql(script);
    return null;
  } catch (err) {
    return motivoDoErro(err);
  }
}

const LER = `select coalesce(meta_messaging_account_id, 'nulo') || '|' || coalesce(responde_sozinho::text, 'nulo')
  from public.channel_sessions where id = '${GOV_SESSION}' and organization_id = '${GOV_ORG}';`;

beforeAll(() => {
  seedGov();
});

describe("channel_sessions na 9005", () => {
  it("as duas colunas existem e nascem nulas (sem backfill)", () => {
    expect(columnExists("channel_sessions", "meta_messaging_account_id")).toBe(true);
    expect(columnExists("channel_sessions", "responde_sozinho")).toBe(true);
    expect(lastLine(sql(LER))).toBe("nulo|nulo");
  });

  it("⭐ conta de mensagens com letra ou curta demais é recusada; só dígitos passa", () => {
    for (const ruim of ["12a45678", "1234", " 1288526903016074"]) {
      expect(
        erroDe(`update public.channel_sessions set meta_messaging_account_id = '${ruim}' where id = '${GOV_SESSION}';`),
        ruim,
      ).toContain("channel_sessions_meta_messaging_account_id_check");
    }
    sql(`update public.channel_sessions set meta_messaging_account_id = '1288526903016074' where id = '${GOV_SESSION}';`);
    expect(lastLine(sql(LER))).toBe("1288526903016074|nulo");
  });

  it("o interruptor grava false, true e volta a nulo", () => {
    sql(`update public.channel_sessions set responde_sozinho = false where id = '${GOV_SESSION}';`);
    expect(lastLine(sql(LER)).endsWith("|false")).toBe(true);
    sql(`update public.channel_sessions set responde_sozinho = null, meta_messaging_account_id = null where id = '${GOV_SESSION}';`);
    expect(lastLine(sql(LER))).toBe("nulo|nulo");
  });
});
