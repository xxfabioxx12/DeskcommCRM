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

import { CHANNEL_PROVIDER_META } from "@/lib/channels/capabilities";

import { EditarCampanha } from "./_client";

const previa = vi.hoisted(() => ({
  isPending: false,
  mutate: vi.fn(),
  data: {
    total: 20_001,
    elegiveis: 500,
    excluidos: 0,
    motivos: {} as Record<string, number>,
    truncado: false,
    amostra: [] as Array<{ nome: string | null; motivo: string | null }>,
    legenda: {} as Record<string, string>,
  },
}));

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
const modelo = vi.hoisted(() => ({ preencher: null as Array<Record<string, string>> | null }));
vi.mock("@/hooks/campanhas/useModeloDaCampanha", () => ({
  useModeloDaCampanha: () => ({ carregando: false, opcoes: [], atual: null, desatualizado: false, preencher: modelo.preencher }),
}));

const AVISO = /bateu o teto de 20\.000 negócios desta prévia/;

describe("prévia da edição de campanha: o aviso do teto de 20.000", () => {
  beforeEach(() => {
    previa.data.truncado = false;
    previa.isPending = false;
    canais.data = [];
    carga.campanha = null;
    modelo.preencher = null;
  });

  it("recorte truncado: a edição mostra o aviso", async () => {
    previa.data.truncado = true;
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
