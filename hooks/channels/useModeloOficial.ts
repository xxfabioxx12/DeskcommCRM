"use client";
/**
 * Criar, editar e apagar template do canal oficial pela tela (Etapa B).
 *
 * A mesma rota do espelho (`/api/v1/channels/templates`), com `acao`. Invalida a
 * lista desta tela, o seletor da janela fechada no inbox e a lista do construtor
 * de follow-up — os três leem o mesmo espelho.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";
import type { ConteudoDoFormulario } from "@/lib/channels/criacao-de-modelo";

export type AcaoDoModeloOficial =
  | ({ acao: "criar"; name: string; language: string; category: "MARKETING" | "UTILITY" } & ConteudoDoFormulario)
  | ({ acao: "editar"; name: string; language: string } & ConteudoDoFormulario)
  | { acao: "apagar"; name: string; language: string; confirmado: boolean };

export function useGerirModeloOficial() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (corpo: AcaoDoModeloOficial) =>
      apiClient.post<{ data: { acao: string; status?: string } }>("/api/v1/channels/templates", corpo),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["channel-templates"] });
      void qc.invalidateQueries({ queryKey: ["templates-da-conversa"] });
      void qc.invalidateQueries({ queryKey: ["followup-modelos-aprovados"] });
    },
  });
}
