"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { loadAuthUser, resolveActiveOrg, mfaEmDivida } from "@/lib/auth/server";
import { podeAdministrarEmpresa } from "@/lib/auth/pode-administrar-empresa";
import { invalidarOrg } from "@/lib/auth/cache-curto";
import { supportWriteError } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";
import { audit } from "@/lib/audit";

export async function atualizarPainelBarbearia(
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = z.boolean().safeParse(input);
  if (!parsed.success) return { ok: false, error: "validation_failed" };
  const user = await loadAuthUser();
  if (!user) return { ok: false, error: "unauthenticated" };
  if (supportWriteError(user.support)) return { ok: false, error: "forbidden" };
  const org = await resolveActiveOrg(user);
  if (!org || !podeAdministrarEmpresa(user, org)) return { ok: false, error: "forbidden_role" };
  if (await mfaEmDivida()) return { ok: false, error: "mfa_required" };
  const db = createAdminClient();
  const { data, error } = await db
    .from("organizations")
    .select("settings,updated_at")
    .eq("id", org.orgId)
    .maybeSingle();
  if (error || !data) return { ok: false, error: "internal_error" };
  const settings =
    data.settings && typeof data.settings === "object" && !Array.isArray(data.settings)
      ? data.settings
      : {};
  invalidarOrg(org.orgId);
  // Compare-and-swap: nunca sobrescreve uma alteração concorrente em outro bloco de settings.
  const { data: gravada, error: erro } = await db
    .from("organizations")
    .update({ settings: { ...settings, painel_barbearia: parsed.data } })
    .eq("id", org.orgId)
    .eq("updated_at", data.updated_at)
    .select("id")
    .maybeSingle();
  if (erro || !gravada) return { ok: false, error: erro ? "internal_error" : "conflict" };
  invalidarOrg(org.orgId);
  await audit({
    action: "org.updated",
    actorUserId: user.id,
    organizationId: org.orgId,
    resourceType: "organization",
    resourceId: org.orgId,
    metadata: { fields_changed: ["settings.painel_barbearia"], enabled: parsed.data },
  });
  await db.rpc("emit_event", {
    p_event_type: "org.updated",
    p_entity_kind: "organization",
    p_entity_id: org.orgId,
    p_payload: { organization_id: org.orgId },
    p_metadata: { fields_changed: ["settings.painel_barbearia"] },
    p_organization_id: org.orgId,
  });
  revalidatePath("/app", "layout");
  return { ok: true };
}
