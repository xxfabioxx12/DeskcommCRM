// app/app/campaigns/new/_client.test.tsx
/**
 * O AVISO DO TETO NA PRÉVIA (#2402, #2404).
 *
 * `buscarCandidatos` devolve `truncado` quando o recorte bate o teto de 20.000
 * linhas de negócio; a tela é o ÚNICO lugar onde esse recibo vira informação
 * para o operador. Sem este teste o campo viaja do banco até aqui sem ninguém
 * conferir a última ponta — e a prévia volta a cortar calada.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `DEFAULT_CHANNEL_PROVIDER` é o número de QR Code (não exige template), sem escrever o nome dele.
import { CHANNEL_PROVIDER_META, DEFAULT_CHANNEL_PROVIDER } from "@/lib/channels/capabilities";

import { NovaCampanha } from "./_client";

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

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (chave: string) => chave }));
const criar = vi.hoisted(() => ({ mutateAsync: vi.fn(), isPending: false }));
vi.mock("@/hooks/campanhas/useCampanhas", () => ({
  useCriarCampanha: () => criar,
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
vi.mock("@/hooks/campanhas/useModeloDaCampanha", () => ({
  useModeloDaCampanha: () => ({ carregando: false, opcoes: [], atual: null, desatualizado: false, preencher: null }),
}));

const AVISO = /bateu o teto de 20\.000 negócios desta prévia/;

describe("prévia da nova campanha: o aviso do teto de 20.000", () => {
  beforeEach(() => {
    previa.data.truncado = false;
    previa.isPending = false;
    canais.data = [];
  });

  it("recorte truncado: o operador VÊ o aviso na prévia", () => {
    previa.data.truncado = true;
    render(<NovaCampanha />);
    expect(screen.getByText(AVISO)).toBeInTheDocument();
  });

  it("recorte inteiro: nenhum aviso — o campo não vira ruído", () => {
    render(<NovaCampanha />);
    expect(screen.queryByText(AVISO)).not.toBeInTheDocument();
  });
});

describe("número que exige template", () => {
  beforeEach(() => {
    canais.data = [];
  });

  it("esconde o texto livre e mostra a explicação do número oficial", () => {
    canais.data = [{ id: "s-oficial", provider: CHANNEL_PROVIDER_META, display_name: "Oficial" }];
    render(<NovaCampanha />);
    expect(screen.getByLabelText("Texto da mensagem")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Enviar pelo número"), { target: { value: "s-oficial" } });
    expect(screen.queryByLabelText("Texto da mensagem")).not.toBeInTheDocument();
    expect(screen.getByText(/Este número é oficial/)).toBeInTheDocument();
  });

  it("trocar o número principal tira dos extras os números de outro tipo", async () => {
    criar.mutateAsync.mockReset();
    criar.mutateAsync.mockResolvedValue({ id: "c-nova" });
    canais.data = [
      { id: "s-oficial", provider: CHANNEL_PROVIDER_META, display_name: "Oficial" },
      { id: "s-qr-1", provider: DEFAULT_CHANNEL_PROVIDER, display_name: "QR 1" },
      { id: "s-qr-2", provider: DEFAULT_CHANNEL_PROVIDER, display_name: "QR 2" },
    ];
    render(<NovaCampanha />);
    // Sem número principal, todos aparecem como extra: marca o oficial e o QR 2.
    fireEvent.click(screen.getByRole("checkbox", { name: "Oficial" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "QR 2" }));
    fireEvent.change(screen.getByLabelText("Enviar pelo número"), { target: { value: "s-qr-1" } });
    expect(screen.queryByRole("checkbox", { name: "Oficial" })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Nome da campanha"), { target: { value: "Reativação" } });
    fireEvent.change(screen.getByLabelText("Com alguma destas etiquetas"), { target: { value: "vip" } });
    fireEvent.change(screen.getByLabelText("Texto da mensagem"), { target: { value: "Oi {{nome}}" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar rascunho" }));

    expect(criar.mutateAsync).toHaveBeenCalledTimes(1);
    const corpo = criar.mutateAsync.mock.calls[0]![0] as Record<string, unknown>;
    // O oficial marcado antes NÃO vai junto: o servidor recusaria (números misturados).
    expect(corpo.channel_session_ids).toEqual(["s-qr-2"]);
    expect(corpo.message_mode).toBe("text");
    expect(corpo.message_body).toBe("Oi {{nome}}");
  });
});
