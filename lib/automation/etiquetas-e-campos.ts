/**
 * ETIQUETAS E CAMPOS — as regras e a escrita que a regra de automação e o fluxo
 * dividem (Parte 1 do motor de fluxo).
 *
 * - O DESTINO (`card` | `contato`) tem a mesma semântica da `add_tag` (#2498):
 *   `card` é o card mais recente do contexto; `contato` é o contato DO card (ou o
 *   do contexto, sem card). Ver Divergência D1 do plano para quando o card falta.
 * - Etiqueta de CONTATO sai normalizada (`normalizarTags`) e etiqueta maior que
 *   40 é recusada, nunca cortada. Etiqueta de CARD continua como sempre.
 * - A escrita é UMA RPC atômica por chamada (migration 9002 e 0502): nada de
 *   montar a lista ou o objeto inteiro no app — é isso que perdia a escrita de
 *   uma automação concorrente.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { TAMANHO_MAXIMO_DA_TAG, normalizarTags } from "@/lib/contacts/tag-normalizada";

export const DESTINOS_DA_ESCRITA = ["card", "contato"] as const;
export type DestinoDaEscrita = (typeof DESTINOS_DA_ESCRITA)[number];

/** Config sem a chave (regra antiga) = `card`, o comportamento de sempre. */
export function destinoDe(valor: unknown): DestinoDaEscrita {
  return valor === "contato" ? "contato" : "card";
}

/** Literal de propósito (o guarda de i18n lê a chave); o teste confere que o 40 é o teto real. */
export const MENSAGEM_ETIQUETA_LONGA_DO_CONTATO = "Etiqueta do contato com mais de 40 caracteres: encurte." as const;

export function etiquetaLongaDoContato(tags: readonly string[]): string | null {
  return tags.find((t) => t.trim().length > TAMANHO_MAXIMO_DA_TAG) ?? null;
}

/** As etiquetas como o destino as guarda. Contato: normalizadas; card: aparadas e sem repetida. */
export function etiquetasDoDestino(cruas: readonly string[], destino: DestinoDaEscrita): string[] {
  if (destino === "contato") return normalizarTags(cruas);
  const vistas = new Set<string>();
  const saida: string[] = [];
  for (const crua of cruas) {
    const tag = crua.trim();
    if (tag === "" || vistas.has(tag)) continue;
    vistas.add(tag);
    saida.push(tag);
  }
  return saida;
}

export const MENSAGEM_CAMPO_INVALIDO = "O nome do campo tem de 1 a 60 caracteres, sem ponto." as const;

const NOMES_DE_PROTOTIPO = new Set(["__proto__", "constructor", "prototype"]);

/** 1 a 60 caracteres, sem ponto (o renderizador lê `{{contato.x}}` com UM ponto) e nunca nome de protótipo. */
export function campoValido(campo: string): boolean {
  const c = campo.trim();
  return c.length >= 1 && c.length <= 60 && !c.includes(".") && !NOMES_DE_PROTOTIPO.has(c);
}

export interface AlvoDaEscrita {
  tabela: "contacts" | "crm_leads";
  id: string;
  /** A foto do contexto, quando o alvo é ela mesma — as próximas regras do mesmo evento a enxergam. */
  foto?: { tags?: string[] };
}

export function alvoDaEscrita(
  contexto: Record<string, unknown>,
  destino: DestinoDaEscrita,
  opcoes: { cardSemNegocioUsaContato: boolean },
): AlvoDaEscrita | null {
  const lead = contexto.lead as { id: string; contact_id?: string | null; tags?: string[] } | undefined;
  const contato = contexto.contact as { id: string; tags?: string[] } | undefined;
  if (destino === "contato") {
    const id = lead?.contact_id ?? contato?.id;
    if (!id) return null;
    return contato && contato.id === id ? { tabela: "contacts", id, foto: contato } : { tabela: "contacts", id };
  }
  if (lead) return { tabela: "crm_leads", id: lead.id, foto: lead };
  if (opcoes.cardSemNegocioUsaContato && contato) return { tabela: "contacts", id: contato.id, foto: contato };
  return null;
}

function lista(valor: unknown): string[] {
  return Array.isArray(valor) ? valor.map(String) : [];
}

export type ResultadoDaRemocao =
  | { ok: true; tags: string[]; removidas: string[] }
  | { ok: false; motivo: "sem_linha" }
  | { ok: false; motivo: "erro"; erro: string };

export async function removerEtiquetas(
  admin: SupabaseClient,
  entrada: { organizationId: string; alvo: AlvoDaEscrita; tags: string[] },
): Promise<ResultadoDaRemocao> {
  const doContato = entrada.alvo.tabela === "contacts";
  const { data, error } = await admin.rpc(
    doContato ? "fn_contato_remover_etiquetas" : "fn_lead_remover_etiquetas",
    doContato
      ? { p_org: entrada.organizationId, p_contato: entrada.alvo.id, p_tags: entrada.tags }
      : { p_org: entrada.organizationId, p_lead: entrada.alvo.id, p_tags: entrada.tags },
  );
  if (error) return { ok: false, motivo: "erro", erro: error.message };
  // Nulo = linha inexistente OU de outra organização: nada foi tocado.
  if (data === null || data === undefined) return { ok: false, motivo: "sem_linha" };
  const retorno = data as { tags?: unknown; removidas?: unknown };
  return { ok: true, tags: lista(retorno.tags), removidas: lista(retorno.removidas) };
}

export type ResultadoDoCampo = { ok: true } | { ok: false; motivo: "sem_linha" } | { ok: false; motivo: "erro"; erro: string };

export async function anotarCampo(
  admin: SupabaseClient,
  entrada: { organizationId: string; alvo: AlvoDaEscrita; campo: string; valor: string },
): Promise<ResultadoDoCampo> {
  const campos: Record<string, string> = { [entrada.campo.trim()]: entrada.valor };
  const doContato = entrada.alvo.tabela === "contacts";
  const { data, error } = await admin.rpc(
    doContato ? "fn_contato_anotar_campos" : "fn_lead_anotar_campos",
    doContato
      ? { p_org: entrada.organizationId, p_contato: entrada.alvo.id, p_campos: campos }
      : { p_org: entrada.organizationId, p_lead: entrada.alvo.id, p_campos: campos },
  );
  if (error) return { ok: false, motivo: "erro", erro: error.message };
  if (data === null || data === undefined) return { ok: false, motivo: "sem_linha" };
  return { ok: true };
}
