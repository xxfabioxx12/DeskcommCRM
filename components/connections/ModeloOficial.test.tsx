/**
 * CRIAR, EDITAR E APAGAR TEMPLATE DO CANAL OFICIAL PELA TELA.
 *
 * Só texto, só Marketing e Utilidade; o exemplo de cada variável aparece no
 * instante em que o `{{n}}` é digitado (sem ele a revisão recusa); e apagar
 * mostra ONDE o template está em uso antes de confirmar.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ mutateAsync: vi.fn() }));

vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (chave: string) => chave }));
vi.mock("@/hooks/channels/useModeloOficial", () => ({
  useGerirModeloOficial: () => ({ mutateAsync: h.mutateAsync, isPending: false }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { toast } from "sonner";

import { ApiError } from "@/lib/api/types";

import { AcoesDoModeloOficial, FormularioDoModeloOficial } from "./ModeloOficial";

beforeEach(() => {
  h.mutateAsync.mockReset().mockResolvedValue({ data: { acao: "criar", status: "PENDING" } });
  vi.mocked(toast.error).mockReset();
});

describe("FormularioDoModeloOficial", () => {
  it("só oferece Marketing e Utilidade", () => {
    render(<FormularioDoModeloOficial editando={null} onFechar={vi.fn()} />);
    const opcoes = [...(screen.getByLabelText("Categoria") as HTMLSelectElement).options].map((o) => o.value);
    expect(opcoes).toEqual(["MARKETING", "UTILITY"]);
    expect((screen.getByLabelText("Idioma") as HTMLSelectElement).value).toBe("pt_BR");
  });

  it("o exemplo aparece com a variável, e o envio leva o formulário inteiro", async () => {
    const onFechar = vi.fn();
    render(<FormularioDoModeloOficial editando={null} onFechar={onFechar} />);
    fireEvent.change(screen.getByLabelText("Nome do modelo"), { target: { value: "pedido_chegou" } });
    fireEvent.change(screen.getByLabelText("Conteúdo"), { target: { value: "Oi {{1}}, seu pedido chegou." } });
    const enviar = screen.getByRole("button", { name: "Enviar para revisão" });
    expect(enviar).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Exemplo do valor 1"), { target: { value: "Ana" } });
    expect(enviar).toBeEnabled();
    fireEvent.click(enviar);
    await vi.waitFor(() =>
      expect(h.mutateAsync).toHaveBeenCalledWith({
        acao: "criar",
        name: "pedido_chegou",
        language: "pt_BR",
        category: "MARKETING",
        cabecalho: "",
        corpo: "Oi {{1}}, seu pedido chegou.",
        exemplos: ["Ana"],
        rodape: "",
        respostasRapidas: [],
      }),
    );
    await vi.waitFor(() => expect(onFechar).toHaveBeenCalled());
  });

  it("nome fora do formato avisa e não deixa enviar", () => {
    render(<FormularioDoModeloOficial editando={null} onFechar={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Nome do modelo"), { target: { value: "Pedido Novo" } });
    fireEvent.change(screen.getByLabelText("Conteúdo"), { target: { value: "Seu pedido chegou." } });
    expect(screen.getByText("Use só letras minúsculas, números e _ no nome.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enviar para revisão" })).toBeDisabled();
  });

  it("recusa da Meta mostra a nossa leitura e o texto original dela", async () => {
    h.mutateAsync.mockRejectedValueOnce(
      new ApiError(502, "upstream_error", { originalDaMeta: "Invalid parameter (#100)" }, "req-2", "O texto tem um problema."),
    );
    const onFechar = vi.fn();
    render(<FormularioDoModeloOficial editando={null} onFechar={onFechar} />);
    fireEvent.change(screen.getByLabelText("Nome do modelo"), { target: { value: "aviso" } });
    fireEvent.change(screen.getByLabelText("Conteúdo"), { target: { value: "Seu pedido chegou." } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar para revisão" }));
    await vi.waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("O texto tem um problema. (Meta: Invalid parameter (#100))"),
    );
    expect(onFechar).not.toHaveBeenCalled();
  });

  it("recusa sem frase conhecida mostra só o texto da Meta", async () => {
    h.mutateAsync.mockRejectedValueOnce(new ApiError(502, "upstream_error", undefined, "req-3", "Texto cru da Meta"));
    render(<FormularioDoModeloOficial editando={null} onFechar={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Nome do modelo"), { target: { value: "aviso" } });
    fireEvent.change(screen.getByLabelText("Conteúdo"), { target: { value: "Seu pedido chegou." } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar para revisão" }));
    await vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith("Texto cru da Meta"));
  });

  it("editar vem preenchido, trava o nome e manda editar", async () => {
    render(
      <FormularioDoModeloOficial
        editando={{
          name: "pedido_chegou",
          language: "pt_BR",
          components: [{ type: "BODY", text: "Oi {{1}}, chegou.", example: { body_text: [["Ana"]] } }],
        }}
        onFechar={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Nome do modelo")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Salvar e enviar para revisão" }));
    await vi.waitFor(() =>
      expect(h.mutateAsync).toHaveBeenCalledWith({
        acao: "editar",
        name: "pedido_chegou",
        language: "pt_BR",
        cabecalho: "",
        corpo: "Oi {{1}}, chegou.",
        exemplos: ["Ana"],
        rodape: "",
        respostasRapidas: [],
      }),
    );
  });
});

describe("AcoesDoModeloOficial", () => {
  const MODELO = { name: "pedido_chegou", language: "pt_BR", components: [{ type: "BODY", text: "Oi, chegou." }] };

  it("apagar em uso mostra onde e pede a segunda confirmação", async () => {
    h.mutateAsync
      .mockRejectedValueOnce(new ApiError(409, "template_in_use", { usos: ["Follow-up «Boas-vindas»"] }, "req-1", "em uso"))
      .mockResolvedValueOnce({ data: { acao: "apagar" } });
    render(<AcoesDoModeloOficial modelo={MODELO} onEditar={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Apagar" }));
    const botoes = await screen.findAllByRole("button", { name: "Apagar" });
    fireEvent.click(botoes[botoes.length - 1]!);
    expect(await screen.findByText("Follow-up «Boas-vindas»")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Apagar assim mesmo" }));
    await vi.waitFor(() =>
      expect(h.mutateAsync).toHaveBeenLastCalledWith({ acao: "apagar", name: "pedido_chegou", language: "pt_BR", confirmado: true }),
    );
  });

  it("template com imagem no cabeçalho não oferece Editar", () => {
    render(
      <AcoesDoModeloOficial
        modelo={{ ...MODELO, components: [{ type: "HEADER", format: "IMAGE" }, { type: "BODY", text: "Oi" }] }}
        onEditar={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: "Editar" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apagar" })).toBeInTheDocument();
  });
});
