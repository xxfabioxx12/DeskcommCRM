/**
 * Assinatura de cada plataforma de venda — porte do integrador:
 *   Hotmart  `HotmartWebhookController.php:36-56` (hottok no cabeçalho, igual ao segredo);
 *   Kiwify   `KiwifySignatureVerifier.php` (HMAC-SHA1 do corpo em `?signature=`, com o
 *            re-serializado — `JSON.stringify` aqui, Divergência D12);
 *   Kookie   `KookieSignatureVerifier.php` (HMAC-SHA256 de `timestamp.corpo`, 15 min);
 *   Personalizada `CustomSignatureVerifier.php` (nenhuma, header_igual, stripe_t_v1).
 *
 * Devolve `null` quando confere, ou o MOTIVO (texto curto, sem segredo nem
 * payload — vai para `sales_events.motivo` e para o log).
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import type { ConfigDaConexao } from "./config";
import type { PlataformaDeVenda } from "./eventos";

export interface EntradaDaAssinatura {
  corpo: string;
  payload: Record<string, unknown> | null;
  cabecalho: (nome: string) => string | null;
  query: (nome: string) => string | null;
  segredo: string | null;
  agora: Date;
}

/** A Kookie reassina a cada tentativa; 15 min cobre a fila atrasada do lado deles. */
export const TOLERANCIA_DA_KOOKIE_MS = 15 * 60_000;

/** `hash_equals` sem vazar tamanho: compara os sha256 dos dois lados. */
function iguais(a: string, b: string): boolean {
  return timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());
}

function hmac(algoritmo: "sha1" | "sha256", segredo: string, dado: string): string {
  return createHmac(algoritmo, segredo).update(dado).digest("hex");
}

export function conferirHotmart(e: EntradaDaAssinatura): string | null {
  if (!e.segredo) return "conexão sem hottok salvo";
  const hottok = e.cabecalho("x-hotmart-hottok");
  if (!hottok) return "cabeçalho X-HOTMART-HOTTOK ausente";
  return iguais(e.segredo, hottok) ? null : "hottok não confere";
}

export function conferirKiwify(e: EntradaDaAssinatura): string | null {
  if (!e.segredo) return "conexão sem chave de assinatura salva";
  const assinatura = e.query("signature");
  if (!assinatura) return "parâmetro signature ausente";
  if (iguais(hmac("sha1", e.segredo, e.corpo), assinatura)) return null;
  if (e.payload && iguais(hmac("sha1", e.segredo, JSON.stringify(e.payload)), assinatura)) return null;
  return "assinatura não confere";
}

export function conferirKookie(e: EntradaDaAssinatura): string | null {
  if (!e.segredo) return "conexão sem segredo salvo";
  const assinatura = e.cabecalho("x-webhook-signature");
  const quando = e.cabecalho("x-webhook-timestamp");
  if (!assinatura || !quando) return "cabeçalho de assinatura ausente";
  const instante = Date.parse(quando);
  if (Number.isNaN(instante)) return "horário da assinatura inválido";
  if (Math.abs(e.agora.getTime() - instante) > TOLERANCIA_DA_KOOKIE_MS) return "assinatura fora da janela de 15 minutos";
  return iguais(hmac("sha256", e.segredo, `${quando}.${e.corpo}`), assinatura) ? null : "assinatura não confere";
}

export function conferirPersonalizada(
  e: EntradaDaAssinatura,
  seguranca: ConfigDaConexao["seguranca"],
): string | null {
  const modo = seguranca?.modo ?? "nenhuma";
  if (modo === "nenhuma") return null;
  if (!e.segredo) return "o modo de validação exige uma chave secreta, mas nenhuma foi salva na conexão";
  const nome = seguranca?.header ?? (modo === "stripe_t_v1" ? "X-Kookie-Signature" : "X-Webhook-Secret");
  const recebido = e.cabecalho(nome);
  if (!recebido) return `cabeçalho ${nome} ausente`;
  if (modo === "header_igual") return iguais(e.segredo, recebido) ? null : `valor do cabeçalho ${nome} não confere`;
  return conferirTV1(recebido, e.corpo, e.segredo, seguranca?.tolerancia_s ?? 300, e.agora);
}

/** "t=<timestamp>,v1=<hex>" (Flix, Stripe). Base = "<t cru>.<corpo>"; vários v1 (rotação): qualquer um vale. */
function conferirTV1(cabecalho: string, corpo: string, segredo: string, toleranciaS: number, agora: Date): string | null {
  let t: string | null = null;
  const assinaturas: string[] = [];
  for (const parte of cabecalho.split(",").map((p) => p.trim())) {
    if (parte.startsWith("t=")) t = parte.slice(2);
    else if (parte.startsWith("v1=")) assinaturas.push(parte.slice(3).toLowerCase());
  }
  if (!t || assinaturas.length === 0) return "assinatura fora do formato t=<timestamp>,v1=<hash>";
  if (!/^\d+$/.test(t)) return "timestamp da assinatura inválido";
  if (toleranciaS > 0 && Math.abs(Math.floor(agora.getTime() / 1000) - Number(t)) > toleranciaS) {
    return `assinatura fora da janela de ${toleranciaS}s`;
  }
  const esperada = hmac("sha256", segredo, `${t}.${corpo}`);
  return assinaturas.some((a) => iguais(esperada, a)) ? null : "assinatura não confere com a chave secreta salva";
}

export function conferirAssinatura(
  plataforma: PlataformaDeVenda,
  e: EntradaDaAssinatura,
  config: ConfigDaConexao,
): string | null {
  switch (plataforma) {
    case "hotmart":
      return conferirHotmart(e);
    case "kiwify":
      return conferirKiwify(e);
    case "kookie":
      return conferirKookie(e);
    case "personalizada":
      return conferirPersonalizada(e, config.seguranca);
  }
}
