import * as React from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

beforeAll(() => {
  const proto = window.HTMLElement.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture ??= () => false;
  proto.setPointerCapture ??= () => undefined;
  proto.releasePointerCapture ??= () => undefined;
  proto.scrollIntoView ??= () => undefined;
});

const h = vi.hoisted(() => ({
  conexoes: [] as unknown[],
  eventos: [] as unknown[],
  filtros: [] as unknown[],
  criar: vi.fn(async () => ({ data: {} })),
  atualizar: vi.fn(async () => ({ data: {} })),
  canais: [] as Array<{ id: string; display_name: string }>,
}));

vi.mock("@/hooks/vendas/useConexoesDeVenda", () => ({
  useConexoesDeVenda: () => ({ data: { data: h.conexoes }, isLoading: false }),
  useCriarConexaoDeVenda: () => ({ mutateAsync: h.criar, isPending: false }),
  useAtualizarConexaoDeVenda: () => ({ mutateAsync: h.atualizar, isPending: false }),
}));
vi.mock("@/hooks/vendas/useEventosDeVenda", () => ({
  useEventosDeVenda: (filtro: unknown) => {
    h.filtros.push(filtro);
    return { data: { data: h.eventos }, isLoading: false };
  },
  useProdutosDaVenda: () => ({ data: { data: [] } }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/hooks/channels/useChannelSessions", () => ({
  useChannelSessions: () => ({ data: h.canais }),
  channelLabel: (c: { display_name: string }) => c.display_name,
}));

import { enderecoDaConexao } from "@/app/app/webhooks/_components/ConexaoDeVendaDialog";
import { VendasTab } from "@/app/app/webhooks/_components/VendasTab";

const HOTMART = {
  id: "c1",
  organization_id: "org-1",
  name: "Hotmart NODZ",
  kind: "hotmart",
  path_token: "tok123",
  config: { telefone_regiao: "BR" },
  is_active: true,
  last_received_at: null,
  has_secret: true,
  created_at: "2026-10-21T15:00:00Z",
  updated_at: "2026-10-21T15:00:00Z",
};

const montar = () => {
  const user = userEvent.setup({ delay: null });
  render(<VendasTab />);
  return user;
};

beforeEach(() => {
  h.conexoes = [];
  h.eventos = [];
  h.filtros.length = 0;
  h.criar.mockClear();
  h.atualizar.mockClear();
  h.canais = [];
});

describe("aba Vendas — conexões", () => {
  it("lista a conexão com estado, plataforma e endereço; o segredo não aparece", () => {
    h.conexoes = [HOTMART];
    montar();
    expect(screen.getByText("Hotmart NODZ")).toBeInTheDocument();
    expect(screen.getByText("Só registrando")).toBeInTheDocument();
    expect(screen.getByText("Hotmart")).toBeInTheDocument();
    expect(enderecoDaConexao("tok123")).toMatch(/\/api\/v1\/webhooks\/vendas\/tok123$/);
    expect(screen.getByText(enderecoDaConexao("tok123"))).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/secret/i);
  });

  it("criar Hotmart: nome, plataforma, segredo e região — sem ligar", async () => {
    const user = montar();
    await user.click(screen.getByRole("button", { name: /Nova conexão/ }));
    await user.type(screen.getByLabelText("Nome"), "Hotmart NODZ");
    await user.type(screen.getByLabelText("Hottok da Hotmart"), "hottok-123");
    await user.click(screen.getByRole("button", { name: "Criar conexão" }));
    expect(h.criar).toHaveBeenCalledWith({
      name: "Hotmart NODZ",
      kind: "hotmart",
      secret: "hottok-123",
      config: { telefone_regiao: "BR" },
    });
  });

  it("editar e ligar: manda dispara e não manda segredo em branco", async () => {
    h.conexoes = [HOTMART];
    const user = montar();
    await user.click(screen.getByText("Hotmart NODZ"));
    expect(screen.getByLabelText("Hottok da Hotmart")).toHaveAttribute("placeholder", "Deixe em branco para manter o segredo salvo");
    await user.click(screen.getByRole("switch", { name: "Ligada" }));
    await user.click(screen.getByRole("button", { name: "Salvar" }));
    expect(h.atualizar).toHaveBeenCalledWith({ id: "c1", name: "Hotmart NODZ", config: { telefone_regiao: "BR", dispara: true } });
  });

  it("personalizada: validação e mapa de campos vão na config", async () => {
    const user = montar();
    await user.click(screen.getByRole("button", { name: /Nova conexão/ }));
    await user.click(screen.getByRole("combobox", { name: "Plataforma" }));
    await user.click(await screen.findByRole("option", { name: "Personalizada" }));
    await user.type(screen.getByLabelText("Nome"), "Flix");
    await user.type(screen.getByLabelText("Caminho do evento"), "event");
    fireEvent.change(screen.getByLabelText("Tradução dos eventos (um por linha: valor=evento)"), {
      target: { value: "student.access_granted=acesso.criado" },
    });
    await user.type(screen.getByLabelText("Caminho do e-mail"), "data.student.email");
    await user.click(screen.getByRole("button", { name: "Criar conexão" }));
    expect(h.criar).toHaveBeenCalledWith({
      name: "Flix",
      kind: "personalizada",
      secret: null,
      config: {
        telefone_regiao: "BR",
        seguranca: { modo: "nenhuma" },
        mapa: { evento: { path: "event", map: { "student.access_granted": "acesso.criado" } }, email: "data.student.email" },
      },
    });
  });
});

describe("aba Vendas — números de saída (spec §4)", () => {
  it("marcar números vai na config; sem nenhum, a chave nem vai", async () => {
    h.canais = [
      { id: "s1", display_name: "Suporte 1" },
      { id: "s2", display_name: "Suporte 2" },
    ];
    const user = montar();
    await user.click(screen.getByRole("button", { name: /Nova conexão/ }));
    expect(screen.getByText("Números que podem falar com quem chega por aqui")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Nome"), "Kiwify NODZ");
    await user.click(screen.getByRole("combobox", { name: "Plataforma" }));
    await user.click(await screen.findByRole("option", { name: "Kiwify" }));
    await user.type(screen.getByLabelText("Token de assinatura da Kiwify"), "token-123");
    await user.click(screen.getByLabelText("Suporte 2"));
    await user.click(screen.getByRole("button", { name: "Criar conexão" }));
    expect(h.criar).toHaveBeenCalledWith({
      name: "Kiwify NODZ",
      kind: "kiwify",
      secret: "token-123",
      config: { telefone_regiao: "BR", numeros_de_saida: ["s2"] },
    });
  });

  it("editar mostra os marcados e desmarcar tudo tira a lista", async () => {
    h.canais = [{ id: "s1", display_name: "Suporte 1" }];
    h.conexoes = [{ ...HOTMART, config: { telefone_regiao: "BR", numeros_de_saida: ["s1"] } }];
    const user = montar();
    await user.click(screen.getByText("Hotmart NODZ"));
    const caixa = screen.getByLabelText("Suporte 1");
    expect(caixa).toBeChecked();
    await user.click(caixa);
    await user.click(screen.getByRole("button", { name: "Salvar" }));
    expect(h.atualizar).toHaveBeenCalledWith({ id: "c1", name: "Hotmart NODZ", config: { telefone_regiao: "BR", dispara: false } });
  });
});

describe("aba Vendas — eventos", () => {
  it("mostra evento, situação, motivo e filtra pela situação", async () => {
    h.conexoes = [HOTMART];
    h.eventos = [
      {
        id: "e1", webhook_source_id: "c1", plataforma: "hotmart", evento_original: "PURCHASE_APPROVED", evento: "compra.aprovada",
        pedido: "HP0001", produto_id: "4455", produto: "Curso Hotmart", contact_id: "x", status: "processado", motivo: null,
        recebido_em: "2026-10-21T15:00:00Z", teste: false, order_bump: false,
      },
      {
        id: "e2", webhook_source_id: "c1", plataforma: "hotmart", evento_original: "lesson.completed", evento: "custom.lesson_completed",
        pedido: null, produto_id: null, produto: null, contact_id: null, status: "ignorado", motivo: "conexão só registrando",
        recebido_em: "2026-10-21T15:01:00Z", teste: false, order_bump: false,
      },
    ];
    const user = montar();
    expect(screen.getByText("Compra aprovada")).toBeInTheDocument();
    expect(screen.getByText("Processado")).toBeInTheDocument();
    expect(screen.getByText("custom.lesson_completed")).toBeInTheDocument();
    expect(screen.getByText("conexão só registrando")).toBeInTheDocument();
    expect(screen.getByText("HP0001")).toBeInTheDocument();
    await user.click(screen.getByRole("combobox", { name: "Situação" }));
    await user.click(await screen.findByRole("option", { name: "Falhou" }));
    expect(h.filtros.at(-1)).toEqual({ conexao_id: undefined, status: "falhou" });
  });
});
