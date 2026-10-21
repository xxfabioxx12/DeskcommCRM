/**
 * A 9002 EM POSTGRES DE VERDADE — ordem, nulo no pedido, outra organização e
 * duas transações ao mesmo tempo. Roda no `pnpm test:db` (banco efêmero com o
 * baseline aplicado), mesmo harness de `add-tag-concorrente-nao-apaga.test.ts`.
 */
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";

const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${process.env.TEST_DB_PORT ?? 54329}/postgres`,
  max: 6,
});
afterAll(() => pool.end());

async function fixture(etiquetasDoContato: string[], etiquetasDoCard: string[] = [], campos: Record<string, string> = {}) {
  const org = randomUUID();
  const pipeline = randomUUID();
  const stage = randomUUID();
  const lead = randomUUID();
  const contato = randomUUID();
  await pool.query(
    "insert into organizations(id,slug,legal_name,display_name) values($1::uuid,$1::text,'F9002','F9002')",
    [org],
  );
  await pool.query("insert into crm_pipelines(id,organization_id,name,slug) values($1::uuid,$2,'Funil',$1::text)", [pipeline, org]);
  await pool.query(
    "insert into crm_stages(id,organization_id,pipeline_id,name,slug,position) values($1,$2,$3,'Entrada','entrada',1)",
    [stage, org, pipeline],
  );
  await pool.query(
    "insert into contacts(id,organization_id,display_name,tags,custom_fields) values($1,$2,'Contato',$3,$4::jsonb)",
    [contato, org, etiquetasDoContato, JSON.stringify(campos)],
  );
  await pool.query(
    "insert into crm_leads(id,organization_id,pipeline_id,stage_id,title,contact_id,tags) values($1,$2,$3,$4,'Negócio',$5,$6)",
    [lead, org, pipeline, stage, contato, etiquetasDoCard],
  );
  return { org, lead, contato };
}

const tirarDoContato = async (org: string, contato: string, tags: (string | null)[]) =>
  (await pool.query("select public.fn_contato_remover_etiquetas($1,$2,$3::text[]) as r", [org, contato, tags])).rows[0].r;

describe("fn_contato_remover_etiquetas / fn_lead_remover_etiquetas", () => {
  it("tira do contato preservando a ordem das que ficam", async () => {
    const f = await fixture(["a", "b", "c"]);
    expect(await tirarDoContato(f.org, f.contato, ["b"])).toEqual({ tags: ["a", "c"], removidas: ["b"] });
  });

  it("etiqueta nula no pedido não apaga as outras", async () => {
    const f = await fixture(["a", "b", "c"]);
    expect(await tirarDoContato(f.org, f.contato, ["b", null])).toEqual({ tags: ["a", "c"], removidas: ["b"] });
  });

  it("tirar o que não tem não toca a linha", async () => {
    const f = await fixture(["a"]);
    const antes = (await pool.query("select updated_at from contacts where id=$1", [f.contato])).rows[0].updated_at;
    expect(await tirarDoContato(f.org, f.contato, ["z"])).toEqual({ tags: ["a"], removidas: [] });
    const depois = (await pool.query("select updated_at from contacts where id=$1", [f.contato])).rows[0].updated_at;
    expect(depois).toEqual(antes);
  });

  it("linha de outra organização devolve nulo e não é tocada", async () => {
    const f = await fixture(["a"]);
    expect(await tirarDoContato(randomUUID(), f.contato, ["a"])).toBeNull();
    expect((await pool.query("select tags from contacts where id=$1", [f.contato])).rows[0].tags).toEqual(["a"]);
  });

  it("tira do card", async () => {
    const f = await fixture([], ["Quente", "frio"]);
    const r = (await pool.query("select public.fn_lead_remover_etiquetas($1,$2,$3::text[]) as r", [f.org, f.lead, ["Quente"]])).rows[0].r;
    expect(r).toEqual({ tags: ["frio"], removidas: ["Quente"] });
  });

  it("duas remoções ao mesmo tempo somam (uma não devolve a etiqueta da outra)", async () => {
    const f = await fixture(["a", "b", "c"]);
    const a = await pool.connect();
    const b = await pool.connect();
    try {
      await a.query("begin");
      await b.query("begin");
      await a.query("select public.fn_contato_remover_etiquetas($1,$2,$3::text[])", [f.org, f.contato, ["a"]]);
      const pendente = b.query("select public.fn_contato_remover_etiquetas($1,$2,$3::text[])", [f.org, f.contato, ["c"]]);
      await a.query("commit");
      await pendente;
      await b.query("commit");
    } finally {
      a.release();
      b.release();
    }
    expect((await pool.query("select tags from contacts where id=$1", [f.contato])).rows[0].tags).toEqual(["b"]);
  });
});

describe("fn_contato_anotar_campos", () => {
  it("mescla sem apagar as outras chaves", async () => {
    const f = await fixture([], [], { x: "1" });
    const r = (await pool.query("select public.fn_contato_anotar_campos($1,$2,$3::jsonb) as r", [f.org, f.contato, JSON.stringify({ y: "2" })])).rows[0].r;
    expect(r).toEqual({ x: "1", y: "2" });
  });

  it("duas gravações ao mesmo tempo não se apagam", async () => {
    const f = await fixture([], [], {});
    const a = await pool.connect();
    const b = await pool.connect();
    try {
      await a.query("begin");
      await b.query("begin");
      await a.query("select public.fn_contato_anotar_campos($1,$2,$3::jsonb)", [f.org, f.contato, JSON.stringify({ x: "1" })]);
      const pendente = b.query("select public.fn_contato_anotar_campos($1,$2,$3::jsonb)", [f.org, f.contato, JSON.stringify({ y: "2" })]);
      await a.query("commit");
      await pendente;
      await b.query("commit");
    } finally {
      a.release();
      b.release();
    }
    expect((await pool.query("select custom_fields from contacts where id=$1", [f.contato])).rows[0].custom_fields).toEqual({ x: "1", y: "2" });
  });

  it("contato anonimizado não é tocado", async () => {
    const f = await fixture([], [], {});
    await pool.query("update contacts set is_anonymized = true, anonymized_at = now() where id=$1", [f.contato]);
    const r = (await pool.query("select public.fn_contato_anotar_campos($1,$2,$3::jsonb) as r", [f.org, f.contato, JSON.stringify({ y: "2" })])).rows[0].r;
    expect(r).toBeNull();
  });

  it("p_campos que não é objeto é recusado (22023)", async () => {
    const f = await fixture([]);
    await expect(
      pool.query("select public.fn_contato_anotar_campos($1,$2,$3::jsonb)", [f.org, f.contato, JSON.stringify(["x"])]),
    ).rejects.toMatchObject({ code: "22023" });
  });
});
