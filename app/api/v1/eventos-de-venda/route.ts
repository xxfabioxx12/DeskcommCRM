/** GET /api/v1/eventos-de-venda?conexao_id=&status= — os últimos 100 eventos de venda da empresa (Parte 2). */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

import { respostaDeRecusa } from "@/lib/api/recusa";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { createClient } from "@/lib/supabase/server";
import { filtroDosEventosSchema, listarEventosDeVenda } from "@/lib/vendas/conexoes";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "webhook_sources" });
  if (!authz.ok) return authz.response;
  const url = new URL(req.url);
  const filtro = filtroDosEventosSchema.safeParse({
    conexao_id: url.searchParams.get("conexao_id") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
  });
  if (!filtro.success) return fail("invalid_request", traduzir("Dados inválidos.", authz.user.idioma), 400, { requestId });
  try {
    const eventos = await listarEventosDeVenda(
      {
        supabase: await createClient(),
        organizationId: authz.org.orgId,
        actor: { type: "user", id: authz.user.id, role: authz.org.role },
        requestId,
      },
      filtro.data,
    );
    return ok(eventos, { requestId });
  } catch (err) {
    return respostaDeRecusa(err, requestId);
  }
}
