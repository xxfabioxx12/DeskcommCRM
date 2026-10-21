/**
 * LGPD (fork 9003): o pedido de acesso entrega as vendas que a anonimização
 * redige — pelo contato, pelo e-mail ou pelo telefone dele, o mesmo alcance de
 * `fn_vendas_redigir_ao_anonimizar` — sem o payload cru e sem a venda de outra
 * pessoa ou de outra organização.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ admin: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mock.admin }));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn() } }));
import { collectExportData } from "@/lib/lgpd/export-collector";

type Row = Record<string, unknown>;
const ORG = "org-a";
const CONTATO = "contato-a";
let rows: Record<string, Row[]>;

/** Executa os filtros `eq`/`in` e a projeção do coletor sobre as linhas de teste. */
class Consulta {
  colunas = "";
  filtros: [string, unknown][] = [];
  emFiltros: [string, unknown[]][] = [];
  teto = 1000;
  constructor(readonly tabela: string) {}
  select(c: string) {
    this.colunas = c;
    return this;
  }
  eq(k: string, v: unknown) {
    this.filtros.push([k, v]);
    return this;
  }
  in(k: string, v: unknown[]) {
    this.emFiltros.push([k, v]);
    return this;
  }
  order() {
    return this;
  }
  or() {
    return this;
  }
  limit(n: number) {
    this.teto = n;
    return this;
  }
  range(de: number, ate: number) {
    this.teto = ate - de + 1;
    return this;
  }
  async maybeSingle() {
    const r = await this.executar();
    return { ...r, data: r.data[0] ?? null };
  }
  then(ok: (r: unknown) => unknown, erro?: (e: unknown) => unknown) {
    return this.executar().then(ok, erro);
  }
  async executar() {
    const data = (rows[this.tabela] ?? [])
      .filter((r) => this.filtros.every(([k, v]) => r[k] === v))
      .filter((r) => this.emFiltros.every(([k, v]) => v.includes(r[k])))
      .slice(0, this.teto)
      .map((r) => Object.fromEntries(this.colunas.split(",").map((c) => [c.trim(), r[c.trim()]])));
    return { data, error: null };
  }
}

function venda(id: string, extra: Row): Row {
  return {
    id,
    organization_id: ORG,
    contact_id: null,
    email: null,
    telefone: null,
    plataforma: "hotmart",
    evento: "compra.aprovada",
    produto: "Curso",
    pedido: `HP-${id}`,
    venda: { nome: "Titular" },
    payload: { cru: "NAO-SAI" },
    recebido_em: `2026-10-0${id.length % 9}T00:00:00Z`,
    ...extra,
  };
}

beforeEach(() => {
  rows = {
    organizations: [{ id: ORG, legal_name: "Empresa Teste", display_name: "Teste", dpo_email: null }],
    contacts: [
      {
        id: CONTATO,
        organization_id: ORG,
        name: "Titular",
        email: "Titular@Exemplo.test",
        phone_number: "+5511988880000",
        created_at: "2026-09-15T00:00:00Z",
      },
    ],
    sales_events: [
      venda("pelo-contato", { contact_id: CONTATO, email: "titular@exemplo.test" }),
      venda("pelo-email", { email: "titular@exemplo.test" }),
      venda("pelo-telefone", { telefone: "+5511988880000" }),
      venda("de-outro", { email: "outro@exemplo.test", telefone: "+5511977770000" }),
      venda("outra-org", { organization_id: "org-b", contact_id: CONTATO, email: "titular@exemplo.test" }),
    ],
  };
  mock.admin.mockReturnValue({ from: (t: string) => new Consulta(t) });
});

describe("LGPD: vendas no pedido de acesso", () => {
  it("entrega pelo contato, pelo e-mail (minúsculo) e pelo telefone, uma vez cada, sem payload", async () => {
    const p = await collectExportData({ organizationId: ORG, requestId: "r1", contactId: CONTATO, externalCustomerId: null });
    const ids = (p.sales_events ?? []).map((v) => v.id).sort();
    expect(ids).toEqual(["pelo-contato", "pelo-email", "pelo-telefone"]);
    expect(JSON.stringify(p.sales_events)).not.toContain("NAO-SAI");
    expect(Object.keys(p.sales_events?.[0] ?? {}).sort()).toEqual(
      ["email", "evento", "id", "pedido", "plataforma", "produto", "recebido_em", "telefone", "venda"].sort(),
    );
  });
});
