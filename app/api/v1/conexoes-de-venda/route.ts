/**
 * GET  /api/v1/conexoes-de-venda — as conexões de venda da empresa ativa (Parte 2).
 * POST /api/v1/conexoes-de-venda — cria uma, sempre "só registrando".
 *
 * O segredo da plataforma (hottok, token da Kiwify, segredo da Kookie, chave da
 * personalizada) vai cifrado (migration 0041) e NUNCA volta: só `has_secret`.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

import { respostaDeRecusa } from "@/lib/api/recusa";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { criarConexaoDeVendaSchema } from "@/lib/vendas/config";
import { MENSAGEM_SEM_CIFRA, criarConexaoDeVenda, listarConexoesDeVenda } from "@/lib/vendas/conexoes";
import { encryptWebhookSecret } from "@/lib/webhooks/secrets";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "webhook_sources" });
  if (!authz.ok) return authz.response;
  try {
    const conexoes = await listarConexoesDeVenda({
      supabase: await createClient(),
      organizationId: authz.org.orgId,
      actor: { type: "user", id: authz.user.id, role: authz.org.role },
      requestId,
    });
    return ok(conexoes, { requestId });
  } catch (err) {
    return respostaDeRecusa(err, requestId);
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "webhook_sources" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  let raw: unknown = {};
  try {
    raw = await req.json();
  } catch {
    raw = {};
  }
  const parsed = criarConexaoDeVendaSchema.safeParse(raw);
  if (!parsed.success) {
    return fail("invalid_request", t("Dados inválidos."), 400, { requestId, details: parsed.error.flatten() });
  }

  let segredo: string | null = null;
  if (parsed.data.secret) {
    segredo = await encryptWebhookSecret(createAdminClient(), parsed.data.secret);
    if (segredo === null) return fail("encryption_unavailable", t(MENSAGEM_SEM_CIFRA), 422, { requestId });
  }

  try {
    const criada = await criarConexaoDeVenda(
      {
        supabase: await createClient(),
        organizationId: authz.org.orgId,
        actor: { type: "user", id: authz.user.id, role: authz.org.role },
        requestId,
      },
      { name: parsed.data.name, kind: parsed.data.kind, secret_encrypted: segredo, config: parsed.data.config ?? {} },
    );
    return ok(criada, { requestId, status: 201 });
  } catch (err) {
    return respostaDeRecusa(err, requestId);
  }
}
