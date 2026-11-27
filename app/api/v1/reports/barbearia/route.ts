import { randomUUID } from "node:crypto";
import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { modulosLigados } from "@/lib/instalacao/modulos";
import { painelBarbeariaLigado } from "@/lib/barbearia/config";
import { carregarPainel } from "@/lib/barbearia/carregar";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";
export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "reports" });
  if (!authz.ok) return authz.response;
  const db = await createClient();
  const { data: org, error } = await db
    .from("organizations")
    .select("id,display_name,timezone,currency,settings")
    .eq("id", authz.org.orgId)
    .maybeSingle();
  if (error || !org)
    return fail("internal_error", "Não foi possível consultar a organização.", 500, { requestId });
  if (!painelBarbeariaLigado(org.settings))
    return fail("not_found", "Painel não habilitado para esta organização.", 404, { requestId });
  try {
    const modulos = await modulosLigados(createAdminClient());
    const dados = await carregarPainel(
      db,
      { id: org.id, nome: org.display_name, moeda: org.currency, fuso: org.timezone },
      modulos.includes("financeiro"),
    );
    return ok(dados, { requestId });
  } catch {
    logger.error("[painel-barbearia] falha na leitura completa", {
      organization_id: authz.org.orgId,
      request_id: requestId,
    });
    return fail(
      "internal_error",
      "Não foi possível carregar os dados da barbearia. Tente novamente.",
      500,
      { requestId },
    );
  }
}
