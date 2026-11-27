import type { SupabaseClient } from "@supabase/supabase-js";

import { COLUNAS_DO_MODELO, type LinhaDoModelo } from "@/lib/campanhas/conferir-template";

import type { FlowNode } from "./graph-schema";
import { chaveDoModelo } from "./mensagem-do-passo";

const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * As duas tabelas separadas, porque o motor as lê de jeitos diferentes: o
 * `template_id` do passo procura em `message_templates` e depois em
 * `meta_templates`; o `fallback_template_id` do plano B, SÓ em `meta_templates`
 * (`followup-turn.ts`, `resolveModeloAprovado`) — um texto pronto ali nunca sai.
 */
export interface ModelosDaConta {
  prontos: ReadonlySet<string>;
  doCanal: ReadonlySet<string>;
}

/**
 * Os modelos de mensagem que um grafo cita — `template_id` do passo de modelo e
 * `fallback_template_id` do plano B da mensagem por IA —, conferidos no banco.
 *
 * O motor resolve o `template_id` contra `message_templates` e depois
 * `meta_templates` (`followup-turn.ts`); se não acha em nenhuma, o passo lança a
 * cada disparo. O `fallback_template_id` ele procura SÓ em `meta_templates`, e
 * sem achar segue para a IA calado: o plano B morto não lança, só nunca sai.
 * Um fluxo importado de outra conta, ou com o modelo apagado, publicava assim.
 */
export function idsDeModeloCitados(nodes: readonly FlowNode[]): string[] {
  const ids = new Set<string>();
  for (const node of nodes) {
    if (node.type !== "action") continue;
    const cfg = node.config;
    if (cfg.mode === "template" && cfg.template_id) ids.add(cfg.template_id);
    if (cfg.mode === "ai_message" && cfg.fallback_template_id) ids.add(cfg.fallback_template_id);
  }
  return [...ids];
}

/** Dos ids citados, os que existem NESTA organização — texto pronto e modelo do canal, separados. */
export async function carregaModelosCitados(
  client: SupabaseClient,
  orgId: string,
  nodes: readonly FlowNode[],
): Promise<{ ok: true; modelos: ModelosDaConta } | { ok: false; mensagem: string }> {
  // Id que não é uuid não existe em tabela nenhuma — e mandá-lo ao `in` seria
  // erro de sintaxe no Postgres, não "não achei".
  const ids = idsDeModeloCitados(nodes).filter((id) => UUID_RX.test(id));
  if (ids.length === 0) return { ok: true, modelos: { prontos: new Set(), doCanal: new Set() } };

  const [prontos, doCanal] = await Promise.all([
    client.from("message_templates").select("id").eq("organization_id", orgId).in("id", ids),
    client.from("meta_templates").select("id").eq("organization_id", orgId).in("id", ids),
  ]);
  // Erro NÃO vira conjunto vazio: vazio leria como "o modelo foi apagado" e o
  // publish recusaria um fluxo certo.
  const erro = prontos.error ?? doCanal.error;
  if (erro) return { ok: false, mensagem: erro.message };

  const idsDe = (linhas: { id: unknown }[] | null) => new Set((linhas ?? []).map((l) => String(l.id)));
  return { ok: true, modelos: { prontos: idsDe(prontos.data), doCanal: idsDe(doCanal.data) } };
}

/** Parte 1 do motor de fluxo — os templates (nome + idioma) que os passos "Mensagem" citam, sem repetição. */
export function modelosDaMensagemCitados(nodes: readonly FlowNode[]): Array<{ name: string; language: string }> {
  const vistos = new Map<string, { name: string; language: string }>();
  for (const node of nodes) {
    if (node.type !== "action" || node.config.mode !== "mensagem" || !node.config.modelo) continue;
    const { name, language } = node.config.modelo;
    vistos.set(chaveDoModelo(name, language), { name, language });
  }
  return [...vistos.values()];
}

/**
 * As linhas de `meta_templates` da CONTA para cada template citado — a publicação
 * confere na conta (o fluxo não tem número); o worker confere no número da
 * conversa. Erro NÃO vira mapa vazio (leria como "template apagado").
 */
export async function carregaModelosDaMensagem(
  client: SupabaseClient,
  orgId: string,
  nodes: readonly FlowNode[],
): Promise<{ ok: true; modelos: Map<string, LinhaDoModelo[]> } | { ok: false; mensagem: string }> {
  const citados = modelosDaMensagemCitados(nodes);
  const modelos = new Map<string, LinhaDoModelo[]>();
  if (citados.length === 0) return { ok: true, modelos };
  const { data, error } = await client
    .from("meta_templates")
    .select(COLUNAS_DO_MODELO)
    .eq("organization_id", orgId)
    .in("name", [...new Set(citados.map((c) => c.name))]);
  if (error) return { ok: false, mensagem: error.message };
  for (const linha of (data ?? []) as unknown as LinhaDoModelo[]) {
    const chave = chaveDoModelo(linha.name, linha.language);
    modelos.set(chave, [...(modelos.get(chave) ?? []), linha]);
  }
  return { ok: true, modelos };
}
