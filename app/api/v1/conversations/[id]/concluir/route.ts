import { z } from "zod";
import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * POST /api/v1/conversations/[id]/concluir — fork NODZ, o botão "Concluir" do Inbox.
 *
 * "Já foi resolvido": numa ação só, fecha a conversa (mesmo caminho do Fechar,
 * `fn_service_status` → closed) e fecha TODOS os casos abertos dela
 * (→ resolved). Nenhuma mensagem é enviada ao cliente: nada é enfileirado.
 *
 * Conversa e casos são concluídos na mesma transação, com revisão e dono
 * conferidos sob lock; qualquer falha desfaz os dois. Conversa já encerrada não é reaberta nem refechada: só os casos
 * abertos dela são concluídos — é o caso de quem fechou pelo Fechar antigo e o
 * caso ficou preso. Repetir o clique é inofensivo.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { getRequestPool } from "@/lib/agent-engine/db/request-pool";
import { audit } from "@/lib/audit";
import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { ApiError } from "@/lib/api/types";
import { exigirControleDaConversa } from "@/lib/inbox/controle-da-conversa";
import { concluirAtendimento } from "@/lib/inbox/concluir-atendimento";
import { createClient } from "@/lib/supabase/server";
import { traduzir } from "@/lib/i18n/dicionario";
import { exigirConversaDoSetor } from "@/lib/inbox/recorte-do-setor";

export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string }>;
}


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
  if (!z.string().uuid().safeParse(id).success) return fail("validation_failed", "Identificador inválido.", 422, { requestId });

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
    .select("id, organization_id, assigned_to_user_id, service_revision, status").eq("id", id)
    .eq("organization_id", authz.org.orgId).maybeSingle();
  if (readError) return fail("internal_error", readError.message, 500, { requestId });
  if (!visible) return fail("not_found", t("Conversa não encontrada."), 404, { requestId });

  try {
    await exigirControleDaConversa(supabase, {
      organization_id: authz.org.orgId, actor: { type: "user", id: user.id }, requestId,
      idioma: user.idioma,
    }, visible);
  } catch (erro) {
    if (erro instanceof ApiError) return fail(erro.code, erro.message, erro.status, { requestId });
    throw erro;
  }

  let resultado;
  try {
    resultado = await concluirAtendimento(getRequestPool(), {
      organizationId: authz.org.orgId, conversationId: id, actorUserId: user.id,
      expectedRevision: parsed.data.expected_revision ?? visible.service_revision,
      expectedAssignee: visible.assigned_to_user_id,
    });
  } catch (erro) {
    const codigo = (erro as { code?: string }).code;
    if (codigo === "PT409" || codigo === "40001") {
      return fail("conflict", t("O atendimento mudou. Atualize e tente novamente."), 409, { requestId });
    }
    return fail("internal_error", t("Não foi possível concluir o atendimento. Tente novamente."), 500, { requestId });
  }
  const { conversation_closed: conversaFechada, cases_resolved: casosConcluidos } = resultado;

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
