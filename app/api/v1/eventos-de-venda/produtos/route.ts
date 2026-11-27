/** GET /api/v1/eventos-de-venda/produtos?conexao_id= — os produtos que já chegaram (o seletor da regra de venda). */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { z } from "zod";

import { respostaDeRecusa } from "@/lib/api/recusa";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { createClient } from "@/lib/supabase/server";
import { listarProdutosDaVenda } from "@/lib/vendas/conexoes";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "webhook_sources" });
  if (!authz.ok) return authz.response;
  const conexao = z.string().uuid().optional().safeParse(new URL(req.url).searchParams.get("conexao_id") ?? undefined);
  if (!conexao.success) return fail("invalid_request", traduzir("Dados inválidos.", authz.user.idioma), 400, { requestId });
  try {
    const produtos = await listarProdutosDaVenda(
      {
        supabase: await createClient(),
        organizationId: authz.org.orgId,
        actor: { type: "user", id: authz.user.id, role: authz.org.role },
        requestId,
      },
      conexao.data,
    );
    return ok(produtos, { requestId });
  } catch (err) {
    return respostaDeRecusa(err, requestId);
  }
}
