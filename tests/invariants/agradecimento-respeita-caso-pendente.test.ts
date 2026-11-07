import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { buscarCandidatas } from "@/lib/inbox/concluir-agradecimento";

// Postgres real, tabelas temporárias por conexão: não altera dados do baseline.
// O mesmo SELECT usado pelo cron deve distinguir resolução de promessa de retorno.
if (!process.env.TEST_DB_CONTAINER) throw new Error("Rode via pnpm test:db");
const client = new pg.Client({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${process.env.TEST_DB_PORT ?? 54329}/postgres`,
});
const ORG = "10000000-0000-4000-8000-000000000001";
const OUTRA = "10000000-0000-4000-8000-000000000002";
const CONV = "20000000-0000-4000-8000-000000000001";
const AGORA = new Date("2026-11-07T21:00:00Z");

beforeAll(async () => {
  await client.connect();
  await client.query(`
    create temp table conversations (id uuid, organization_id uuid, service_revision int,
      status text, is_group boolean, metadata jsonb);
    create temp table messages (organization_id uuid, conversation_id uuid, direction text,
      body text, created_at timestamptz, revoked_at timestamptz);
    create temp table agent_cases (organization_id uuid, conversation_id uuid, status text);
  `);
});
afterAll(() => client.end());
beforeEach(async () => {
  await client.query("truncate pg_temp.conversations, pg_temp.messages, pg_temp.agent_cases");
  await client.query("insert into conversations values ($1,$2,1,'claimed',false,'{}')", [CONV, ORG]);
  await client.query(`insert into messages values
    ($1,$2,'outbound','Vou passar para o especialista e te retorno.','2026-11-07T18:00:00Z',null),
    ($1,$2,'inbound','Ok, obrigado','2026-11-07T18:01:00Z',null)`, [ORG, CONV]);
});

async function caso(status: string, org = ORG) {
  await client.query("insert into agent_cases values ($1,$2,$3)", [org, CONV, status]);
}

describe("agradecimento não encerra uma pendência humana", () => {
  it.each(["awaiting_human", "awaiting_lead"])("mantém atendimento com caso %s", async (status) => {
    await caso(status);
    expect(await buscarCandidatas(client, AGORA)).toEqual([]);
  });
  it.each(["resolved", "cancelled"])("preserva encerramento com caso %s", async (status) => {
    await caso(status);
    expect((await buscarCandidatas(client, AGORA)).map((c) => c.id)).toEqual([CONV]);
  });
  it("preserva seleção sem caso e não cruza organizações", async () => {
    expect((await buscarCandidatas(client, AGORA)).map((c) => c.id)).toEqual([CONV]);
    await caso("awaiting_human", OUTRA);
    expect((await buscarCandidatas(client, AGORA)).map((c) => c.id)).toEqual([CONV]);
  });
  it("um caso resolvido antigo não esconde outro pendente", async () => {
    await caso("resolved");
    await caso("awaiting_human");
    expect(await buscarCandidatas(client, AGORA)).toEqual([]);
  });
});
