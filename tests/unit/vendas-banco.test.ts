import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ porTelefone: vi.fn() }));
vi.mock("@/lib/channels/contato-por-telefone", () => ({ encontrarContatoPorTelefoneComNome: h.porTelefone }));

import { bancoDaVenda } from "@/lib/vendas/banco";
import type { ConexaoDeVenda, LinhaNovaDaVenda } from "@/lib/vendas/receber";
import type { LinhaGuardada } from "@/lib/vendas/reprocessar";

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
  proxima_tentativa_em: "2026-10-22T15:15:00.000Z",
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

describe("concluir e conexão (Parte 2b)", () => {
  it("concluir grava a próxima tentativa, e nulo quando não há (limpa o prazo de quem pegou)", async () => {
    const g = supabaseGravador(() => ({}));
    const banco = bancoDaVenda(g.admin);
    await banco.concluir("ev-1", { status: "falhou", motivo: "x", proximaTentativaEm: new Date("2026-10-22T15:05:00Z") });
    await banco.concluir("ev-2", { status: "processado", motivo: null, contactId: "c1" });
    const updates = g.log.filter((c) => c.metodo === "update").map((c) => c.args[0]);
    expect(updates).toEqual([
      { status: "falhou", motivo: "x", contact_id: null, proxima_tentativa_em: "2026-10-22T15:05:00.000Z" },
      { status: "processado", motivo: null, contact_id: "c1", proxima_tentativa_em: null },
    ]);
  });

  it("F9: concluir só grava se a linha ainda está recebido (não sobrescreve o desfecho de outra execução)", async () => {
    const g = supabaseGravador(() => ({}));
    await bancoDaVenda(g.admin).concluir("ev-1", { status: "processado", motivo: null, contactId: "c1" });
    expect(usou(g.log, "sales_events", "eq", "id", "ev-1")).toBe(true);
    expect(usou(g.log, "sales_events", "eq", "status", "recebido")).toBe(true);
  });

  it("F1: completarLinha grava só as colunas derivadas, só na linha ainda recebido; erro sobe", async () => {
    const g = supabaseGravador(() => ({ data: [{ id: "ev-1" }] }));
    const colunas = {
      evento: "compra.aprovada",
      entidade: "custom:P-1",
      pedido: "P-1",
      produto_id: null,
      produto: null,
      email: "a@b.com",
      telefone: null,
      order_bump: false,
      venda: {},
    };
    await bancoDaVenda(g.admin).completarLinha("org-1", "ev-1", colunas);
    expect(g.log.find((c) => c.metodo === "update")?.args[0]).toEqual(colunas);
    expect(usou(g.log, "sales_events", "eq", "id", "ev-1")).toBe(true);
    expect(usou(g.log, "sales_events", "eq", "organization_id", "org-1")).toBe(true);
    expect(usou(g.log, "sales_events", "eq", "status", "recebido")).toBe(true);
    expect(usou(g.log, "sales_events", "not", "payload", "is", null)).toBe(true);
    await expect(
      bancoDaVenda(supabaseGravador(() => ({ error: { message: "timeout" } })).admin).completarLinha("org-1", "ev-1", colunas),
    ).rejects.toThrow("sales_events: timeout");
  });

  it("M1: completarLinha numa linha anonimizada no meio (ou que saiu de recebido) não grava e LANÇA", async () => {
    // O UPDATE filtra `payload is not null`: a anonimização zerou o payload, nenhuma linha muda.
    const g = supabaseGravador(() => ({ data: [] }));
    const colunas = {
      evento: "compra.aprovada",
      entidade: "custom:P-1",
      pedido: "P-1",
      produto_id: null,
      produto: null,
      email: "a@b.com",
      telefone: null,
      order_bump: false,
      venda: {},
    };
    await expect(bancoDaVenda(g.admin).completarLinha("org-1", "ev-1", colunas)).rejects.toThrow(/sales_events/);
  });

  it("conexao: só de venda, só da empresa; traz a config atual e se está ligada", async () => {
    const g = supabaseGravador(() => ({
      data: { id: "conexao-1", organization_id: "org-1", kind: "hotmart", config: { dispara: true }, is_active: false },
    }));
    const conexao = await bancoDaVenda(g.admin).conexao("org-1", "conexao-1");
    expect(conexao).toEqual({ id: "conexao-1", organizationId: "org-1", plataforma: "hotmart", config: { dispara: true }, ativa: false });
    expect(usou(g.log, "webhook_sources", "eq", "id", "conexao-1")).toBe(true);
    expect(usou(g.log, "webhook_sources", "eq", "organization_id", "org-1")).toBe(true);
    expect(usou(g.log, "webhook_sources", "in", "kind", ["hotmart", "kiwify", "kookie", "personalizada"])).toBe(true);
    expect(await bancoDaVenda(supabaseGravador(() => ({ data: null })).admin).conexao("org-1", "x")).toBeNull();
    await expect(
      bancoDaVenda(supabaseGravador(() => ({ error: { message: "timeout" } })).admin).conexao("org-1", "x"),
    ).rejects.toThrow("webhook_sources: timeout");
  });
});

const AGORA = new Date("2026-10-22T15:00:00Z");
const GUARDADA: LinhaGuardada = {
  id: "ev-9",
  organization_id: "org-1",
  webhook_source_id: "conexao-1",
  plataforma: "hotmart",
  evento_original: "PURCHASE_APPROVED",
  evento: "compra.aprovada",
  chave_evento: "hm-evt-0001",
  teste: false,
  payload: { id: "hm-evt-0001" },
  tentativas: 1,
  status: "falhou",
  recebido_em: "2026-10-22T14:00:00.000Z",
};

describe("a fila da nova tentativa (Parte 2b)", () => {
  it("pendentes: falhou das últimas 24 h e recebido com prazo vencido de qualquer idade, com dados, na ordem", async () => {
    const g = supabaseGravador(() => ({ data: [GUARDADA] }));
    expect(await bancoDaVenda(g.admin).pendentes(AGORA, 25)).toEqual([GUARDADA]);
    // Os três filtros do índice parcial sales_events_fila_da_tentativa_idx.
    expect(usou(g.log, "sales_events", "in", "status", ["falhou", "recebido"])).toBe(true);
    expect(usou(g.log, "sales_events", "not", "proxima_tentativa_em", "is", null)).toBe(true);
    expect(usou(g.log, "sales_events", "lte", "proxima_tentativa_em", AGORA.toISOString())).toBe(true);
    // F15: a janela de 24 h vale só para a falhou; a recebido presa vem de qualquer idade.
    expect(usou(g.log, "sales_events", "or", "status.eq.recebido,recebido_em.gte.2026-10-21T15:00:00.000Z")).toBe(true);
    expect(g.log.some((c) => c.metodo === "gte")).toBe(false);
    expect(usou(g.log, "sales_events", "not", "payload", "is", null)).toBe(true);
    expect(usou(g.log, "sales_events", "order", "proxima_tentativa_em", { ascending: true })).toBe(true);
    expect(usou(g.log, "sales_events", "limit", 25)).toBe(true);
    const select = String(g.log.find((c) => c.metodo === "select")?.args[0]);
    for (const coluna of ["tentativas", "payload", "evento_original", "evento", "chave_evento", "recebido_em"]) expect(select).toContain(coluna);
    expect(select.split(", ")).toContain("evento");
  });

  it("pendentes: erro de leitura sobe (fila vazia por engano perderia a venda)", async () => {
    await expect(
      bancoDaVenda(supabaseGravador(() => ({ error: { message: "timeout" } })).admin).pendentes(AGORA, 25),
    ).rejects.toThrow("sales_events: timeout");
  });

  it("prender: UPDATE condicional falhou/recebido → recebido, só se a contagem e o horário ainda são os lidos", async () => {
    const g = supabaseGravador(() => ({ data: [{ id: "ev-9" }] }));
    expect(await bancoDaVenda(g.admin).prender(GUARDADA, AGORA)).toBe(true);
    expect(g.log.find((c) => c.metodo === "update")?.args[0]).toEqual({
      status: "recebido",
      tentativas: 2,
      proxima_tentativa_em: "2026-10-22T15:15:00.000Z",
    });
    expect(usou(g.log, "sales_events", "eq", "id", "ev-9")).toBe(true);
    expect(usou(g.log, "sales_events", "eq", "organization_id", "org-1")).toBe(true);
    expect(usou(g.log, "sales_events", "in", "status", ["falhou", "recebido"])).toBe(true);
    expect(usou(g.log, "sales_events", "eq", "tentativas", 1)).toBe(true);
    expect(usou(g.log, "sales_events", "lte", "proxima_tentativa_em", AGORA.toISOString())).toBe(true);
    expect(usou(g.log, "sales_events", "not", "payload", "is", null)).toBe(true);
    expect(await bancoDaVenda(supabaseGravador(() => ({ data: [] })).admin).prender(GUARDADA, AGORA)).toBe(false);
    await expect(
      bancoDaVenda(supabaseGravador(() => ({ error: { message: "caiu" } })).admin).prender(GUARDADA, AGORA),
    ).rejects.toThrow("sales_events: caiu");
  });

  it("encerrar: a 3ª que caiu no meio fica falhou de vez, com motivo, só se ainda está presa", async () => {
    const g = supabaseGravador(() => ({ data: [{ id: "ev-9" }] }));
    const presa = { ...GUARDADA, tentativas: 3, status: "recebido" as const };
    expect(await bancoDaVenda(g.admin).encerrar(presa, AGORA)).toBe(true);
    expect(g.log.find((c) => c.metodo === "update")?.args[0]).toEqual({
      status: "falhou",
      motivo: "a tentativa parou no meio",
      proxima_tentativa_em: null,
    });
    expect(usou(g.log, "sales_events", "eq", "organization_id", "org-1")).toBe(true);
    expect(usou(g.log, "sales_events", "eq", "status", "recebido")).toBe(true);
    expect(usou(g.log, "sales_events", "eq", "tentativas", 3)).toBe(true);
    expect(await bancoDaVenda(supabaseGravador(() => ({ data: [] })).admin).encerrar(presa, AGORA)).toBe(false);
    await expect(
      bancoDaVenda(supabaseGravador(() => ({ error: { message: "caiu" } })).admin).encerrar(presa, AGORA),
    ).rejects.toThrow("sales_events: caiu");
  });
});

describe("prenderPeloBotao (Parte 2b)", () => {
  const comUpdate = (dados: unknown, depois: unknown) =>
    supabaseGravador((_tabela, chamadas) =>
      chamadas.some((c) => c.metodo === "update") ? { data: depois } : { data: dados },
    );

  it("zera a contagem e pega a venda falhou da própria empresa", async () => {
    const g = comUpdate(GUARDADA, [{ id: "ev-9" }]);
    const preso = await bancoDaVenda(g.admin).prenderPeloBotao("org-1", "ev-9", AGORA);
    expect(preso).toEqual({ ...GUARDADA, status: "recebido", tentativas: 0 });
    expect(g.log.find((c) => c.metodo === "update")?.args[0]).toEqual({
      status: "recebido",
      tentativas: 0,
      proxima_tentativa_em: "2026-10-22T15:15:00.000Z",
    });
    expect(g.log.filter((c) => c.metodo === "eq" && c.args[0] === "organization_id").map((c) => c.args[1])).toEqual([
      "org-1",
      "org-1",
    ]);
    expect(usou(g.log, "sales_events", "eq", "status", "falhou")).toBe(true);
    expect(usou(g.log, "sales_events", "not", "payload", "is", null)).toBe(true);
  });

  it("não achou (ou é de outra empresa), não está falhou, ou já sem dados: recusa sem tocar a linha", async () => {
    for (const [linha, esperado] of [
      [null, "nao_achou"],
      [{ ...GUARDADA, status: "processado" }, "nao_falhou"],
      [{ ...GUARDADA, payload: null }, "sem_dados"],
    ] as const) {
      const g = comUpdate(linha, [{ id: "ev-9" }]);
      expect(await bancoDaVenda(g.admin).prenderPeloBotao("org-1", "ev-9", AGORA)).toBe(esperado);
      expect(g.log.some((c) => c.metodo === "update")).toBe(false);
    }
  });

  it("outra mão pegou entre a leitura e o UPDATE → nao_falhou; erro de leitura sobe", async () => {
    expect(await bancoDaVenda(comUpdate(GUARDADA, []).admin).prenderPeloBotao("org-1", "ev-9", AGORA)).toBe("nao_falhou");
    await expect(
      bancoDaVenda(supabaseGravador(() => ({ error: { message: "timeout" } })).admin).prenderPeloBotao("org-1", "ev-9", AGORA),
    ).rejects.toThrow("sales_events: timeout");
  });

  it("F8: recebido com prazo vencido (travada) é pega; recebido dentro do prazo é recusada", async () => {
    const travada = { ...GUARDADA, status: "recebido", tentativas: 2, proxima_tentativa_em: "2026-10-22T14:59:00.000Z" };
    const g = comUpdate(travada, [{ id: "ev-9" }]);
    const preso = await bancoDaVenda(g.admin).prenderPeloBotao("org-1", "ev-9", AGORA);
    expect(preso).toMatchObject({ id: GUARDADA.id, status: "recebido", tentativas: 0 });
    expect(preso).not.toHaveProperty("proxima_tentativa_em");
    expect(usou(g.log, "sales_events", "eq", "status", "recebido")).toBe(true);
    expect(usou(g.log, "sales_events", "lte", "proxima_tentativa_em", AGORA.toISOString())).toBe(true);
    for (const prazo of ["2026-10-22T15:05:00.000Z", null]) {
      const em = comUpdate({ ...GUARDADA, status: "recebido", proxima_tentativa_em: prazo }, [{ id: "ev-9" }]);
      expect(await bancoDaVenda(em.admin).prenderPeloBotao("org-1", "ev-9", AGORA)).toBe("nao_falhou");
      expect(em.log.some((c) => c.metodo === "update")).toBe(false);
    }
  });
});
