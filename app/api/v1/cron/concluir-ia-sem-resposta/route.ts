/**
 * GET/POST /api/v1/cron/concluir-ia-sem-resposta — conclui o atendimento do
 * suporte em que a IA falou por último e o cliente não respondeu no prazo
 * (fork NODZ). A regra mora em `lib/inbox/concluir-ia-sem-resposta.ts`.
 *
 * Fecha pela MESMA função do botão Concluir (`fn_service_status(..., 'closed')`),
 * sem mensagem ao cliente. Cada conversa é relida travada antes de fechar: se o
 * cliente escreveu nesse meio-tempo, a regra deixa de valer e ela fica aberta.
 * Se o cliente voltar depois, o inbound reabre a conversa (`fn_service_inbound`).
 *
 * Organização sem `settings.concluir_ia_sem_resposta_minutos`: nada acontece.
 * Audita SÓ quando fechou algo (`tests/unit/cron-audita-so-quando-ha-efeito.test.ts`).
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { getRequestPool } from "@/lib/agent-engine/db/request-pool";
import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { autorizaCron } from "@/lib/auth/cron-auth";
import { deveConcluir, lerConversasParadas } from "@/lib/inbox/concluir-ia-sem-resposta";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/** Teto de conversas lidas por rodada; o que sobrar entra na próxima. */
const SCAN_LIMIT = 500;

async function handle(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  if (!autorizaCron(req)) {
    return fail("forbidden", "Cron secret missing or invalid.", 403, { requestId });
  }

  const pool = getRequestPool();
  let examinadas = 0;
  let concluidas = 0;
  let falhas = 0;
  try {
    const candidatas = await lerConversasParadas(pool, { limite: SCAN_LIMIT });
    examinadas = candidatas.length;
    for (const c of candidatas.filter((c) => deveConcluir(c, Date.now()))) {
      const db = await pool.connect();
      try {
        await db.query("BEGIN");
        const [atual] = await lerConversasParadas(db, { conversationId: c.id, limite: 1 });
        if (atual && deveConcluir(atual, Date.now())) {
          await db.query("select public.fn_service_status($1::uuid,$2::uuid,'closed',$3::bigint)", [
            atual.organizationId,
            atual.id,
            atual.revisao,
          ]);
          await db.query("COMMIT");
          concluidas++;
          await audit({
            action: "conversation.closed",
            organizationId: atual.organizationId,
            resourceType: "conversation",
            resourceId: atual.id,
            bypassedRls: true,
            requestId,
            metadata: { via: "ia_sem_resposta", minutos: atual.minutos },
          });
        } else {
          await db.query("ROLLBACK");
        }
      } catch (err) {
        await db.query("ROLLBACK").catch(() => {});
        falhas++;
        logger.error("[concluir-ia-sem-resposta] não fechou", {
          conversation_id: c.id,
          error: err instanceof Error ? err.message : String(err),
          requestId,
        });
      } finally {
        db.release();
      }
    }
  } catch (err) {
    logger.error("[concluir-ia-sem-resposta] varredura falhou", {
      error: err instanceof Error ? err.message : String(err),
      requestId,
    });
    return fail("internal_error", "Failed to scan conversations.", 500, { requestId });
  }

  return ok({ examinadas, concluidas, falhas }, { requestId });
}

export async function GET(req: NextRequest): Promise<Response> {
  return handle(req);
}

export async function POST(req: NextRequest): Promise<Response> {
  return handle(req);
}
