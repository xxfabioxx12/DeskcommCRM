import type { Pool } from "pg";
import { concluirCasosDaConversa } from "@/lib/agent-engine/agent/human-cases";

const TERMINAIS = new Set(["closed", "resolved", "archived"]);

/** Conclusão explícita pelo atendente; sem mensagem; o fechamento segue os efeitos oficiais de fn_service_status. */
export async function concluirAtendimento(pool: Pick<Pool, "connect">, args: {
  organizationId: string; conversationId: string; actorUserId: string;
  expectedRevision: number; expectedAssignee: string | null;
}) {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const { rows } = await db.query<{
      status: string; service_revision: number | string; assigned_to_user_id: string | null;
    }>(`select status, service_revision, assigned_to_user_id from conversations
        where organization_id=$1 and id=$2 for update`, [args.organizationId, args.conversationId]);
    const row = rows[0];
    if (!row || Number(row.service_revision) !== args.expectedRevision ||
        row.assigned_to_user_id !== args.expectedAssignee) {
      throw Object.assign(new Error("Atendimento alterado"), { code: "PT409" });
    }
    const fechar = !TERMINAIS.has(row.status);
    if (fechar) {
      await db.query("select public.fn_service_status($1::uuid,$2::uuid,'closed',$3::bigint)",
        [args.organizationId, args.conversationId, args.expectedRevision]);
    }
    const casos = await concluirCasosDaConversa(db, args.organizationId, args.conversationId, args.actorUserId);
    await db.query("COMMIT");
    return { conversation_closed: fechar, cases_resolved: casos };
  } catch (erro) {
    await db.query("ROLLBACK");
    throw erro;
  } finally {
    db.release();
  }
}
