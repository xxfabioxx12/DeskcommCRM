/**
 * Fork NODZ — a tela de Casos com três abas e o "Concluído" que fecha sem
 * mandar mensagem ao cliente.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as UseCasesModule from "@/hooks/ai/useCases";

const useCasesMock = vi.fn();
const useCaseMock = vi.fn();
const concluirMutate = vi.fn();
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("@/hooks/ai/useCases", async () => {
  const actual = await vi.importActual<typeof UseCasesModule>("@/hooks/ai/useCases");
  return {
    ...actual,
    useCases: (...args: unknown[]) => useCasesMock(...args),
    useCase: (...args: unknown[]) => useCaseMock(...args),
    useConcluirCaso: () => ({ mutate: concluirMutate, isPending: false }),
  };
});
vi.mock("@/hooks/ai/useConversaDoCaso", () => ({
  useConversaDoCaso: () => ({
    isLoading: false,
    isError: false,
    data: {
      temMais: false,
      mensagens: [
        { id: "m1", direction: "inbound", sent_via: "external_device", body: "Oi, não recebi o acesso", sent_at: "2026-10-26T12:00:00Z", type: "text", revoked_at: null },
        { id: "m2", direction: "outbound", sent_via: "user", body: "Já liberei, confere aí", sent_at: "2026-10-26T12:05:00Z", type: "text", revoked_at: null },
      ],
    },
  }),
}));
vi.mock("@/app/app/ai/cases/_components/CaseChatPanel", () => ({ CaseChatPanel: () => null }));

import { CaseList } from "@/app/app/ai/cases/_components/CaseList";
import { CaseDetail } from "@/app/app/ai/cases/_components/CaseDetail";

const wrap = (ui: React.ReactNode) => <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>;

const CASO = {
  id: "case-1", title: "Acesso", summary: "Cliente sem acesso", blocker: "Sem permissão", status: "awaiting_human" as const,
  source: "agent" as const, opened_at: "2026-10-26T12:00:00Z", closed_at: null, conversation_id: "conv-1",
  contact_name: "Maria", contact_phone: "+55***", events: [],
};

beforeEach(() => {
  useCasesMock.mockReset();
  useCaseMock.mockReset();
  useCaseMock.mockReturnValue({ isLoading: false, data: undefined });
  concluirMutate.mockReset();
});

describe("Casos — três abas", () => {
  it("mostra só Em contato, Respondidos e Fechados, com contagem", () => {
    useCasesMock.mockReturnValue({ isLoading: false, data: { cases: [], open_count: 3, waiting_count: 2, answered_count: 1 } });
    render(wrap(<CaseList />));
    const abas = screen.getAllByRole("tab").map((el) => el.textContent);
    expect(abas).toEqual(["Em contato (2)", "Respondidos (1)", "Fechados"]);
    expect(useCasesMock).toHaveBeenCalledWith("waiting");
  });

  it("cada aba pede o recorte certo", () => {
    useCasesMock.mockReturnValue({ isLoading: false, data: { cases: [], open_count: 0 } });
    render(wrap(<CaseList />));
    fireEvent.mouseDown(screen.getByRole("tab", { name: /Respondidos/ }), { button: 0, ctrlKey: false });
    expect(useCasesMock).toHaveBeenLastCalledWith("answered");
    fireEvent.mouseDown(screen.getByRole("tab", { name: /Fechados/ }), { button: 0, ctrlKey: false });
    expect(useCasesMock).toHaveBeenLastCalledWith("resolved");
  });
});

describe("Casos — detalhe", () => {
  it("mostra o atendimento inteiro e o botão Concluído", () => {
    useCaseMock.mockReturnValue({ isLoading: false, data: CASO });
    render(wrap(<CaseDetail caseId="case-1" />));
    expect(screen.getByText("Oi, não recebi o acesso")).toBeInTheDocument();
    expect(screen.getByText("Já liberei, confere aí")).toBeInTheDocument();
    expect(screen.getByTestId("concluir-caso")).toHaveTextContent("Concluído");
  });

  it("Concluído confirma e chama a conclusão sem mensagem; avança para o próximo", async () => {
    useCaseMock.mockReturnValue({ isLoading: false, data: CASO });
    concluirMutate.mockImplementation((_vars, opts) => opts.onSuccess());
    const onConcluido = vi.fn();
    render(wrap(<CaseDetail caseId="case-1" onConcluido={onConcluido} />));
    fireEvent.click(screen.getByTestId("concluir-caso"));
    expect(await screen.findByText("Fechar este caso?")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Concluído" }).at(-1)!);
    await waitFor(() => expect(concluirMutate).toHaveBeenCalledWith({ id: "case-1", note: undefined }, expect.anything()));
    expect(onConcluido).toHaveBeenCalledWith("case-1");
  });

  it("caso fechado não mostra o botão Concluído", () => {
    useCaseMock.mockReturnValue({ isLoading: false, data: { ...CASO, status: "resolved" } });
    render(wrap(<CaseDetail caseId="case-1" />));
    expect(screen.queryByTestId("concluir-caso")).toBeNull();
  });

  it("caso respondido (esperando o cliente) também pode ser concluído", () => {
    useCaseMock.mockReturnValue({ isLoading: false, data: { ...CASO, status: "awaiting_lead" } });
    render(wrap(<CaseDetail caseId="case-1" />));
    expect(screen.getByTestId("concluir-caso")).toBeInTheDocument();
  });
});
