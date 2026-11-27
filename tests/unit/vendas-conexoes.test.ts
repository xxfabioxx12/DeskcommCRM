import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { usou, type Chamada, type Resposta } from "./helpers/supabase-gravador";

const h = vi.hoisted(() => ({
  responder: (() => ({})) as (tabela: string, chamadas: unknown[]) => unknown,
  log: [] as unknown[],
  cifrar: vi.fn(async (): Promise<string | null> => "\\xcifrado"),
}));

vi.mock("@/lib/supabase/server", async () => {
  const { supabaseGravador: gravador } = await import("./helpers/supabase-gravador");
  return {
    createClient: async () => {
      const g = gravador((t, c) => h.responder(t, c) as never);
      h.log = g.log;
      return g.admin;
    },
  };
});
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/webhooks/secrets", () => ({ encryptWebhookSecret: h.cifrar }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: async () => null }));
vi.mock("@/lib/auth/require-role", () => ({
  requireRole: async () => ({ ok: true, user: { id: "u-1", idioma: "pt-BR" }, org: { orgId: "org-1", role: "manager" } }),
}));

import { GET as listarConexoes, POST as criarConexao } from "@/app/api/v1/conexoes-de-venda/route";
import { PATCH as editarConexao } from "@/app/api/v1/conexoes-de-venda/[id]/route";
import { GET as listarEventos } from "@/app/api/v1/eventos-de-venda/route";
import { GET as listarProdutos } from "@/app/api/v1/eventos-de-venda/produtos/route";

const LINHA = {
  id: "c1",
  organization_id: "org-1",
  name: "Hotmart NODZ",
  kind: "hotmart",
  path_token: "tok",
  config: { dispara: false, telefone_regiao: "BR" },
  is_active: true,
  last_received_at: null,
  secret_encrypted: "\\xcifrado",
  created_at: "2026-10-21T15:00:00Z",
  updated_at: "2026-10-21T15:00:00Z",
};
const log = () => h.log as Chamada[];
const json = (url: string, method: string, corpo: unknown) =>
  new NextRequest(url, { method, body: JSON.stringify(corpo), headers: { "content-type": "application/json" } });
const responder = (f: (tabela: string, chamadas: Chamada[]) => Resposta) => {
  h.responder = f as never;
};

beforeEach(() => {
  h.cifrar.mockReset().mockResolvedValue("\\xcifrado");
  responder(() => ({ data: LINHA }));
});

describe("conexões de venda", () => {
  it("GET lista só conexões de venda da empresa, sem o segredo", async () => {
    responder(() => ({ data: [LINHA] }));
    const corpo = await (await listarConexoes()).json();
    expect(corpo.data[0]).toMatchObject({ id: "c1", has_secret: true, config: { dispara: false, telefone_regiao: "BR" } });
    expect(JSON.stringify(corpo)).not.toContain("secret_encrypted");
    expect(usou(log(), "webhook_sources", "eq", "organization_id", "org-1")).toBe(true);
    expect(usou(log(), "webhook_sources", "in", "kind", ["hotmart", "kiwify", "kookie", "personalizada"])).toBe(true);
  });

  it("POST cifra o segredo, nasce só registrando e não devolve o segredo", async () => {
    const res = await criarConexao(
      json("http://localhost/api/v1/conexoes-de-venda", "POST", {
        name: "Hotmart NODZ",
        kind: "hotmart",
        secret: "hottok-123456",
        config: { telefone_regiao: "BR", dispara: true },
      }),
    );
    expect(res.status).toBe(201);
    expect(h.cifrar).toHaveBeenCalledWith({}, "hottok-123456");
    const insert = log().find((c) => c.metodo === "insert")?.args[0] as Record<string, unknown>;
    expect(insert).toMatchObject({
      organization_id: "org-1",
      name: "Hotmart NODZ",
      kind: "hotmart",
      secret_encrypted: "\\xcifrado",
      config: { telefone_regiao: "BR", dispara: false },
    });
    expect(insert).not.toHaveProperty("default_pipeline_id");
    const texto = await res.text();
    expect(texto).not.toContain("hottok-123456");
    expect(texto).not.toContain("secret_encrypted");
  });

  it("POST sem a chave de cifra ativa: 422", async () => {
    h.cifrar.mockResolvedValue(null);
    const res = await criarConexao(json("http://localhost/api/v1/conexoes-de-venda", "POST", { name: "K", kind: "kiwify", secret: "token-123" }));
    expect(res.status).toBe(422);
  });

  it("POST da personalizada sem segredo passa sem cifrar", async () => {
    const res = await criarConexao(json("http://localhost/api/v1/conexoes-de-venda", "POST", { name: "Flix", kind: "personalizada" }));
    expect(res.status).toBe(201);
    expect(h.cifrar).not.toHaveBeenCalled();
    expect((log().find((c) => c.metodo === "insert")?.args[0] as Record<string, unknown>).secret_encrypted).toBeNull();
  });

  describe("PATCH", () => {
    const editar = (corpo: unknown) =>
      editarConexao(json("http://localhost/api/v1/conexoes-de-venda/c1", "PATCH", corpo), { params: Promise.resolve({ id: "c1" }) });
    const update = () => log().find((c) => c.metodo === "update")?.args[0] as Record<string, unknown>;
    const RICA = {
      ...LINHA,
      config: {
        dispara: false,
        telefone_regiao: "AR",
        seguranca: { modo: "header_igual", header: "X-Chave" },
        mapa: { nome: "cliente.nome" },
        numeros_de_saida: ["66666666-6666-4666-8666-666666666666"],
      },
    };

    it("sem segredo não mexe nele; o filtro de tipo e de empresa vale também na leitura", async () => {
      expect((await editar({ config: { dispara: true } })).status).toBe(200);
      expect(update()).not.toHaveProperty("secret_encrypted");
      expect(usou(log(), "webhook_sources", "in", "kind", ["hotmart", "kiwify", "kookie", "personalizada"])).toBe(true);
      expect(usou(log(), "webhook_sources", "eq", "organization_id", "org-1")).toBe(true);
    });

    it("F15: PATCH só com dispara mantém segurança, mapa, região e números de saída", async () => {
      responder(() => ({ data: RICA }));
      expect((await editar({ config: { dispara: true } })).status).toBe(200);
      expect(update().config).toEqual({ ...RICA.config, dispara: true });
    });

    it("F4: segredo obrigatório não pode ser apagado; opcional pode", async () => {
      expect((await editar({ secret: null })).status).toBe(400); // hotmart
      expect(log().some((c) => c.metodo === "update")).toBe(false);

      responder(() => ({ data: { ...LINHA, kind: "personalizada", config: { seguranca: { modo: "header_igual", header: "X-K" } } } }));
      expect((await editar({ secret: null })).status).toBe(400);
      // ...a menos que o mesmo PATCH desligue a validação
      expect((await editar({ secret: null, config: { seguranca: { modo: "nenhuma" } } })).status).toBe(200);
      expect(update().secret_encrypted).toBeNull();

      responder(() => ({ data: { ...LINHA, kind: "personalizada", config: {} } }));
      expect((await editar({ secret: null })).status).toBe(200);
    });

    it("de outra empresa ou de outro tipo: 404", async () => {
      responder(() => ({ data: null }));
      expect((await editar({ name: "x" })).status).toBe(404);
    });

    it("cifra o segredo novo e nunca o devolve", async () => {
      const res = await editar({ secret: "novo-segredo-1" });
      expect(h.cifrar).toHaveBeenCalledWith({}, "novo-segredo-1");
      expect(update().secret_encrypted).toBe("\\xcifrado");
      expect(await res.text()).not.toContain("novo-segredo-1");
    });
  });
});

describe("eventos de venda", () => {
  it("os filtros vão para a consulta e os dados da pessoa nunca são lidos", async () => {
    responder(() => ({ data: [] }));
    const uuid = "66666666-6666-4666-8666-666666666666";
    const res = await listarEventos(new NextRequest(`http://localhost/api/v1/eventos-de-venda?conexao_id=${uuid}&status=falhou`));
    expect(res.status).toBe(200);
    const select = String(log().find((c) => c.metodo === "select")?.args[0]);
    for (const coluna of ["payload", "venda", "email", "telefone"]) expect(select).not.toMatch(new RegExp(`\\b${coluna}\\b`));
    expect(usou(log(), "sales_events", "eq", "webhook_source_id", uuid)).toBe(true);
    expect(usou(log(), "sales_events", "eq", "status", "falhou")).toBe(true);
    expect(usou(log(), "sales_events", "eq", "organization_id", "org-1")).toBe(true);
    expect((await listarEventos(new NextRequest("http://localhost/api/v1/eventos-de-venda?status=perdido"))).status).toBe(400);
  });

  it("a lista diz a tentativa, a próxima e se ainda há dados — sem ler o payload", async () => {
    responder((_tabela, chamadas) =>
      chamadas.some((c) => c.metodo === "not")
        ? { data: [{ id: "e1" }, { id: "e4" }] }
        : {
            data: [
              { id: "e1", status: "falhou", tentativas: 1, proxima_tentativa_em: "2026-10-22T15:30:00Z" },
              { id: "e2", status: "falhou", tentativas: 3, proxima_tentativa_em: null },
              { id: "e3", status: "processado", tentativas: 0, proxima_tentativa_em: null },
              // travada: recebido com o prazo vencido (F8); a em andamento (prazo no futuro) não entra.
              { id: "e4", status: "recebido", tentativas: 1, proxima_tentativa_em: "2020-01-01T00:00:00Z" },
              { id: "e5", status: "recebido", tentativas: 1, proxima_tentativa_em: "2999-01-01T00:00:00Z" },
            ],
          },
    );
    const corpo = await (await listarEventos(new NextRequest("http://localhost/api/v1/eventos-de-venda"))).json();
    expect(corpo.data.map((e: { id: string; tem_dados: boolean }) => [e.id, e.tem_dados])).toEqual([
      ["e1", true],
      ["e2", false],
      ["e3", false],
      ["e4", true],
      ["e5", false],
    ]);
    const selects = log().filter((c) => c.metodo === "select").map((c) => String(c.args[0]));
    expect(selects[0]).toMatch(/\btentativas\b/);
    expect(selects[0]).toMatch(/\bproxima_tentativa_em\b/);
    for (const s of selects) expect(s).not.toMatch(/\bpayload\b/);
    // Só as candidatas vão para a 2ª consulta, sempre da empresa.
    expect(usou(log(), "sales_events", "in", "id", ["e1", "e2", "e4"])).toBe(true);
    expect(usou(log(), "sales_events", "not", "payload", "is", null)).toBe(true);
    expect(log().filter((c) => c.metodo === "eq" && c.args[0] === "organization_id")).toHaveLength(2);
  });

  it("erro ao ler quem ainda tem dados: 500, não 'sem botão'", async () => {
    responder((_tabela, chamadas) =>
      chamadas.some((c) => c.metodo === "not")
        ? { error: { message: "timeout" } }
        : { data: [{ id: "e1", status: "falhou", tentativas: 1, proxima_tentativa_em: null }] },
    );
    expect((await listarEventos(new NextRequest("http://localhost/api/v1/eventos-de-venda"))).status).toBe(500);
  });

  it("produtos: um por id, o mais recente primeiro", async () => {
    responder(() => ({
      data: [
        { produto_id: "1", produto: "A" },
        { produto_id: "1", produto: "A velho" },
        { produto_id: "2", produto: null },
      ],
    }));
    const corpo = await (await listarProdutos(new NextRequest("http://localhost/api/v1/eventos-de-venda/produtos"))).json();
    expect(corpo.data).toEqual([
      { produto_id: "1", produto: "A" },
      { produto_id: "2", produto: null },
    ]);
  });
});
