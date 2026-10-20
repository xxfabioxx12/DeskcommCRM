/**
 * O link da mídia do modelo se salva na aba de Templates, sem enviar nada.
 *
 * Até aqui a única porta era o painel da janela fechada, que grava o link
 * DEPOIS de um envio: para deixar o modelo pronto, o operador tinha de disparar
 * para um cliente. Os casos abaixo prendem a porta nova: o campo vem com o link
 * salvo, "Salvar link" grava na chave do endereço (`header:1`), e campo vazio
 * esquece o link.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mutateAsync = vi.fn();
const salvos: { valores: Record<string, string> } = { valores: {} };
// Etapa B: o servidor diz se o canal gerencia; o papel vem da sessão.
const tela: { podeGerenciar?: boolean; papel: string; status: string; rejectedReason: string | null } = {
  podeGerenciar: undefined,
  papel: "admin",
  status: "APPROVED",
  rejectedReason: null,
};

vi.mock("@/hooks/channels/useTemplates", () => ({
  useTemplates: () => ({
    isPending: false,
    data: {
      data: {
        waba: "123",
        podeGerenciar: tela.podeGerenciar,
        templates: [
          {
            name: "aviso_debriefing_adv",
            language: "pt_BR",
            status: tela.status,
            category: "UTILITY",
            rejectedReason: tela.rejectedReason,
            qualityScore: null,
            parameterFormat: "POSITIONAL",
            contractHash: "h",
            syncedAt: "2026-09-23T00:00:00Z",
            slots: [{ key: "1", expects: "image", onde: "cabeçalho", valueKey: "header:1" }],
            previews: [],
            savedValues: salvos.valores,
          },
        ],
      },
    },
  }),
  useSyncTemplates: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSaveTemplateValues: () => ({ mutateAsync, isPending: false }),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/hooks/auth/AuthProvider", () => ({
  useAuth: () => ({
    user: { id: "eu", is_platform_admin: false, platform_admin_scope: null, support: null },
    activeOrg: { orgId: "org-1", role: tela.papel },
  }),
}));
vi.mock("@/hooks/channels/useModeloOficial", () => ({
  useGerirModeloOficial: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { TemplatesClient } from "./TemplatesClient";

describe("TemplatesClient — link da mídia salvo no modelo", () => {
  beforeEach(() => {
    mutateAsync.mockReset().mockResolvedValue({ data: { savedValues: {} } });
    salvos.valores = {};
    tela.podeGerenciar = undefined;
    tela.papel = "admin";
    tela.status = "APPROVED";
    tela.rejectedReason = null;
  });

  it("salva o link na chave do endereço, sem enviar nada", async () => {
    render(<TemplatesClient />);
    const campo = screen.getByTestId("template-link-midia");
    const botao = screen.getByTestId("btn-salvar-link");
    expect(botao).toBeDisabled();

    await userEvent.type(campo, "https://exemplo.com/banner.jpg");
    expect(botao).toBeEnabled();
    await userEvent.click(botao);

    expect(mutateAsync).toHaveBeenCalledWith({
      name: "aviso_debriefing_adv",
      language: "pt_BR",
      values: { "header:1": "https://exemplo.com/banner.jpg" },
    });
  });

  it("vem com o link salvo, e campo vazio remove o link", async () => {
    salvos.valores = { "header:1": "https://exemplo.com/antigo.jpg" };
    render(<TemplatesClient />);
    const campo = screen.getByTestId("template-link-midia");
    expect(campo).toHaveValue("https://exemplo.com/antigo.jpg");

    await userEvent.clear(campo);
    const botao = screen.getByTestId("btn-salvar-link");
    expect(botao).toHaveTextContent("Remover link");
    await userEvent.click(botao);

    expect(mutateAsync).toHaveBeenCalledWith({
      name: "aviso_debriefing_adv",
      language: "pt_BR",
      values: { "header:1": "" },
    });
  });

  it("link que não é https: avisa no campo e não deixa salvar", async () => {
    render(<TemplatesClient />);
    await userEvent.type(screen.getByTestId("template-link-midia"), "http://exemplo.com/a.jpg");
    expect(screen.getByTestId("btn-salvar-link")).toBeDisabled();
    expect(screen.getByText(/comece com https/)).toBeInTheDocument();
  });

  it("link trocado por outra porta: o campo acompanha em vez de guardar o velho", () => {
    salvos.valores = { "header:1": "https://exemplo.com/x1.jpg" };
    const { rerender } = render(<TemplatesClient />);
    salvos.valores = { "header:1": "https://exemplo.com/x2.jpg" };
    rerender(<TemplatesClient />);
    expect(screen.getByTestId("template-link-midia")).toHaveValue("https://exemplo.com/x2.jpg");
    expect(screen.getByTestId("btn-salvar-link")).toBeDisabled();
  });
});

describe("TemplatesClient — Etapa B (criar, editar, apagar e status em português)", () => {
  beforeEach(() => {
    salvos.valores = {};
    tela.podeGerenciar = undefined;
    tela.papel = "admin";
    tela.status = "APPROVED";
    tela.rejectedReason = null;
  });

  it("canal que gerencia + administrador: mostra Criar template e Apagar", () => {
    tela.podeGerenciar = true;
    render(<TemplatesClient />);
    expect(screen.getByTestId("btn-criar-template")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apagar" })).toBeInTheDocument();
  });

  it("canal que gerencia, mas quem vê não é administrador: nada de criar, editar ou apagar", () => {
    tela.podeGerenciar = true;
    tela.papel = "agent";
    render(<TemplatesClient />);
    expect(screen.queryByTestId("btn-criar-template")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Apagar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Editar" })).not.toBeInTheDocument();
  });

  it("canal que não gerencia: administrador também não vê os botões", () => {
    tela.podeGerenciar = false;
    render(<TemplatesClient />);
    expect(screen.queryByTestId("btn-criar-template")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Apagar" })).not.toBeInTheDocument();
  });

  it("Criar template abre o formulário", async () => {
    tela.podeGerenciar = true;
    render(<TemplatesClient />);
    await userEvent.click(screen.getByTestId("btn-criar-template"));
    expect(screen.getByLabelText("Nome do modelo")).toBeInTheDocument();
  });

  it("status e motivo da recusa em português", () => {
    tela.status = "REJECTED";
    tela.rejectedReason = "INCORRECT_CATEGORY";
    render(<TemplatesClient />);
    expect(screen.getByText("Recusado")).toBeInTheDocument();
    expect(screen.getByText(/Categoria errada para este texto/)).toBeInTheDocument();
    expect(screen.queryByText("REJECTED")).not.toBeInTheDocument();
  });

  it("status e motivo desconhecidos aparecem como vieram", () => {
    tela.status = "LIMIT_EXCEEDED";
    tela.rejectedReason = "NEW_REASON";
    render(<TemplatesClient />);
    expect(screen.getByText("LIMIT_EXCEEDED")).toBeInTheDocument();
    expect(screen.getByText(/NEW_REASON/)).toBeInTheDocument();
  });
});
