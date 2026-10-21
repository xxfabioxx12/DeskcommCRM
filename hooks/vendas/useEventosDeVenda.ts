"use client";
import { useQuery } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";
import type { EventoDeVendaVisivel } from "@/lib/vendas/conexoes";

export type EventoDeVendaRow = EventoDeVendaVisivel;

export function useEventosDeVenda(filtro: { conexao_id?: string; status?: string }) {
  const qs = new URLSearchParams(
    Object.entries(filtro).filter((par): par is [string, string] => typeof par[1] === "string" && par[1] !== ""),
  ).toString();
  return useQuery({
    queryKey: ["eventos-de-venda", filtro.conexao_id ?? "", filtro.status ?? ""],
    queryFn: async () => apiClient.get<{ data: EventoDeVendaRow[] }>(`/api/v1/eventos-de-venda${qs ? `?${qs}` : ""}`),
    refetchInterval: 15_000,
  });
}

export function useProdutosDaVenda(conexaoId: string | null) {
  return useQuery({
    queryKey: ["produtos-da-venda", conexaoId ?? ""],
    queryFn: async () =>
      apiClient.get<{ data: Array<{ produto_id: string; produto: string | null }> }>(
        `/api/v1/eventos-de-venda/produtos${conexaoId ? `?conexao_id=${encodeURIComponent(conexaoId)}` : ""}`,
      ),
    staleTime: 60_000,
  });
}
