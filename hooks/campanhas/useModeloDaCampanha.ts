"use client";
/**
 * Os templates que a campanha pode usar NAQUELE número.
 *
 * Só os aprovados (a mesma régua do envio, `isStatusSendable`), cada um com a
 * avaliação de que a campanha consegue preenchê-lo — a mesma função que o
 * servidor usa para recusar. `desatualizado` = o operador escolheu uma versão
 * do contrato que já não é a de hoje (o template mudou na plataforma).
 */
import { useMemo } from "react";

import { useTemplatesDoNumero, type TemplateView } from "@/hooks/channels/useTemplates";
import { isStatusSendable } from "@/lib/channels/meta/template-binding";
import {
  avaliarModeloParaCampanha,
  type AvaliacaoDoModelo,
  type ModeloEscolhido,
  type SlotDoModelo,
} from "@/lib/campanhas/template-da-campanha";

export interface OpcaoDeModelo {
  modelo: TemplateView;
  avaliacao: AvaliacaoDoModelo;
}

export interface ModeloDaCampanha {
  carregando: boolean;
  opcoes: OpcaoDeModelo[];
  atual: OpcaoDeModelo | null;
  desatualizado: boolean;
  /** Os slots que a campanha preenche. `null` = sem template utilizável e em dia. */
  preencher: SlotDoModelo[] | null;
}

/**
 * O estado da escolha a partir de uma lista de templates — a MESMA conta para a
 * campanha (templates do número) e para o passo "Mensagem" do fluxo (templates
 * da conta, `useModeloDoFluxo`).
 */
export function estadoDoModeloEscolhido(
  templates: readonly TemplateView[],
  escolhido: ModeloEscolhido | null,
  carregando: boolean,
): ModeloDaCampanha {
  const opcoes = templates
    .filter((m) => isStatusSendable(m.status))
    .map((m) => ({ modelo: m, avaliacao: avaliarModeloParaCampanha(m.slots, m.savedValues) }));
  const atual = escolhido
    ? (opcoes.find((o) => o.modelo.name === escolhido.name && o.modelo.language === escolhido.language) ?? null)
    : null;
  const desatualizado = !!atual && !!escolhido && atual.modelo.contractHash !== escolhido.contractHash;
  const preencher = atual && !desatualizado && atual.avaliacao.usavel ? atual.avaliacao.preencher : null;
  return { carregando, opcoes, atual, desatualizado, preencher };
}

export function useModeloDaCampanha(
  channelSessionId: string | null,
  escolhido: ModeloEscolhido | null,
): ModeloDaCampanha {
  const consulta = useTemplatesDoNumero(channelSessionId);
  const templates = consulta.data?.data.templates;
  const carregando = !!channelSessionId && consulta.isLoading;
  return useMemo(
    () => estadoDoModeloEscolhido(templates ?? [], escolhido, carregando),
    // O objeto `escolhido` muda de identidade a cada render; o que importa são os três campos.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [templates, escolhido?.name, escolhido?.language, escolhido?.contractHash, carregando],
  );
}
