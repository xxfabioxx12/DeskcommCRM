"use client";
/**
 * Os templates aprovados da CONTA que o passo "Mensagem" pode usar — o fluxo não
 * tem número (roda no número de cada conversa). Um por nome+idioma: a mesma
 * definição espelhada em dois números não vira duas opções. Quem confere o
 * número da conversa é o worker (`mensagem-do-passo-envio.ts`).
 */
import { useMemo } from "react";

import { estadoDoModeloEscolhido, type ModeloDaCampanha } from "@/hooks/campanhas/useModeloDaCampanha";
import { useTemplates, type TemplateView } from "@/hooks/channels/useTemplates";
import type { ModeloEscolhido } from "@/lib/campanhas/template-da-campanha";
import { chaveDoModelo } from "@/lib/followup/mensagem-do-passo";
import { isStatusSendable } from "@/lib/channels/meta/template-binding";

export function umPorNomeEIdioma(templates: readonly TemplateView[]): TemplateView[] {
  const vistos = new Set<string>();
  const saida: TemplateView[] = [];
  for (const m of templates) {
    if (!isStatusSendable(m.status)) continue;
    const chave = chaveDoModelo(m.name, m.language);
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    saida.push(m);
  }
  return saida;
}

export function useModeloDoFluxo(escolhido: ModeloEscolhido | null): ModeloDaCampanha {
  const consulta = useTemplates();
  const templates = consulta.data?.data.templates;
  const lista = useMemo(() => umPorNomeEIdioma(templates ?? []), [templates]);
  return estadoDoModeloEscolhido(lista, escolhido, consulta.isLoading);
}
