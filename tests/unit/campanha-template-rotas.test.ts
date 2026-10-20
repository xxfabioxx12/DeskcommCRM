/**
 * POST/PATCH da campanha: o template é conferido ANTES de gravar, e mexer no
 * mapa sobe a versão do conteúdo (é por ela que se sabe se a lista preparada é
 * a mensagem de hoje).
 */
import type * as ConferirTemplate_ from "@/lib/campanhas/conferir-template";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

type ConferirTemplate = typeof ConferirTemplate_;
const h = vi.hoisted(() => ({
  conferir: vi.fn(),
  admin: null as unknown,
}));

vi.mock("@/lib/auth/require-role", () => ({
  requireRole: async () => ({ ok: true, org: { orgId: "org-1" }, user: { id: "u-1", idioma: "pt-BR" } }),
}));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: async () => null }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.admin }));
vi.mock("@/lib/campanhas/pool-de-numeros", () => ({
  lerPoolExtra: async () => [],
  gravarPool: async () => ({ ok: true, recusados: [], gravados: [] }),
}));
vi.mock("@/lib/campanhas/conferir-template", async (original) => ({
  ...(await original<ConferirTemplate>()),
  conferirConteudoDaCampanha: h.conferir,
}));
// A rota de edição importa `carregarCampanha` de `acoes.ts`, que importa a porta
// de saída das mensagens: dublada para o teste não carregar o envio inteiro.
vi.mock("@/app/api/v1/messages/_handler", () => ({ sendMessageHandler: vi.fn() }));
vi.mock("@/lib/atendimento/origem", () => ({ beginServiceAtOrigin: vi.fn() }));

import { POST } from "@/app/api/v1/campaigns/route";
import { PATCH } from "@/app/api/v1/campaigns/[id]/route";

type Linha = Record<string, unknown>;

/** PostgREST falso: guarda o insert/update e devolve a linha da tabela pedida. */
function fakeAdmin(respostas: { canal?: Linha | null; campanha?: Linha | null }) {
  const gravado: { insert?: Linha; update?: Linha } = {};
  const from = (tabela: string) => {
    let op: "select" | "insert" | "update" = "select";
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "order", "limit"]) b[m] = () => b;
    b.insert = (linha: Linha) => {
      op = "insert";
      gravado.insert = linha;
      return b;
    };
    b.update = (linha: Linha) => {
      op = "update";
      gravado.update = linha;
      return b;
    };
    const fim = async () => {
      if (tabela === "channel_sessions") return { data: respostas.canal ?? null, error: null };
      if (op === "insert") return { data: { id: "c-nova", ...gravado.insert }, error: null };
      if (op === "update") return { data: { ...respostas.campanha, ...gravado.update }, error: null };
      return { data: respostas.campanha ?? null, error: null };
    };
    b.single = fim;
    b.maybeSingle = fim;
    return b;
  };
  return { cliente: { from }, gravado };
}

const PRINCIPAL = "11111111-1111-4111-8111-111111111111";
const EXTRA = "22222222-2222-4222-8222-222222222222";
const CORPO_TEMPLATE = {
  name: "Reativação",
  channel_session_id: PRINCIPAL,
  channel_session_ids: [EXTRA],
  base_legal: "consent",
  message_mode: "template",
  template_name: "boas_vindas",
  template_language: "pt_BR",
  template_contract_hash: "h1",
  template_slot_map: { "1": "{{primeiro_nome}}", "2": "Super Presell" },
};

const req = (method: string, url: string, body: unknown) =>
  new NextRequest(url, { method, body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  h.conferir.mockResolvedValue({ ok: true, definicao: null });
});

describe("POST /api/v1/campaigns", () => {
  it("número oficial com texto livre: 422 e nada gravado", async () => {
    const f = fakeAdmin({ canal: { id: PRINCIPAL } });
    h.admin = f.cliente;
    h.conferir.mockResolvedValue({
      ok: false,
      codigo: "campanha_exige_template",
      mensagem: "Este número é oficial: para quem não falou com você nas últimas 24 horas, a Meta só entrega template aprovado. Escolha um template.",
      status: 422,
    });
    const res = await POST(req("POST", "http://x/api/v1/campaigns", { name: "R", channel_session_id: PRINCIPAL, base_legal: "consent", message_body: "Oi" }));
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("campanha_exige_template");
    expect(f.gravado.insert).toBeUndefined();
  });

  it("template conferido: grava as colunas novas, sem texto livre, com o principal primeiro", async () => {
    const f = fakeAdmin({ canal: { id: PRINCIPAL } });
    h.admin = f.cliente;
    const res = await POST(req("POST", "http://x/api/v1/campaigns", { ...CORPO_TEMPLATE, message_body: "sobra" }));
    expect(res.status).toBe(201);
    expect(h.conferir).toHaveBeenCalledWith(f.cliente, {
      organizationId: "org-1",
      channelSessionIds: [PRINCIPAL, EXTRA],
      conteudo: {
        messageMode: "template",
        templateName: "boas_vindas",
        templateLanguage: "pt_BR",
        templateContractHash: "h1",
        slotMap: { "1": "{{primeiro_nome}}", "2": "Super Presell" },
      },
    });
    expect(f.gravado.insert).toMatchObject({
      message_mode: "template",
      message_body: null,
      template_name: "boas_vindas",
      template_language: "pt_BR",
      template_contract_hash: "h1",
      template_slot_map: { "1": "{{primeiro_nome}}", "2": "Super Presell" },
    });
  });

  it("corpo antigo (texto, sem campo novo) grava texto como hoje", async () => {
    const f = fakeAdmin({ canal: { id: PRINCIPAL } });
    h.admin = f.cliente;
    const res = await POST(req("POST", "http://x/api/v1/campaigns", { name: "R", channel_session_id: PRINCIPAL, base_legal: "consent", message_body: "Oi {{nome}}" }));
    expect(res.status).toBe(201);
    expect(f.gravado.insert).toMatchObject({ message_mode: "text", message_body: "Oi {{nome}}", template_name: null, template_slot_map: {} });
  });
});

describe("PATCH /api/v1/campaigns/:id", () => {
  const RASCUNHO = {
    id: "c-1",
    organization_id: "org-1",
    name: "R",
    status: "draft",
    channel_session_id: PRINCIPAL,
    message_body: null,
    base_legal: "consent",
    lia_ref: null,
    content_version: 3,
    message_mode: "template",
    template_name: "boas_vindas",
    template_language: "pt_BR",
    template_contract_hash: "h1",
    template_slot_map: { "1": "{{primeiro_nome}}", "2": "Super Presell" },
  };
  const ctx = { params: Promise.resolve({ id: "c-1" }) };

  it("mexer no mapa confere e sobe a versão do conteúdo", async () => {
    const f = fakeAdmin({ campanha: RASCUNHO });
    h.admin = f.cliente;
    const res = await PATCH(req("PATCH", "http://x/api/v1/campaigns/c-1", { template_slot_map: { "1": "{{nome}}", "2": "Super Presell" } }), ctx);
    expect(res.status).toBe(200);
    expect(h.conferir).toHaveBeenCalledTimes(1);
    expect(f.gravado.update).toMatchObject({ content_version: 4, template_slot_map: { "1": "{{nome}}", "2": "Super Presell" } });
  });

  it("só o nome: não confere e não sobe a versão", async () => {
    const f = fakeAdmin({ campanha: RASCUNHO });
    h.admin = f.cliente;
    const res = await PATCH(req("PATCH", "http://x/api/v1/campaigns/c-1", { name: "Outro nome" }), ctx);
    expect(res.status).toBe(200);
    expect(h.conferir).not.toHaveBeenCalled();
    expect(f.gravado.update?.content_version).toBeUndefined();
  });

  it("recusa da conferência vira a resposta, e nada é gravado", async () => {
    const f = fakeAdmin({ campanha: RASCUNHO });
    h.admin = f.cliente;
    h.conferir.mockResolvedValue({ ok: false, codigo: "campanha_template_invalido", mensagem: "O template mudou na Meta: escolha de novo.", status: 422, falha: "template_mudou" });
    const res = await PATCH(req("PATCH", "http://x/api/v1/campaigns/c-1", { template_contract_hash: "h-velho" }), ctx);
    expect(res.status).toBe(422);
    expect(f.gravado.update).toBeUndefined();
  });

  it("só trocar o modo para template, sem template salvo, confere o conteúdo mesclado e recusa (422)", async () => {
    const f = fakeAdmin({ campanha: { ...RASCUNHO, message_mode: "text", message_body: "Oi", template_name: null, template_language: null, template_contract_hash: null, template_slot_map: {} } });
    h.admin = f.cliente;
    h.conferir.mockResolvedValue({ ok: false, codigo: "campanha_template_invalido", mensagem: "Escolha um template.", status: 422, falha: "template_nao_escolhido" });
    const res = await PATCH(req("PATCH", "http://x/api/v1/campaigns/c-1", { message_mode: "template" }), ctx);
    expect(res.status).toBe(422);
    expect(h.conferir).toHaveBeenCalledWith(f.cliente, expect.objectContaining({
      conteudo: { messageMode: "template", templateName: null, templateLanguage: null, templateContractHash: null, slotMap: {} },
    }));
    expect(f.gravado.update).toBeUndefined();
  });

  it("falha de banco na conferência vira 500", async () => {
    const f = fakeAdmin({ campanha: RASCUNHO });
    h.admin = f.cliente;
    h.conferir.mockRejectedValue(new Error("db fora"));
    const res = await PATCH(req("PATCH", "http://x/api/v1/campaigns/c-1", { template_slot_map: { "1": "{{nome}}", "2": "x" } }), ctx);
    expect(res.status).toBe(500);
    expect(f.gravado.update).toBeUndefined();
  });
});

