/**
 * Entrega a passagem ao destino configurado em Atendimento > Números.
 * Prefere destino padrão; sem ele, usa o único atendente (papel agent) do número.
 * Admin/gerente de retaguarda não torna ambíguo um número com um só atendente.
 * Ter destino não significa estar online: a atribuição cria a caixa de trabalho,
 * sem prometer prazo. Sem destino inequívoco, mantém a fila existente.
 * A porta canônica grava dono, silêncio e evento auditado. O lock + CAS impedem
 * roubar uma conversa assumida ou reabrir uma encerrada durante a operação.
 */
import type { Queryable } from '@/lib/agent-engine/queue/queue';
import { currentExecutionJob, guardServiceEffect } from '@/lib/atendimento/fronteira-server';

export const ATRIBUIR_PASSAGEM_SQL = `
with destino as materialized (
  select c.id, c.organization_id, escolhido.user_id
  from conversations c
  join channel_routing_policies p
    on p.organization_id=c.organization_id and p.channel_session_id=c.channel_session_id
  cross join lateral (
    select (case when p.default_assignee_user_id is not null
      then max(r.user_id::text) filter (where r.user_id=p.default_assignee_user_id)
      when count(*) filter (where u.role='agent')=1
      then max(r.user_id::text) filter (where u.role='agent') end)::uuid as user_id
    from channel_routing_responsibles r
    join user_organizations u
      on u.organization_id=r.organization_id and u.user_id=r.user_id
      and u.revoked_at is null and u.role in ('agent','manager','admin')
    where r.organization_id=p.organization_id and r.policy_id=p.id
  ) escolhido
  where c.organization_id=$1 and c.id=$2 and c.assigned_to_user_id is null
    and c.status in ('open','pending','ai_handling') and not c.is_group
    and escolhido.user_id is not null
    -- Setor explícito tem sua própria régua. Não atravessar essa fronteira.
    and c.sector_id is null
  for no key update of c
)
select assigned.id, assigned.assigned_to_user_id
from destino d
cross join lateral public.fn_conversation_assign(
  d.organization_id, d.id, d.user_id, 'handoff',
  null::uuid, true, $3::uuid, true
) assigned`;

export async function atribuirPassagemAoDestinoDoNumero(
  db: Queryable,
  ids: { tenantId: string; conversationId: string },
): Promise<string | null> {
  await guardServiceEffect();
  const { rows } = await db.query<{ assigned_to_user_id: string }>(
    ATRIBUIR_PASSAGEM_SQL,
    [ids.tenantId, ids.conversationId, currentExecutionJob()?.id ?? null],
  );
  return rows[0]?.assigned_to_user_id ?? null;
}
