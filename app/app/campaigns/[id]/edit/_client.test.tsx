// app/app/campaigns/[id]/edit/_client.test.tsx
/**
 * O AVISO DO TETO NA PRÉVIA DA EDIÇÃO (#2402, #2404).
 *
 * A mesma ponta da tela de criação, com a carga real por trás: o `truncado`
 * de `buscarCandidatos` só protege o operador se a edição — que é onde uma
 * campanha grande é conferida de novo — também mostrar o recibo.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { avaliarModeloParaCampanha, type ModeloEscolhido } from "@/lib/campanhas/template-da-campanha";
import { CHANNEL_PROVIDER_META } from "@/lib/channels/capabilities";

import { EditarCampanha } from "./_client";

const previa = vi.hoisted(() => {
  const dados = () => ({
    total: 20_001,
    elegiveis: 500,
    excluidos: 0,
    motivos: {} as Record<string, number>,
    truncado: false,
    amostra: [] as Array<{ nome: string | null; motivo: string | null }>,
    legenda: {} as Record<string, string>,
    exemplo: null as Record<string, string> | null,
  });
  const p = {
    dados,
    isPending: false,
    mutate: vi.fn(),
    data: dados() as ReturnType<typeof dados> | undefined,
    // Como o TanStack: `reset` descarta o resultado da prévia.
    reset: vi.fn(() => {
      p.data = undefined;
    }),
  };
  return p;
});

const CAMPANHA: Record<string, unknown> = {
  id: "c1",
  name: "Reativação de clientes parados",
  status: "draft",
  channel_session_id: "",
  base_legal: "consent",
  lia_ref: null,
  audience_filter: { com_alguma_tag: ["vip"], limite: 100 },
  message_body: "Oi {{nome}}",
  pipeline_id: null,
  stage_id: null,
  agent_id: null,
};

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (chave: string) => chave }));
const carga = vi.hoisted(() => ({ campanha: null as Record<string, unknown> | null }));
const salvar = vi.hoisted(() => ({ mutateAsync: vi.fn(), isPending: false }));
vi.mock("@/hooks/campanhas/useCampanhas", () => ({
  useCampanha: () => ({ data: carga.campanha ?? CAMPANHA, isLoading: false }),
  useEditarCampanha: () => salvar,
  usePreviaDaAudiencia: () => previa,
  // Número por QR: o formulário mostra o campo de texto, que é o caso deste teste.
  useModelosDaCampanha: () => ({ data: { modo: "text", modelos: [] }, isLoading: false }),
}));
const canais = vi.hoisted(() => ({ data: [] as Array<Record<string, unknown>> }));
vi.mock("@/hooks/channels/useChannelSessions", () => ({
  useChannelSessions: () => ({ data: canais.data, isLoading: false }),
  channelLabel: (c: { display_name?: string | null }) => c.display_name ?? "Número sem nome",
}));
vi.mock("@/hooks/campanhas/useDestinoDaCampanha", () => ({
  useFunis: () => ({ data: [], isLoading: false }),
  useEtapas: () => ({ data: [], isLoading: false }),
  useAgentesPublicados: () => ({ data: [], isLoading: false }),
}));
const modelo = vi.hoisted(() => ({
  preencher: null as Array<Record<string, string>> | null,
  /** Quando presente, o hook responde de verdade ao template escolhido. */
  fn: null as null | ((escolhido: ModeloEscolhido | null) => unknown),
}));
vi.mock("@/hooks/campanhas/useModeloDaCampanha", () => ({
  useModeloDaCampanha: (_canal: string | null, escolhido: ModeloEscolhido | null) =>
    modelo.fn
      ? modelo.fn(escolhido)
      : { carregando: false, opcoes: [], atual: null, desatualizado: false, preencher: modelo.preencher },
}));

const AVISO = /bateu o teto de 20\.000 negócios desta prévia/;

describe("prévia da edição de campanha: o aviso do teto de 20.000", () => {
  beforeEach(() => {
    previa.data = previa.dados();
    previa.isPending = false;
    canais.data = [];
    carga.campanha = null;
    modelo.preencher = null;
    modelo.fn = null;
  });

  it("recorte truncado: a edição mostra o aviso", async () => {
    previa.data!.truncado = true;
    render(<EditarCampanha id="c1" />);
    expect(await screen.findByText(AVISO)).toBeInTheDocument();
  });

  it("recorte inteiro: nenhum aviso", async () => {
    render(<EditarCampanha id="c1" />);
    expect(await screen.findByDisplayValue("Reativação de clientes parados")).toBeInTheDocument();
    expect(screen.queryByText(AVISO)).not.toBeInTheDocument();
  });
});

describe("edição de campanha por template", () => {
  beforeEach(() => {
    canais.data = [{ id: "s-oficial", provider: CHANNEL_PROVIDER_META, display_name: "Oficial" }];
    carga.campanha = {
      ...CAMPANHA,
      channel_session_id: "s-oficial",
      message_body: null,
      message_mode: "template",
      template_name: "boas_vindas",
      template_language: "pt_BR",
      template_contract_hash: "h-1",
      template_slot_map: { "1": "{{primeiro_nome}}" },
    };
    modelo.preencher = [{ key: "1", valueKey: "1", expects: "text", onde: "corpo" }];
    modelo.fn = null;
    previa.data = previa.dados();
    salvar.mutateAsync.mockReset();
    salvar.mutateAsync.mockResolvedValue({});
  });

  it("carrega o template salvo, sem texto livre, e salva o template de volta", async () => {
    render(<EditarCampanha id="c1" />);
    expect(await screen.findByText(/Este número é oficial/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Texto da mensagem")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));
    await waitFor(() => expect(salvar.mutateAsync).toHaveBeenCalledTimes(1));
    expect(salvar.mutateAsync.mock.calls[0]![0]).toMatchObject({
      message_mode: "template",
      message_body: null,
      template_name: "boas_vindas",
      template_language: "pt_BR",
      template_contract_hash: "h-1",
      template_slot_map: { "1": "{{primeiro_nome}}" },
    });
  });
});

describe("prévia por template: o exemplo nunca fica velho", () => {
  const slot = { key: "1", valueKey: "1", expects: "text", onde: "corpo" };
  const tpl = (name: string, corpo: string) => ({
    name,
    language: "pt_BR",
    status: "APPROVED",
    category: "MARKETING",
    rejectedReason: null,
    qualityScore: null,
    parameterFormat: "POSITIONAL",
    contractHash: `h-${name}`,
    syncedAt: "2026-10-20T00:00:00.000Z",
    slots: [slot],
    previews: [],
    savedValues: {},
    components: [{ type: "BODY", text: corpo }],
  });
  const opcoes = [tpl("boas_vindas", "Oi {{1}}, tudo bem?"), tpl("retorno", "Olá {{1}}, voltamos!")].map((m) => ({
    modelo: m,
    avaliacao: avaliarModeloParaCampanha(m.slots, m.savedValues),
  }));

  beforeEach(() => {
    canais.data = [{ id: "s-oficial", provider: CHANNEL_PROVIDER_META, display_name: "Oficial" }];
    carga.campanha = {
      ...CAMPANHA,
      channel_session_id: "s-oficial",
      message_body: null,
      message_mode: "template",
      template_name: "boas_vindas",
      template_language: "pt_BR",
      template_contract_hash: "h-boas_vindas",
      template_slot_map: { "1": "{{primeiro_nome}}" },
    };
    modelo.fn = (escolhido) => {
      const atual = opcoes.find((o) => o.modelo.name === escolhido?.name) ?? null;
      return { carregando: false, opcoes, atual, desatualizado: false, preencher: atual ? [slot] : null };
    };
    previa.data = { ...previa.dados(), exemplo: { "1": "Ana" } };
    previa.reset.mockClear();
  });

  it("editar a variável depois da prévia tira o valor resolvido antigo", async () => {
    render(<EditarCampanha id="c1" />);
    expect(await screen.findByText("Oi Ana, tudo bem?")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/\{\{1\}\}/), { target: { value: "{{nome}}" } });
    expect(previa.reset).toHaveBeenCalled();
    expect(screen.queryByText("Oi Ana, tudo bem?")).not.toBeInTheDocument();
    expect(screen.getByText("Oi {{nome}}, tudo bem?")).toBeInTheDocument();
    expect(screen.getByText(/clique em “Ver quantas pessoas”/)).toBeInTheDocument();
  });

  it("trocar de template depois da prévia não leva valores antigos", async () => {
    render(<EditarCampanha id="c1" />);
    expect(await screen.findByText("Oi Ana, tudo bem?")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Template aprovado pela Meta"), { target: { value: "retorno|pt_BR" } });
    expect(screen.queryByText(/Ana/)).not.toBeInTheDocument();
    expect(screen.getByText("Olá {{1}}, voltamos!")).toBeInTheDocument();
  });
});
