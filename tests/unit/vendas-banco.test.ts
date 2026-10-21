import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ porTelefone: vi.fn() }));
vi.mock("@/lib/channels/contato-por-telefone", () => ({ encontrarContatoPorTelefoneComNome: h.porTelefone }));

import { bancoDaVenda } from "@/lib/vendas/banco";
import type { ConexaoDeVenda, LinhaNovaDaVenda } from "@/lib/vendas/receber";

import { supabaseGravador, usou } from "./helpers/supabase-gravador";

const LINHA: LinhaNovaDaVenda = {
  organization_id: "org-1",
  webhook_source_id: "conexao-1",
  plataforma: "hotmart",
  evento_original: "PURCHASE_APPROVED",
  evento: "compra.aprovada",
  chave_evento: "hm-evt-0001",
  entidade: "hotmart:HP0001",
  pedido: "HP0001",
  produto_id: "4455",
  produto: "Curso Hotmart",
  email: "joao@email.com",
  telefone: "+5531999998888",
  order_bump: false,
  teste: false,
  venda: {},
  payload: { id: "hm-evt-0001" },
};
const CONEXAO: ConexaoDeVenda = { id: "conexao-1", organizationId: "org-1", plataforma: "hotmart", config: {} };

beforeEach(() => {
  h.porTelefone.mockReset().mockResolvedValue(null);
});

describe("registrar", () => {
  it("repetido (23505) volta 'repetido'; outro erro sobe; certo devolve o id", async () => {
    expect(await bancoDaVenda(supabaseGravador(() => ({ error: { code: "23505", message: "dup" } })).admin).registrar(LINHA)).toBe("repetido");
    await expect(
      bancoDaVenda(supabaseGravador(() => ({ error: { code: "57014", message: "timeout" } })).admin).registrar(LINHA),
    ).rejects.toThrow("sales_events: timeout");
    expect(await bancoDaVenda(supabaseGravador(() => ({ data: { id: "ev-1" } })).admin).registrar(LINHA)).toEqual({ id: "ev-1" });
  });
});

describe("acharContato", () => {
  it("acharContato procura pelas grafias do número (nono dígito), não por igualdade", async () => {
    h.porTelefone.mockResolvedValue({ id: "c1", phone_number: "+5531999998888", name: null });
    const g = supabaseGravador((tabela) =>
      tabela === "contacts" ? { data: { id: "c1", name: null, email: null, phone_number: "+5531999998888" } } : {},
    );
    const achado = await bancoDaVenda(g.admin).acharContato("org-1", { telefone: "+5531999998888", email: "joao@email.com" });
    expect(h.porTelefone).toHaveBeenCalledWith(g.admin, "org-1", "+5531999998888");
    expect(achado?.id).toBe("c1");
    expect(g.log.some((c) => c.metodo === "eq" && c.args[0] === "phone_number")).toBe(false);
    expect(usou(g.log, "contacts", "eq", "organization_id", "org-1")).toBe(true);
  });

  it("sem telefone achado, procura pelo e-mail normalizado de contato não fundido", async () => {
    const g = supabaseGravador(() => ({ data: { id: "c2", name: "Ana", email: "joao@email.com", phone_number: null } }));
    const achado = await bancoDaVenda(g.admin).acharContato("org-1", { telefone: "+5531999998888", email: "joao@email.com" });
    expect(achado?.id).toBe("c2");
    expect(usou(g.log, "contacts", "eq", "email_normalized", "joao@email.com")).toBe(true);
    expect(usou(g.log, "contacts", "is", "is_merged_into", null)).toBe(true);
  });
});

describe("releitura por telefone", () => {
  it("erro na releitura sobe, em vez de cair para criar contato", async () => {
    h.porTelefone.mockResolvedValue({ id: "c1", phone_number: "+5531999998888", name: null });
    const g = supabaseGravador(() => ({ error: { message: "timeout" } }));
    await expect(bancoDaVenda(g.admin).acharContato("org-1", { telefone: "+5531999998888", email: null })).rejects.toThrow("contacts: timeout");
  });
});

describe("criar e completar o contato", () => {
  it("cria com origem anotada; corrida (23505) devolve quem ganhou", async () => {
    const g = supabaseGravador((_t, chamadas) =>
      chamadas.some((c) => c.metodo === "insert") ? { error: { code: "23505", message: "uniq_contacts_org_phone" } } : { data: null },
    );
    h.porTelefone.mockResolvedValue({ id: "vencedor", phone_number: "+5531999998888", name: null });
    const g2 = supabaseGravador((_t, chamadas) =>
      chamadas.some((c) => c.metodo === "insert")
        ? { error: { code: "23505", message: "uniq_contacts_org_phone" } }
        : { data: { id: "vencedor", name: null, email: null, phone_number: "+5531999998888" } },
    );
    const novo = { name: "João", email: null, phone_number: "+5531999998888", source_metadata: { origem: "x" } };
    expect(await bancoDaVenda(g2.admin).criarContato("org-1", novo)).toBe("vencedor");
    expect(g2.log.find((c) => c.metodo === "insert")?.args[0]).toMatchObject({
      organization_id: "org-1",
      name: "João",
      phone_number: "+5531999998888",
      source: "webhook",
      source_metadata: { origem: "x" },
    });
    h.porTelefone.mockResolvedValue(null);
    expect(await bancoDaVenda(g.admin).criarContato("org-1", novo)).toBeNull();
  });

  it("e-mail de outro contato não derruba o completar: grava o nome e segue", async () => {
    const g = supabaseGravador((_t, chamadas) => {
      const patch = chamadas.find((c) => c.metodo === "update")?.args[0] as Record<string, unknown> | undefined;
      return patch && "email" in patch ? { error: { code: "23505", message: "uniq_contacts_org_email" } } : {};
    });
    await expect(bancoDaVenda(g.admin).completarContato("org-1", "c1", { name: "João", email: "b@x.com" })).resolves.toBeUndefined();
    const patches = g.log.filter((c) => c.metodo === "update").map((c) => c.args[0] as Record<string, unknown>);
    expect(patches.some((p) => p.name === "João" && !("email" in p))).toBe(true);
    expect(usou(g.log, "contacts", "eq", "organization_id", "org-1")).toBe(true);
  });
});

describe("jaComprou (Divergência D3)", () => {
  const busca = {
    organizationId: "org-1",
    conexaoId: "conexao-1",
    entidade: "hotmart:HP0001",
    email: "joao@email.com",
    telefone: "+5531999998888",
    produtoId: "4455",
    desde: new Date("2026-10-21T09:00:00Z"),
  };

  it("mesmo pedido aprovado na conexão: sim, sem olhar a pessoa", async () => {
    const g = supabaseGravador(() => ({ data: [{ id: "x" }] }));
    expect(await bancoDaVenda(g.admin).jaComprou(busca)).toBe(true);
    expect(usou(g.log, "sales_events", "eq", "entidade", "hotmart:HP0001")).toBe(true);
    expect(g.log.some((c) => c.args[0] === "email")).toBe(false);
  });

  it("mesma pessoa + mesmo produto nas últimas 6 h, sem compra de teste", async () => {
    const respostas: unknown[][] = [[], [{ id: "x" }]];
    const g = supabaseGravador(() => ({ data: respostas.shift() ?? [] }));
    expect(await bancoDaVenda(g.admin).jaComprou(busca)).toBe(true);
    expect(usou(g.log, "sales_events", "eq", "email", "joao@email.com")).toBe(true);
    expect(usou(g.log, "sales_events", "eq", "produto_id", "4455")).toBe(true);
    expect(usou(g.log, "sales_events", "eq", "teste", false)).toBe(true);
    expect(usou(g.log, "sales_events", "gte", "recebido_em", "2026-10-21T09:00:00.000Z")).toBe(true);
  });

  it("mesmo pedido e consulta por pessoa filtram a organização (telefone casa, e-mail nulo)", async () => {
    const respostas: unknown[][] = [[], [{ id: "x" }]];
    const g = supabaseGravador(() => ({ data: respostas.shift() ?? [] }));
    expect(await bancoDaVenda(g.admin).jaComprou({ ...busca, email: null })).toBe(true);
    const orgs = g.log.filter((c) => c.metodo === "eq" && c.args[0] === "organization_id");
    expect(orgs).toHaveLength(2);
    expect(usou(g.log, "sales_events", "eq", "telefone", "+5531999998888")).toBe(true);
    expect(g.log.some((c) => c.args[0] === "email")).toBe(false);
  });

  it("sem produto: qualquer produto; ninguém: não", async () => {
    const g = supabaseGravador(() => ({ data: [] }));
    expect(await bancoDaVenda(g.admin).jaComprou({ ...busca, produtoId: null })).toBe(false);
    expect(g.log.some((c) => c.args[0] === "produto_id")).toBe(false);
  });
});

describe("recusa e gatilho", () => {
  it("recusa: no máximo uma linha por minuto, sem payload", async () => {
    const comRecente = supabaseGravador((_t, chamadas) => (chamadas.some((c) => c.metodo === "insert") ? {} : { data: [{ id: "r" }] }));
    await bancoDaVenda(comRecente.admin).registrarRecusa(CONEXAO, "hottok não confere");
    expect(usou(comRecente.log, "sales_events", "eq", "organization_id", "org-1")).toBe(true);
    expect(comRecente.log.some((c) => c.metodo === "insert")).toBe(false);

    const sem = supabaseGravador(() => ({ data: [] }));
    await bancoDaVenda(sem.admin).registrarRecusa(CONEXAO, "hottok não confere");
    expect(sem.log.find((c) => c.metodo === "insert")?.args[0]).toEqual({
      organization_id: "org-1",
      webhook_source_id: "conexao-1",
      plataforma: "hotmart",
      status: "recusado",
      motivo: "hottok não confere",
    });
  });

  it("emitir: emit_event com sale.received no contato; erro sobe", async () => {
    const g = supabaseGravador(() => ({}));
    await bancoDaVenda(g.admin).emitir("org-1", "c1", { evento: "compra.aprovada" }, "venda:ev-1");
    expect(g.rpcs[0]).toEqual({
      fn: "emit_event",
      args: {
        p_event_type: "sale.received",
        p_entity_kind: "contact",
        p_entity_id: "c1",
        p_payload: { evento: "compra.aprovada" },
        p_metadata: { request_id: "venda:ev-1" },
        p_organization_id: "org-1",
      },
    });
    g.responderRpc(() => ({ error: { message: "support_readonly" } }));
    await expect(bancoDaVenda(g.admin).emitir("org-1", "c1", {}, "r")).rejects.toThrow("emit_event: support_readonly");
  });
});
