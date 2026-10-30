import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * POST /api/v1/ai/cases/:id/concluir — fork NODZ.
 *
 * "Já vi, já foi respondido": tira o caso da fila SEM mandar mensagem ao
 * cliente. É o botão "Concluído" da tela de Casos. Diferente de
 * `/reply` com `resolved`, aqui não há `case_reply_turn`: nada é enfileirado e
 * a IA não fala com ninguém. A nota é opcional; sem ela, a linha do tempo
 * registra que o caso foi concluído sem mensagem.
 *
 * Aceita os dois estados abertos (`awaiting_human` e `awaiting_lead`). Caso já
 * fechado devolve 409, igual às outras transições: nunca pisa em estado
 * terminal.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { concluirCasoSemMensagem } from "@/lib/agent-engine/agent/human-cases";
import { getRequestPool } from "@/lib/agent-engine/db/request-pool";
import { audit } from "@/lib/audit";
import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { casoForaDoSetor } from "@/lib/inbox/recorte-do-setor";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const bodySchema = z
  .object({
    note: z.string().trim().max(4000).optional(),
  })
  .strict();

export async function POST(req: NextRequest, { params }: RouteParams): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "agent_cases" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const { org, user } = authz;
  const { id: caseId } = await params;
  if (!z.string().uuid().safeParse(caseId).success) {
    return fail("not_found", t("Caso não encontrado."), 404, { requestId });
  }

  let payload: unknown = {};
  try {
    const raw = await req.text();
    if (raw.trim()) payload = JSON.parse(raw);
  } catch {
    return fail("invalid_request", t("Body inválido."), 400, { requestId });
  }
  const parsed = bodySchema.safeParse(payload);
  if (!parsed.success) {
    return fail("validation_failed", t("Body inválido."), 422, {
      requestId,
      details: parsed.error.flatten(),
    });
  }

  // Cópia NODZ: caso de outro setor responde como se não existisse.
  if (await casoForaDoSetor(createAdminClient(), org.orgId, user.id, caseId)) {
    return fail("not_found", t("Caso não encontrado."), 404, { requestId });
  }

  let pool;
  try {
    pool = getRequestPool();
  } catch {
    return fail("unavailable", t("Conclusão do caso indisponível (config)."), 503, { requestId });
  }

  const { rows } = await pool.query<{ status: string }>(
    `select status from agent_cases where organization_id = $1 and id = $2`,
    [org.orgId, caseId],
  );
  if (rows[0] === undefined) {
    return fail("not_found", t("Caso não encontrado."), 404, { requestId });
  }

  const concluido = await concluirCasoSemMensagem(pool, org.orgId, caseId, user.id, parsed.data.note ?? null);
  if (!concluido) {
    return fail("invalid_state", t("Este caso já foi fechado."), 409, { requestId });
  }

  await audit({
    action: "ai.case_replied",
    actorUserId: user.id,
    organizationId: org.orgId,
    resourceType: "agent_case",
    resourceId: caseId,
    requestId,
    metadata: { case_action: "concluido_sem_mensagem", from_status: rows[0].status },
  });

  return ok({ status: "resolved" }, { requestId });
}
