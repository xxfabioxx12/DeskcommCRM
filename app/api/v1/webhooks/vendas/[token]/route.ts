/**
 * POST /api/v1/webhooks/vendas/[token] — entrada das vendas (Parte 2 da migração
 * do ManyChat): Hotmart, Kiwify, Kookie e conexão personalizada.
 *
 * O `path_token` resolve a conexão (fonte confiável — nunca o corpo); só conexão
 * de VENDA responde aqui (a captação segue em `/webhooks/in/[token]`). A
 * assinatura é a da plataforma (`lib/vendas/assinatura.ts`); repetido, teste,
 * tradução, contato e gatilho são `receberVenda`. GET/HEAD respondem 200 no
 * mesmo endereço (a Kiwify sonda antes de salvar o webhook).
 */
import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";
import { fail } from "@/lib/api/wrappers";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { conferirAssinatura } from "@/lib/vendas/assinatura";
import { bancoDaVenda } from "@/lib/vendas/banco";
import { configDaConexao, segurancaSchema } from "@/lib/vendas/config";
import { PLATAFORMAS_DE_VENDA, ehPlataformaDeVenda } from "@/lib/vendas/eventos";
import { receberVenda, type ConexaoDeVenda } from "@/lib/vendas/receber";
import { decryptWebhookSecret } from "@/lib/webhooks/secrets";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteCtx {
  params: Promise<{ token: string }>;
}

/** `*WebhookController::MAX_BODY_BYTES` do integrador. */
const LIMITE_DO_CORPO = 512 * 1024;
/** Por conexão (Divergência D14). */
const POR_MINUTO = 300;

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ status: "ok" });
}

export async function HEAD(): Promise<NextResponse> {
  return new NextResponse(null, { status: 200 });
}

function objetoJson(corpo: string): Record<string, unknown> | null {
  try {
    const valor: unknown = corpo ? JSON.parse(corpo) : null;
    return valor && typeof valor === "object" && !Array.isArray(valor) ? (valor as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** `\u0000` em chave ou texto: o jsonb do Postgres recusa (22P05) e a reentrega viraria 500 eterno. */
function temNulo(v: unknown): boolean {
  if (typeof v === "string") return v.includes("\0");
  if (!v || typeof v !== "object") return false;
  return Object.entries(v).some(([k, x]) => k.includes("\0") || temNulo(x));
}

export async function POST(req: NextRequest, ctx: RouteCtx): Promise<NextResponse> {
  const requestId = randomUUID();
  const { token } = await ctx.params;
  if (!token || token.length < 8) return fail("not_found", "unknown webhook token", 404, { requestId });

  const limite = await checkRateLimit(`webhook_vendas:${token}`, POR_MINUTO, 60);
  if (!limite.allowed) {
    return fail("rate_limited", "Too many requests.", 429, { requestId, headers: { "Retry-After": "60" } });
  }

  const admin = createAdminClient();
  const { data: fonte, error } = await admin
    .from("webhook_sources")
    .select("id, organization_id, kind, config, secret_encrypted, is_active")
    .eq("path_token", token)
    .in("kind", [...PLATAFORMAS_DE_VENDA])
    .maybeSingle();
  if (error) {
    logger.error("[webhooks.vendas] não foi possível ler a conexão", { requestId, error: error.message });
    return fail("internal_error", "internal_error", 500, { requestId });
  }
  if (!fonte || !fonte.is_active || !ehPlataformaDeVenda(fonte.kind)) {
    return fail("not_found", "unknown webhook token", 404, { requestId });
  }

  // O cabeçalho poupa a leitura; o tamanho LIDO é a régua (transferência em pedaços não declara).
  if (Number(req.headers.get("content-length") ?? 0) > LIMITE_DO_CORPO) {
    return fail("payload_too_large", "payload too large", 413, { requestId });
  }
  const corpo = await req.text();
  if (Buffer.byteLength(corpo, "utf8") > LIMITE_DO_CORPO) {
    return fail("payload_too_large", "payload too large", 413, { requestId });
  }

  const conexao: ConexaoDeVenda = {
    id: fonte.id as string,
    organizationId: fonte.organization_id as string,
    plataforma: fonte.kind,
    config: configDaConexao(fonte.config),
  };
  const banco = bancoDaVenda(admin);
  // Segredo que não decifra = não dá para conferir = recusa (falha fechada, como a captação).
  const segredo = fonte.secret_encrypted ? await decryptWebhookSecret(admin, String(fonte.secret_encrypted)) : null;
  const payload = objetoJson(corpo);
  const url = new URL(req.url);
  const cabecalho = (nome: string) => req.headers.get(nome);

  // Segredo gravado com segurança que não se lê: sem ela a personalizada cairia em "nenhuma".
  const seguranca = (fonte.config as { seguranca?: unknown } | null)?.seguranca;
  const ilegivel = !!fonte.secret_encrypted && seguranca != null && !segurancaSchema.safeParse(seguranca).success;
  const recusa = ilegivel
    ? "configuração de segurança ilegível"
    : conferirAssinatura(
        conexao.plataforma,
        { corpo, payload, cabecalho, query: (nome) => url.searchParams.get(nome), segredo, agora: new Date() },
        conexao.config,
      );
  if (recusa) {
    await banco.registrarRecusa(conexao, recusa);
    logger.warn("[webhooks.vendas] assinatura recusada", {
      webhookSourceId: conexao.id,
      organizationId: conexao.organizationId,
      motivo: recusa,
      requestId,
    });
    return fail("unauthenticated", "invalid_signature", 401, { requestId });
  }
  if (!payload) return fail("invalid_request", "invalid_json", 400, { requestId });
  if (temNulo(payload)) return fail("invalid_request", "corpo com caractere nulo", 400, { requestId });

  try {
    const r = await receberVenda(banco, conexao, { payload, corpo, cabecalho, config: conexao.config });
    return NextResponse.json(r.duplicate ? { received: true, duplicate: true } : { received: true });
  } catch (err) {
    logger.error("[webhooks.vendas] não foi possível registrar a venda", {
      webhookSourceId: conexao.id,
      organizationId: conexao.organizationId,
      error: err instanceof Error ? err.message : String(err),
      requestId,
    });
    return fail("internal_error", "sale_not_recorded", 500, { requestId });
  }
}
