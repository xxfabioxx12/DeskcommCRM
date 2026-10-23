import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit";
import { fail, ok } from "@/lib/api/wrappers";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { requireRole } from "@/lib/auth/require-role";
import { respondeSozinho } from "@/lib/channels/responde-sozinho";
import { traduzir } from "@/lib/i18n/dicionario";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

const schema = z.object({ ligado: z.boolean() }).strict();

/** "Responder automaticamente por este número" (fork 9005). Nulo = padrão do provedor. */
export async function GET(_req: NextRequest, { params }: Context): Promise<Response> {
  const requestId = randomUUID();
  const auth = await requireRole("admin", { requestId, resource: "channel_sessions", allowPlatformAdmin: "leitura" });
  if (!auth.ok) return auth.response;
  const t = (texto: string) => traduzir(texto, auth.user.idioma);
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return fail("validation_failed", t("Canal inválido."), 422, { requestId });
  const { data, error } = await createAdminClient()
    .from("channel_sessions")
    .select("provider, responde_sozinho")
    .eq("organization_id", auth.org.orgId)
    .eq("id", id)
    .is("archived_at", null)
    .maybeSingle();
  if (error) return fail("internal_error", t("Não foi possível carregar a resposta automática."), 500, { requestId });
  if (!data) return fail("not_found", t("Canal não encontrado."), 404, { requestId });
  return ok({ ligado: respondeSozinho(data.provider as string | null, data.responde_sozinho as boolean | null) }, { requestId });
}

/** Só administradores. Grava o valor EXPLÍCITO: a partir daí o padrão não vale mais. */
export async function PATCH(req: NextRequest, { params }: Context): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const auth = await requireRole("admin", { requestId, resource: "channel_sessions", allowPlatformAdmin: true });
  if (!auth.ok) return auth.response;
  const t = (texto: string) => traduzir(texto, auth.user.idioma);
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return fail("validation_failed", t("Canal inválido."), 422, { requestId });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("validation_failed", t("Informe ligado como verdadeiro ou falso."), 422, { requestId });
  // Uma coluna só: o UPDATE é atômico sem RPC (Divergência D1).
  const { data, error } = await createAdminClient()
    .from("channel_sessions")
    .update({ responde_sozinho: parsed.data.ligado })
    .eq("organization_id", auth.org.orgId)
    .eq("id", id)
    .is("archived_at", null)
    .select("id");
  if (error) return fail("internal_error", t("Não foi possível salvar a resposta automática."), 500, { requestId });
  if (!data || data.length === 0) return fail("not_found", t("Canal não encontrado."), 404, { requestId });
  void audit({
    action: "channel.auto_reply_updated",
    actorUserId: auth.user.id,
    organizationId: auth.org.orgId,
    resourceType: "channel_session",
    resourceId: id,
    requestId,
    metadata: { ligado: parsed.data.ligado },
  });
  return ok(parsed.data, { requestId });
}
