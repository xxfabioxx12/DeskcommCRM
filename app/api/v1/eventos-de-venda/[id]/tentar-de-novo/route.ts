/**
 * POST /api/v1/eventos-de-venda/[id]/tentar-de-novo — o botão "Tentar de novo" (Parte 2b).
 *
 * Só manager, só venda da própria empresa (a organização vem do login, nunca do
 * corpo). Zera a contagem e tenta na hora, pelo mesmo caminho do cron
 * (`tentarDeNovo`), com a configuração atual da conexão.
 * Aceita `falhou` e `recebido` com o prazo vencido (travada, F8); recusa o resto e a que
 * já teve os dados limpos (30 dias ou anonimização).
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { bancoDaVenda } from "@/lib/vendas/banco";
import { MOTIVO_DA_VENDA } from "@/lib/vendas/receber";
import { tentarDeNovo } from "@/lib/vendas/reprocessar";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function POST(_req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "webhook_sources" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) {
    return fail("invalid_request", t("Dados inválidos."), 400, { requestId });
  }

  const banco = bancoDaVenda(createAdminClient());
  const agora = new Date();
  try {
    const pega = await banco.prenderPeloBotao(authz.org.orgId, id, agora);
    if (pega === "nao_achou") return fail("not_found", t("Venda não encontrada."), 404, { requestId });
    if (pega === "nao_falhou") {
      return fail("conflict", t("Só dá para tentar de novo uma venda que falhou."), 409, { requestId });
    }
    if (pega === "sem_dados") {
      return fail("conflict", t("Os dados desta venda já foram apagados: não há o que tentar de novo."), 409, { requestId });
    }
    void audit({
      action: "sales_event.retry_requested",
      actorUserId: authz.user.id,
      organizationId: authz.org.orgId,
      resourceType: "sales_event",
      resourceId: id,
      requestId,
    });
    const fim = await tentarDeNovo(banco, pega, agora);
    // Só frase fixa do sistema: motivo vindo de erro de banco nunca sai na resposta.
    const motivo = (Object.values(MOTIVO_DA_VENDA) as string[]).includes(fim.motivo ?? "") ? fim.motivo : null;
    return ok({ status: fim.status, motivo }, { requestId });
  } catch (err) {
    logger.error("[vendas] não foi possível tentar a venda de novo", {
      salesEventId: id,
      organizationId: authz.org.orgId,
      error: err instanceof Error ? err.message : String(err),
      requestId,
    });
    return fail("internal_error", "internal_error", 500, { requestId });
  }
}
