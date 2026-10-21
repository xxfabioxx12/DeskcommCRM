/** PATCH /api/v1/conexoes-de-venda/[id] — nome, segredo (`null` apaga) e configuração (estado, região, validação, mapa). */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

import { respostaDeRecusa } from "@/lib/api/recusa";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { atualizarConexaoDeVendaSchema, type ConfigDaConexao } from "@/lib/vendas/config";
import { MENSAGEM_SEM_CIFRA, atualizarConexaoDeVenda } from "@/lib/vendas/conexoes";
import { encryptWebhookSecret } from "@/lib/webhooks/secrets";

export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function PATCH(req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const { id } = await ctx.params;
  const authz = await requireRole("manager", { requestId, resource: "webhook_sources" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  let raw: unknown = {};
  try {
    raw = await req.json();
  } catch {
    raw = {};
  }
  const parsed = atualizarConexaoDeVendaSchema.safeParse(raw);
  if (!parsed.success) {
    return fail("invalid_request", t("Dados inválidos."), 400, { requestId, details: parsed.error.flatten() });
  }

  const patch: { name?: string; secret_encrypted?: string | null; config?: ConfigDaConexao } = {};
  if (parsed.data.name !== undefined) patch.name = parsed.data.name;
  if (parsed.data.config !== undefined) patch.config = parsed.data.config;
  if (parsed.data.secret === null) {
    patch.secret_encrypted = null;
  } else if (parsed.data.secret !== undefined) {
    const cifrado = await encryptWebhookSecret(createAdminClient(), parsed.data.secret);
    if (cifrado === null) return fail("encryption_unavailable", t(MENSAGEM_SEM_CIFRA), 422, { requestId });
    patch.secret_encrypted = cifrado;
  }

  try {
    const atualizada = await atualizarConexaoDeVenda(
      {
        supabase: await createClient(),
        organizationId: authz.org.orgId,
        actor: { type: "user", id: authz.user.id, role: authz.org.role },
        requestId,
      },
      id,
      patch,
    );
    return ok(atualizada, { requestId });
  } catch (err) {
    return respostaDeRecusa(err, requestId);
  }
}
