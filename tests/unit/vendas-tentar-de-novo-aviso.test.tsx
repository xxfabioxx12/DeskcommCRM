import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({ post: vi.fn(), ok: vi.fn(), erro: vi.fn() }));
vi.mock("@/lib/api/client", () => ({ apiClient: { post: h.post, get: vi.fn() } }));
vi.mock("sonner", () => ({ toast: { success: h.ok, error: h.erro } }));

import { useTentarVendaDeNovo } from "@/hooks/vendas/useEventosDeVenda";

async function tentarCom(status: string, motivo: string | null) {
  h.post.mockResolvedValueOnce({ data: { status, motivo } });
  const cliente = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={cliente}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useTentarVendaDeNovo(), { wrapper });
  await act(async () => result.current.mutate("e1"));
  await waitFor(() => expect(h.ok.mock.calls.length + h.erro.mock.calls.length).toBe(1));
}

beforeEach(() => {
  h.post.mockReset();
  h.ok.mockReset();
  h.erro.mockReset();
});

describe("useTentarVendaDeNovo — o aviso escolhe a frase pelo status", () => {
  it.each([
    ["processado", "A venda foi processada."],
    ["ignorado", "A venda foi reavaliada e ficou ignorada."],
    ["sem_contato", "A venda foi reavaliada, mas não há contato para ela."],
  ])("%s", async (status, frase) => {
    await tentarCom(status, null);
    expect(h.post).toHaveBeenCalledWith("/api/v1/eventos-de-venda/e1/tentar-de-novo", {});
    expect(h.ok).toHaveBeenCalledWith(frase);
    expect(h.erro).not.toHaveBeenCalled();
  });

  it("falhou: aviso de erro com a frase fixa, sem o motivo cru", async () => {
    await tentarCom("falhou", "emit_event: caiu");
    expect(h.erro).toHaveBeenCalledWith("A venda falhou de novo. O motivo está na lista.");
    expect(JSON.stringify([...h.ok.mock.calls, ...h.erro.mock.calls])).not.toContain("emit_event");
  });

  it("outro status: frase genérica com a situação", async () => {
    await tentarCom("recusado", "segredo errado");
    expect(h.ok).toHaveBeenCalledWith("Venda reavaliada: Recusado");
    expect(JSON.stringify(h.ok.mock.calls)).not.toContain("segredo errado");
  });

  it("status desconhecido: frase genérica sem a situação", async () => {
    await tentarCom("inventado", null);
    expect(h.ok).toHaveBeenCalledWith("Venda reavaliada.");
  });
});
