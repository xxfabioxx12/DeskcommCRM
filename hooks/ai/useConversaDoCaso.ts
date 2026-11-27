"use client";
import { useQuery } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";
import type { Message } from "@/lib/types/messaging";

/**
 * Fork NODZ — o atendimento inteiro dentro da tela de Casos: as últimas 100
 * mensagens da conversa do caso, em ordem cronológica, para ler e decidir sem
 * trocar de tela. Mesma rota do Inbox (mesmas regras de acesso).
 */
export function useConversaDoCaso(conversationId: string | null) {
  return useQuery({
    queryKey: ["case-conversation", conversationId],
    enabled: conversationId !== null,
    refetchInterval: 60_000,
    queryFn: () =>
      apiClient
        .get<{ data: Message[]; meta?: { has_more?: boolean } }>(
          `/api/v1/conversations/${conversationId}/messages?limit=100`,
        )
        .then((r) => ({ mensagens: r.data, temMais: r.meta?.has_more === true })),
  });
}
