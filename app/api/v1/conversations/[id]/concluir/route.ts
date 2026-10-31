import { z } from "zod";
import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * POST /api/v1/conversations/[id]/concluir — fork NODZ, o botão "Concluir" do Inbox.
 *
 * "Já foi resolvido": numa ação só, fecha a conversa (mesmo caminho do Fechar,
 * `fn_service_status` → closed) e fecha TODOS os casos abertos dela
 * (→ resolved). Nenhuma mensagem é enviada ao cliente: nada é enfileirado.
 *
 * Ordem: primeiro a conversa (pode dar 409 de revisão, e aí nada mudou), depois
 * os casos. Conversa já encerrada não é reaberta nem refechada: só os casos
 * abertos dela são concluídos — é o caso de quem fechou pelo Fechar antigo e o
 * caso ficou preso. Repetir o clique é inofensivo.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { concluirCasosDaConversa } from "@/lib/agent-engine/agent/human-cases";
import { getRequestPool } from "@/lib/agent-engine/db/request-pool";
import { audit } from "@/lib/audit";
import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { traduzir } from "@/lib/i18n/dicionario";
import { exigirConversaDoSetor } from "@/lib/inbox/recorte-do-setor";

export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

const TERMINAIS = new Set(["closed", "resolved", "archived"]);

export async function POST(req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  let body: unknown = {};
  const text = await req.text();
  try { body = text ? JSON.parse(text) : {}; } catch { return fail("validation_failed", "Corpo inválido.", 422, { requestId }); }
  const parsed = z.object({ expected_revision: z.number().int().positive().optional() }).strict().safeParse(body);
  if (!parsed.success) return fail("validation_failed", "Corpo inválido.", 422, { requestId });
  const { id } = await ctx.params;

  const authz = await requireRole("agent", { requestId, resource: "conversations" });
  if (!authz.ok) return authz.response;
  // Cópia NODZ: conversa de outro setor responde como se não existisse.
  const foraDoSetor = await exigirConversaDoSetor({
    organizationId: authz.org.orgId,
    userId: authz.user.id,
    conversationId: id,
    requestId,
    papel: authz.org.role,
    idioma: authz.user.idioma,
  });
  if (foraDoSetor) return foraDoSetor;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const user = authz.user;

  // Leitura pela SESSÃO: a RLS decide se esta pessoa enxerga a conversa.
  const supabase = await createClient();
  const { data: visible, error: readError } = await supabase.from("conversations")
    .select("id, organization_id, service_revision, status").eq("id", id)
    .eq("organization_id", authz.org.orgId).maybeSingle();
  if (readError) return fail("internal_error", readError.message, 500, { requestId });
  if (!visible) return fail("not_found", t("Conversa não encontrada."), 404, { requestId });

  let conversaFechada = false;
  if (!TERMINAIS.has(String(visible.status))) {
    const { error } = await createAdminClient().rpc("fn_service_status", {
      p_org: visible.organization_id, p_conversation: id, p_status: "closed",
      p_expected: parsed.data.expected_revision ?? visible.service_revision,
    });
    const conflito = error?.code === "PT409" || error?.code === "40001";
    if (error) return fail(conflito ? "conflict" : "internal_error",
      conflito ? t("O atendimento mudou. Atualize e tente novamente.") : error.message,
      conflito ? 409 : 500, { requestId });
    conversaFechada = true;
  }

  const casosConcluidos = await concluirCasosDaConversa(getRequestPool(), authz.org.orgId, id, user.id);

  await audit({
    action: "conversation.closed",
    actorUserId: user.id,
    organizationId: authz.org.orgId,
    resourceType: "conversation",
    resourceId: id,
    requestId,
    metadata: { via: "concluir", conversa_fechada: conversaFechada, casos_concluidos: casosConcluidos },
  });

  return ok({ conversation_closed: conversaFechada, cases_resolved: casosConcluidos }, { requestId });
}
