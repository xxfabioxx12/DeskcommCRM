/** O que cada plataforma recebe e devolve na identificação da entrega. Servidor (node:crypto). */
import { createHash } from "node:crypto";

import type { ConfigDaConexao } from "../config";

export interface EntregaDaVenda {
  payload: Record<string, unknown>;
  /** O corpo CRU, como chegou — base do sha256 quando a plataforma não manda id. */
  corpo: string;
  cabecalho: (nome: string) => string | null;
  config: ConfigDaConexao;
}

export interface Identificacao {
  /** Chave de repetido: id do evento da plataforma ou sha256 do corpo (único por conexão). */
  chave: string;
  eventoOriginal: string;
  teste: boolean;
}

export const sha256 = (texto: string): string => createHash("sha256").update(texto).digest("hex");
export const sha1 = (texto: string): string => createHash("sha1").update(texto).digest("hex");

/** Tradução por mapa fixo, sem cair no protótipo (`MAPA["constructor"]`). */
export function doMapa(mapa: Readonly<Record<string, string>>, chave: string | null | undefined): string | null {
  return chave && Object.hasOwn(mapa, chave) ? (mapa[chave] ?? null) : null;
}
