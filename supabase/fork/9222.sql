-- ---- NODZ: passagem humana com Caso (migration 9222) ----
-- manifest: NODZ: encaminhamentos humanos mantêm Caso aberto antes do aviso.
-- Fork NODZ: mesma operação para os dois motores; somente serviço, nunca RPC de navegador.
create or replace function public.fn_nodz_garantir_caso_humano(
 p_org uuid, p_conversa uuid, p_titulo text, p_resumo text
) returns uuid language plpgsql security definer set search_path=public as $$
declare c public.conversations; caso uuid;
begin
 select * into c from public.conversations where id=p_conversa and organization_id=p_org for update;
 if not found then raise exception 'conversation_not_found'; end if;
 if c.status='archived' or exists(select 1 from public.contacts where id=c.contact_id and organization_id=p_org and is_blocked) then return null; end if;
 select id into caso from public.agent_cases where organization_id=p_org and conversation_id=p_conversa
  and status in ('awaiting_human','awaiting_lead') order by opened_at desc limit 1;
 if caso is not null then
  update public.agent_cases set status='awaiting_human' where id=caso and organization_id=p_org and status='awaiting_lead';
  if found then
   insert into public.agent_case_events(organization_id,case_id,kind,actor_kind,body)
    values(p_org,caso,'agent_noted','system','Nova solicitação de atendimento humano; Caso volta a aguardar a equipe.');
  end if;
  return caso;
 end if;
 insert into public.agent_cases(organization_id,conversation_id,title,summary,blocker,source,kind,context_snapshot)
 values(p_org,p_conversa,left(coalesce(nullif(p_titulo,''),'Atendimento encaminhado para uma pessoa'),200),
  left(coalesce(nullif(p_resumo,''),'Revisar o histórico da conversa e dar retorno ao cliente.'),4000),
  'A equipe responsável pelo número precisa revisar e responder este Caso.', 'agent','outro',
  jsonb_build_object('origem','handoff_com_caso')) returning id into caso;
 insert into public.agent_case_events(organization_id,case_id,kind,actor_kind,body)
 values(p_org,caso,'opened','system','Caso registrado automaticamente na passagem para atendimento humano.');
 return caso;
end; $$;
revoke all on function public.fn_nodz_garantir_caso_humano(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.fn_nodz_garantir_caso_humano(uuid,uuid,text,text) to service_role;

create or replace function public.fn_nodz_passagem_com_caso()
returns trigger language plpgsql security definer set search_path=public as $$
declare caso uuid;
begin
 if new.motivo_codigo='suspected_optout' then return new; end if;
 caso:=public.fn_nodz_garantir_caso_humano(new.organization_id,new.conversation_id,new.title,new.body);
 if caso is null then return new; end if;
 -- O Caso genérico criado antes do aviso recebe o briefing estruturado da passagem.
 update public.agent_cases set title=left(coalesce(nullif(new.title,''),title),200),summary=left(new.body,4000)
 where id=caso and organization_id=new.organization_id and context_snapshot->>'origem'='handoff_com_caso';
 if new.caso_id is null then new.caso_id:=caso; end if;
 return new;
end; $$;
revoke all on function public.fn_nodz_passagem_com_caso() from public,anon,authenticated;
drop trigger if exists trg_nodz_passagem_com_caso on public.passagens_de_atendimento;
create trigger trg_nodz_passagem_com_caso before insert on public.passagens_de_atendimento
for each row execute function public.fn_nodz_passagem_com_caso();
