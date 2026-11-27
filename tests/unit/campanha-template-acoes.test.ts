/**
 * AS AÇÕES DA CAMPANHA POR TEMPLATE.
 *
 * "Enviar teste" monta e entrega ao envio um `type: "template"` com os valores do
 * contato (não um texto parecido). Aqui o envio é falso: o que se prova é o
 * pedido montado, não a entrega pela Meta.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as ConferirTemplate from "@/lib/campanhas/conferir-template";

const h = vi.hoisted(() => ({
  enviar: vi.fn(),
  conferir: vi.fn(),
  preparar: vi.fn(),
}));

vi.mock("@/app/api/v1/messages/_handler", () => ({ sendMessageHandler: h.enviar }));
vi.mock("@/lib/atendimento/origem", () => ({
  beginServiceAtOrigin: async () => ({ conversation_id: "conv-1", organization_id: "org-1" }),
}));
vi.mock("@/lib/campanhas/pool-de-numeros", () => ({ lerPoolExtra: async () => [] }));
vi.mock("@/lib/campanhas/preparacao", () => ({ prepararCampanha: h.preparar }));
vi.mock("@/lib/campanhas/consulta-de-audiencia", () => ({
  camposDoDestinatario: async () => ({ contato: { cidade: "Porto Alegre" } }),
}));
vi.mock("@/lib/campanhas/conferir-template", async (original) => ({
  ...(await original<typeof ConferirTemplate>()),
  conferirConteudoDaCampanha: h.conferir,
}));

import { duplicarAcao, iniciarAcao, prepararAcao, testarAcao, type CampanhaCarregada } from "@/lib/campanhas/acoes";
import { TEXTO_DA_FALHA_DA_CAMPANHA } from "@/lib/campanhas/tipos";

type Escrita = { tabela: string; op: "insert" | "update"; valor: Record<string, unknown> };

/**
 * PostgREST falso: toda cadeia resolve; `maybeSingle` devolve a linha da tabela.
 * `contagem` é o `count` das consultas `head` (0 = nada enviado ainda; iniciar
 * precisa de elegíveis > 0).
 */
function fakeAdmin(linhas: Record<string, Record<string, unknown> | null>, contagem = 0) {
  const escritas: Escrita[] = [];
  const from = (tabela: string) => {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "not", "or", "order", "limit", "is"]) b[m] = () => b;
    b.insert = (valor: Record<string, unknown>) => {
      escritas.push({ tabela, op: "insert", valor });
      return b;
    };
    b.update = (valor: Record<string, unknown>) => {
      escritas.push({ tabela, op: "update", valor });
      return b;
    };
    b.maybeSingle = async () => ({ data: linhas[tabela] ?? null, error: null });
    b.single = async () => ({ data: { id: "c-copia" }, error: null });
    Object.defineProperty(b, "then", {
      value: (ok: (v: unknown) => unknown) => Promise.resolve({ data: [{ id: "c-1" }], count: contagem, error: null }).then(ok),
    });
    return b;
  };
  return { admin: { from } as never, escritas };
}

const DEFINICAO = {
  name: "cidade",
  language: "pt_BR",
  parameterFormat: "POSITIONAL",
  components: [{ type: "HEADER", format: "IMAGE" }, { type: "BODY", text: "Oi {{1}}, você está em {{2}}." }],
  salvos: { "header:1": "https://cdn.example/capa.png" },
};

const CAMPANHA: CampanhaCarregada = {
  id: "c-1",
  organization_id: "org-1",
  name: "Cidades",
  status: "draft",
  channel_session_id: "s-oficial",
  message_body: null,
  base_legal: "consent",
  lia_ref: null,
  audience_filter: { com_alguma_tag: ["vip"] },
  audience_version: 1,
  content_version: 2,
  scheduled_at: null,
  intervalo_segundos: null,
  janela_inicio_hora: null,
  janela_fim_hora: null,
  teto_diario: null,
  teto_horario: null,
  description: null,
  message_mode: "template",
  template_name: "cidade",
  template_language: "pt_BR",
  template_contract_hash: "h1",
  template_slot_map: { "1": "{{primeiro_nome}}", "2": "{{contato.cidade}}" },
  failure_code: null,
  duplicated_from_campaign_id: null,
};

const CONTATO = {
  id: "ct-1",
  name: "Ana Souza",
  display_name: null,
  phone_number: "+5511999990001",
  is_blocked: false,
  is_personal: false,
  is_anonymized: false,
  consent: {},
};

const AGORA = new Date("2026-10-20T18:00:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
  h.conferir.mockResolvedValue({ ok: true, definicao: DEFINICAO });
  h.enviar.mockResolvedValue({ id: "m-1", status: "sent" });
  h.preparar.mockResolvedValue({ total: 2, elegiveis: 1, excluidos: 1, motivos: { variavel_ausente: 1 } });
});

describe("testar", () => {
  it("monta o pedido de envio como template, com o link salvo e as variáveis do contato", async () => {
    const { admin } = fakeAdmin({ contacts: CONTATO });
    const r = await testarAcao(admin, CAMPANHA, "ct-1", AGORA, "America/Sao_Paulo");
    expect(r).toEqual({ ok: true, status: "sent" });
    const entrada = h.enviar.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(entrada).toMatchObject({
      conversation_id: "conv-1",
      type: "template",
      template_name: "cidade",
      template_language: "pt_BR",
      template_values: { "header:1": "https://cdn.example/capa.png", "1": "Ana", "2": "Porto Alegre" },
      body: "Oi Ana, você está em Porto Alegre.",
    });
  });

  it("recusa da conferência (template pausado) volta antes de enviar", async () => {
    h.conferir.mockResolvedValue({ ok: false, codigo: "campanha_template_invalido", mensagem: "pausado", status: 422, falha: "template_nao_aprovado" });
    const { admin } = fakeAdmin({ contacts: CONTATO });
    const r = await testarAcao(admin, CAMPANHA, "ct-1", AGORA, "America/Sao_Paulo");
    expect(r).toMatchObject({ ok: false, codigo: "campanha_template_invalido", status: 422 });
    expect(h.enviar).not.toHaveBeenCalled();
  });
});

describe("preparar", () => {
  it("template: confere, e passa o mapa e a definição para a preparação", async () => {
    const { admin } = fakeAdmin({});
    const r = await prepararAcao(admin, CAMPANHA, AGORA);
    expect(r.ok).toBe(true);
    expect(h.preparar.mock.calls[0]?.[1]).toMatchObject({
      template: {
        slotMap: CAMPANHA.template_slot_map,
        modelo: { name: "cidade", language: "pt_BR", parameterFormat: "POSITIONAL", components: DEFINICAO.components },
      },
    });
  });
  it("exceção inesperada na conferência vira 500, sem escrever nada", async () => {
    h.conferir.mockRejectedValue(new Error("banco fora"));
    const { admin, escritas } = fakeAdmin({});
    const r = await prepararAcao(admin, CAMPANHA, AGORA);
    expect(r).toMatchObject({ ok: false, codigo: "internal_error", status: 500 });
    expect(escritas).toEqual([]);
  });
  it("número oficial com campanha em texto: recusa ANTES de mudar o estado", async () => {
    h.conferir.mockResolvedValue({ ok: false, codigo: "campanha_exige_template", mensagem: "oficial", status: 422 });
    const { admin, escritas } = fakeAdmin({});
    const r = await prepararAcao(admin, { ...CAMPANHA, message_mode: "text", message_body: "Oi" }, AGORA);
    expect(r).toMatchObject({ ok: false, codigo: "campanha_exige_template" });
    expect(escritas).toEqual([]);
  });
});

describe("iniciar e duplicar", () => {
  it("retomar campanha pausada por template limpa o motivo; outro motivo fica", async () => {
    const pausada = { ...CAMPANHA, status: "paused" as const, failure_code: "template_mudou" };
    const a = fakeAdmin({}, 5);
    await iniciarAcao(a.admin, pausada, AGORA);
    expect(a.escritas.find((e) => e.tabela === "campaigns")?.valor).toMatchObject({ failure_code: null, failure_detail: null });
    const b = fakeAdmin({}, 5);
    await iniciarAcao(b.admin, { ...pausada, failure_code: "sem_elegiveis" }, AGORA);
    expect(b.escritas.find((e) => e.tabela === "campaigns")?.valor).not.toHaveProperty("failure_code");
  });
  it("retomar limpa também as pausas do disjuntor (numero_com_problema, falhas_seguidas)", async () => {
    for (const codigo of ["numero_com_problema", "falhas_seguidas"]) {
      const a = fakeAdmin({}, 5);
      await iniciarAcao(a.admin, { ...CAMPANHA, status: "paused", failure_code: codigo }, AGORA);
      expect(a.escritas.find((e) => e.tabela === "campaigns")?.valor, codigo).toMatchObject({
        failure_code: null,
        failure_detail: null,
      });
    }
  });
  it("duplicar grava de qual campanha a cópia saiu (para pular quem já recebeu)", async () => {
    const { admin, escritas } = fakeAdmin({});
    await duplicarAcao(admin, CAMPANHA, "u-1");
    expect(escritas[0]?.valor).toMatchObject({ duplicated_from_campaign_id: "c-1", organization_id: "org-1" });
  });
  it("retomar pausada com o template ainda com problema: a recusa manda duplicar", async () => {
    h.conferir.mockResolvedValue({
      ok: false,
      codigo: "campanha_template_invalido",
      mensagem: "O template mudou na Meta: escolha de novo.",
      status: 422,
      falha: "template_mudou",
    });
    const pausada = { ...CAMPANHA, status: "paused" as const, failure_code: "template_mudou" };
    const { admin, escritas } = fakeAdmin({}, 5);
    const r = await iniciarAcao(admin, pausada, AGORA);
    expect(r).toMatchObject({ ok: false, codigo: "campanha_template_invalido", status: 422 });
    expect(!r.ok && r.mensagem).toBe(TEXTO_DA_FALHA_DA_CAMPANHA.template_mudou);
    expect(escritas).toEqual([]);
  });
  it("no rascunho a recusa continua pedindo para escolher outro template", async () => {
    h.conferir.mockResolvedValue({
      ok: false,
      codigo: "campanha_template_invalido",
      mensagem: "O template mudou na Meta: escolha de novo.",
      status: 422,
      falha: "template_mudou",
    });
    const { admin } = fakeAdmin({});
    const r = await prepararAcao(admin, CAMPANHA, AGORA);
    expect(!r.ok && r.mensagem).toBe("O template mudou na Meta: escolha de novo.");
  });
  it("duplicar copia o template e o mapa", async () => {
    const { admin, escritas } = fakeAdmin({});
    await duplicarAcao(admin, CAMPANHA, "u-1");
    expect(escritas[0]?.valor).toMatchObject({
      message_mode: "template",
      template_name: "cidade",
      template_language: "pt_BR",
      template_contract_hash: "h1",
      template_slot_map: CAMPANHA.template_slot_map,
    });
  });
  it("texto com variável desconhecida ou mal escrita: recusa 422 no preparar, sem escrever nada", async () => {
    for (const message_body of ['Oi {{first_name|"aluno"}}', "Oi {{nome|aluno}}"]) {
      const { admin, escritas } = fakeAdmin({});
      const r = await prepararAcao(admin, { ...CAMPANHA, message_mode: "text", message_body }, AGORA);
      expect(r).toMatchObject({ ok: false, codigo: "campanha_conteudo_invalido", status: 422 });
      expect(escritas).toEqual([]);
    }
  });
});
