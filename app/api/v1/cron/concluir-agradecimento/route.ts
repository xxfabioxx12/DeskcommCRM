/**
 * GET|POST /api/v1/cron/concluir-agradecimento — a cada 30 minutos (fork NODZ).
 *
 * Conclui a conversa em que o cliente só agradeceu depois de uma resposta, parada
 * há 2 h, quando o Jev confirma (ver `lib/inbox/concluir-agradecimento.ts`). A chave é a
 * credencial OpenRouter da organização (Provedores de IA); sem ela, a organização fica de
 * fora. Uma conversa com problema não para as outras.
 *
 * Auth: `Authorization: Bearer <INTERNAL_CRON_SECRET>` por `autorizaCron`.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { getRequestPool } from "@/lib/agent-engine/db/request-pool";
import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { autorizaCron } from "@/lib/auth/cron-auth";
import { loadCredential } from "@/lib/ai/credentials";
import {
  anotar,
  buscarCandidatas,
  concluirCasosPeloSistema,
  marcarConferida,
  perguntarAoJev,
} from "@/lib/inbox/concluir-agradecimento";
import { logger } from "@/lib/logger";
import { idsDeOrgsParadas } from "@/lib/organizacao/operante";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

async function handle(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  if (!autorizaCron(req)) return fail("forbidden", "Cron secret missing or invalid.", 403, { requestId });

  const db = getRequestPool();
  // Organização parada não tem conversa mexida pelo sistema.
  const paradas = new Set(await idsDeOrgsParadas(createAdminClient()));
  const candidatas = (await buscarCandidatas(db, new Date())).filter((c) => !paradas.has(c.organization_id));
  const chaves = new Map<string, string | null>();
  let concluidas = 0;
  for (const c of candidatas) {
    try {
      if (!chaves.has(c.organization_id)) chaves.set(c.organization_id, await chaveDoJev(c.organization_id));
      const chave = chaves.get(c.organization_id);
      if (!chave) continue;
      const agradeceu = await perguntarAoJev(c, chave);
      // Pergunta respondida: não volta a perguntar pela mesma mensagem.
      await marcarConferida(db, c);
      if (!agradeceu) continue;
      const { error } = await createAdminClient().rpc("fn_service_status", {
        p_org: c.organization_id, p_conversation: c.id, p_status: "closed", p_expected: c.service_revision,
      });
      // Conflito de revisão: alguém mexeu na conversa agora; a próxima rodada vê a mensagem nova.
      if (!error) {
        const casos = await concluirCasosPeloSistema(db, c);
        await anotar(db, c);
        concluidas += 1;
        void audit({
          action: "conversation.closed",
          organizationId: c.organization_id,
          bypassedRls: true,
          resourceType: "conversation",
          resourceId: c.id,
          requestId,
          metadata: { via: "concluir-agradecimento", casos_concluidos: casos },
        });
      }
    } catch (erro) {
      logger.error("[concluir-agradecimento] falhou numa conversa", {
        conversation_id: c.id,
        erro: erro instanceof Error ? erro.message : String(erro),
      });
    }
  }
  return ok({ conferidas: candidatas.length, concluidas }, { requestId });
}

/** A credencial OpenRouter ativa e validada mais recente da organização. */
async function chaveDoJev(organizationId: string): Promise<string | null> {
  const { data } = await createAdminClient()
    .from("ai_provider_credentials")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("provider", "openrouter")
    .eq("is_active", true)
    .not("validated_at", "is", null)
    .order("validated_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string }>();
  if (!data) return process.env.OPENROUTER_API_KEY || null;
  return (await loadCredential(data.id, organizationId)).apiKey;
}

export const GET = handle;
export const POST = handle;
