"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import type { EventoDeVendaVisivel } from "@/lib/vendas/conexoes";
import { ROTULO_DO_STATUS, type StatusDoEventoDeVenda } from "@/lib/vendas/eventos";

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

/** O botão "Tentar de novo" (Parte 2b): tenta na hora, avisa o desfecho e recarrega a lista. */
export function useTentarVendaDeNovo() {
  const qc = useQueryClient();
  const t = useT();
  return useMutation({
    mutationFn: async (salesEventId: string) =>
      apiClient.post<{ data: { status: StatusDoEventoDeVenda; motivo: string | null } }>(
        `/api/v1/eventos-de-venda/${salesEventId}/tentar-de-novo`,
        {},
      ),
    onError: showApiError,
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["eventos-de-venda"] });
      // A frase vem do status; o motivo do servidor nunca vai para o aviso.
      const status = r.data.status;
      if (status === "processado") toast.success(t("A venda foi processada."));
      else if (status === "ignorado") toast.success(t("A venda foi reavaliada e ficou ignorada."));
      else if (status === "sem_contato") toast.success(t("A venda foi reavaliada, mas não há contato para ela."));
      else if (status === "falhou") toast.error(t("A venda falhou de novo. O motivo está na lista."));
      else if (!ROTULO_DO_STATUS[status]) toast.success(t("Venda reavaliada."));
      else toast.success(t("Venda reavaliada: {situacao}").replace("{situacao}", t(ROTULO_DO_STATUS[status])));
    },
  });
}
