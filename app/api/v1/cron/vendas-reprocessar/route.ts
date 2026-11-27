/**
 * GET|POST /api/v1/cron/vendas-reprocessar — a cada 5 minutos (fork, Parte 2b).
 *
 * Tenta de novo as vendas que falharam por erro passageiro nas últimas 24 h
 * (5 min, 30 min e 2 h depois; no máximo 3), e devolve à fila a venda cuja
 * decisão parou no meio. A regra da venda roda no máximo uma vez por pedido
 * (`sales_rule_runs`), então reemitir o gatilho é seguro.
 *
 * Auth: `Authorization: Bearer <INTERNAL_CRON_SECRET>` por `autorizaCron`.
 * Trilha (`sales_event.retry_run`) só quando a rodada tentou ou encerrou algo;
 * na falha, log, trilha com `falhou: true`, Sentry e 500 (o `curl -fsS` do
 * scheduler vê).
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { autorizaCron } from "@/lib/auth/cron-auth";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { bancoDaVenda } from "@/lib/vendas/banco";
import { reprocessarPendentes, type ResultadoDaRodada } from "@/lib/vendas/reprocessar";

export const dynamic = "force-dynamic";

async function handle(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  if (!autorizaCron(req)) {
    return fail("forbidden", "Cron secret missing or invalid.", 403, { requestId });
  }

  let rodada: ResultadoDaRodada;
  try {
    rodada = await reprocessarPendentes(bancoDaVenda(createAdminClient()), new Date());
  } catch (err) {
    const detalhe = err instanceof Error ? err.message : String(err);
    logger.error("[vendas-reprocessar] a rodada falhou", { error: detalhe, request_id: requestId });
    void audit({
      action: "sales_event.retry_run",
      organizationId: null,
      bypassedRls: true,
      metadata: { falhou: true, erro: detalhe.slice(0, 300) },
      requestId,
    });
    avisaSentry(err, requestId);
    return fail("internal_error", "sales_retry_failed", 500, { requestId });
  }

  // Rodada que não tentou nem encerrou nada não é mutação e não audita.
  if (rodada.tentadas + rodada.encerradas > 0) {
    void audit({
      action: "sales_event.retry_run",
      organizationId: null,
      bypassedRls: true,
      metadata: { ...rodada },
      requestId,
    });
  }
  return ok(rodada, { requestId });
}

/** Import dinâmico com `.catch`, como em `webhook-log-retention`: Sentry desligado não vira a 2ª falha. */
function avisaSentry(err: unknown, requestId: string): void {
  const detalhe = err instanceof Error ? err.message : String(err);
  void import("@sentry/nextjs")
    .then((Sentry) => {
      Sentry.captureException(err instanceof Error ? err : new Error(detalhe), {
        level: "error",
        tags: { subsystem: "vendas", cron: "vendas-reprocessar" },
        extra: { request_id: requestId },
      });
    })
    .catch(() => undefined);
}

export async function GET(req: NextRequest): Promise<Response> {
  return handle(req);
}

export async function POST(req: NextRequest): Promise<Response> {
  return handle(req);
}
