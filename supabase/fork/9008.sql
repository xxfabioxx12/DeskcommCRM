-- ---- fechar a conversa fecha o caso (migration 9008, fork) ----
-- Pedido do Fabio (26/10/2026): "clico em Fechar e ele não sai de Casos". O
-- Fechar/Arquivar do Inbox só mexia na conversa; o caso dela ficava esperando a
-- equipe para sempre. Agora, quando a conversa vira terminal (closed, resolved
-- ou archived), os casos ABERTOS dela vão para `resolved`, com evento de sistema
-- na linha do tempo. NENHUMA mensagem é enviada: não há case_reply_turn aqui.
-- O trg_agent_case_closed já existente emite ai.case_closed, que cancela os
-- follow-ups e avisos do caso. Reabrir a conversa NÃO reabre o caso.
-- Desfazer: drop trigger trg_fork_conversa_fechada_fecha_caso on public.conversations.
-- Idempotente: create or replace + drop trigger if exists.
create or replace function public.fn_fork_conversa_fechada_fecha_caso()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  with fechados as (
    update public.agent_cases
       set status = 'resolved', closed_at = now(), updated_at = now()
     where organization_id = new.organization_id
       and conversation_id = new.id
       and status in ('awaiting_human','awaiting_lead')
    returning id
  )
  insert into public.agent_case_events (organization_id, case_id, kind, actor_kind, body, metadata)
  select new.organization_id, id, 'resolved', 'system',
         case new.status when 'archived' then 'Conversa arquivada no Inbox. Nenhuma mensagem foi enviada ao cliente.'
                         else 'Conversa fechada no Inbox. Nenhuma mensagem foi enviada ao cliente.' end,
         jsonb_build_object('source', 'conversa_fechada', 'conversation_status', new.status)
    from fechados;
  return null;
end;
$$;

alter function public.fn_fork_conversa_fechada_fecha_caso() owner to postgres;
revoke all     on function public.fn_fork_conversa_fechada_fecha_caso() from public;
revoke execute on function public.fn_fork_conversa_fechada_fecha_caso() from anon, authenticated;

drop trigger if exists trg_fork_conversa_fechada_fecha_caso on public.conversations;
create trigger trg_fork_conversa_fechada_fecha_caso
  after update of status on public.conversations
  for each row
  when (new.status in ('closed','resolved','archived')
        and old.status is distinct from new.status)
  execute function public.fn_fork_conversa_fechada_fecha_caso();
