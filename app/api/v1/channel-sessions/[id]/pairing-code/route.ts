import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { requireRole } from "@/lib/auth/require-role";
import { mfaEmDivida } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ehAdminDaInstalacao, podeReligarNumero } from "@/lib/inbox/recorte-do-setor";
import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import {
  PairingCodeError,
  pairingPhoneSchema,
  requestChannelPairingCode,
} from "@/lib/channels/pairing-code";
import { traduzir } from "@/lib/i18n/dicionario";

export const dynamic = "force-dynamic";
const input = z.object({ phone_number: pairingPhoneSchema }).strict();

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const headers = { "Cache-Control": "no-store, max-age=0" };
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  // Cópia NODZ: o atendente pareia os números do setor dele (ver o reconectar).
  const authz = await requireRole("agent", {
    requestId,
    resource: "channel_sessions",
    allowPlatformAdmin: true,
  });
  if (!authz.ok) return authz.response;
  if (await mfaEmDivida())
    return fail("mfa_required", "Confirme a verificação em duas etapas.", 403, {
      requestId,
      headers,
    });
  const t = (text: string) => traduzir(text, authz.user.idioma);
  const path = z.object({ id: z.string().uuid() }).safeParse(await params);
  const body = input.safeParse(await req.json().catch(() => null));
  if (!path.success || !body.success)
    return fail(
      "validation_error",
      t("Informe o telefone completo com código do país e DDD."),
      400,
      { requestId, headers },
    );
  const ehAdmin = authz.org.role === "admin" || ehAdminDaInstalacao(authz.user);
  if (!ehAdmin) {
    let pode = false;
    try {
      pode = await podeReligarNumero(createAdminClient(), authz.org.orgId, authz.user.id, path.data.id);
    } catch {
      return fail("internal_error", t("Não foi possível conferir o setor deste número."), 503, { requestId, headers });
    }
    if (!pode) return fail("forbidden_role", t("Este número é de outro setor."), 403, { requestId, headers });
  }
  try {
    const result = await requestChannelPairingCode(
      ehAdmin ? await createClient() : createAdminClient(),
      authz.org.orgId,
      path.data.id,
      body.data.phone_number,
    );
    void audit({
      action: "channel.pairing_code_requested",
      actorUserId: authz.user.id,
      organizationId: authz.org.orgId,
      resourceType: "channel_session",
      resourceId: path.data.id,
      requestId,
    });
    return ok(result, { requestId, headers });
  } catch (error) {
    if (error instanceof PairingCodeError)
      return fail(error.code, t(error.message), error.status, {
        requestId,
        headers: { ...headers, ...(error.status === 429 ? { "Retry-After": "30" } : {}) },
      });
    return fail(
      "pairing_unavailable",
      t("Não foi possível gerar o código. Tente novamente."),
      502,
      { requestId, headers },
    );
  }
}
