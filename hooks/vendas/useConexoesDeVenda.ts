"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { apiClient } from "@/lib/api/client";
import type { ConfigDaConexao } from "@/lib/vendas/config";
import type { ConexaoDeVendaVisivel } from "@/lib/vendas/conexoes";
import type { PlataformaDeVenda } from "@/lib/vendas/eventos";

export type ConexaoDeVendaRow = ConexaoDeVendaVisivel;

const CHAVE = ["conexoes-de-venda"];

export function useConexoesDeVenda() {
  return useQuery({
    queryKey: CHAVE,
    queryFn: async () => apiClient.get<{ data: ConexaoDeVendaRow[] }>("/api/v1/conexoes-de-venda"),
    staleTime: 15_000,
  });
}

/** `gcTime: 0`: o segredo viaja nas `variables` da mutação e não pode ficar no cache (mesma razão de `useUpdateWebhookSource`). */
export function useCriarConexaoDeVenda() {
  const qc = useQueryClient();
  return useMutation({
    gcTime: 0,
    mutationFn: async (input: { name: string; kind: PlataformaDeVenda; secret: string | null; config: ConfigDaConexao }) =>
      apiClient.post<{ data: ConexaoDeVendaRow }>("/api/v1/conexoes-de-venda", input),
    onError: showApiError,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: CHAVE });
    },
  });
}

export function useAtualizarConexaoDeVenda() {
  const qc = useQueryClient();
  return useMutation({
    gcTime: 0,
    mutationFn: async ({ id, ...patch }: { id: string; name?: string; secret?: string | null; config?: ConfigDaConexao }) =>
      apiClient.patch<{ data: ConexaoDeVendaRow }>(`/api/v1/conexoes-de-venda/${id}`, patch),
    onError: showApiError,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: CHAVE });
    },
  });
}
