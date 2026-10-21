-- ---- entrada das vendas (migration 9003, fork) ----
-- Parte 2 da migração do ManyChat: o Deskcomm recebe direto das plataformas de
-- venda (Hotmart, Kiwify, Kookie e uma conexão personalizada).
--
-- Conexão de venda = linha de `webhook_sources` com `kind` de plataforma e a
-- configuração em `config` ({dispara, telefone_regiao, seguranca, mapa}). Ela
-- não tem funil: `default_*` deixam de ser obrigatórios, e a captação
-- (`lead_capture`) continua exigindo os dois pelo CHECK abaixo.
--
-- `sales_events`: uma linha por entrega aceita (ou recusada pela assinatura),
-- com o evento padrão, o pedido, o produto, o contato e o desfecho. A entrega
-- repetida morre no índice único (conexão, chave do evento). Os dados da pessoa
-- (payload, `venda`, e-mail, telefone) saem em 30 dias e na hora em que o
-- contato é anonimizado.
--
-- `sales_rule_runs`: a mesma regra roda no máximo uma vez por (conexão,
-- pedido/entidade, evento). O `event_id` deixa o MESMO evento reprocessado rodar
-- de novo (worker derrubado antes de marcar o consumo), como na 0692.
--
-- `sale.received` alcança a origem do atendimento e é reservado ao servidor,
-- como o `contact.phone_added` (0670): as duas funções do fim deste bloco são as
-- da 0670 com o tipo acrescentado e mais nada (cerca:
-- tests/unit/fork-9003-entrada-das-vendas.test.ts).
--
-- Entra ANTES da varredura anon (cria função). Idempotente.

alter table public.webhook_sources drop constraint if exists webhook_sources_kind_check;
alter table public.webhook_sources add constraint webhook_sources_kind_check
  check (kind in ('lead_capture', 'hotmart', 'kiwify', 'kookie', 'personalizada'));
alter table public.webhook_sources alter column default_pipeline_id drop not null;
alter table public.webhook_sources alter column default_stage_id drop not null;
alter table public.webhook_sources drop constraint if exists webhook_sources_captacao_tem_funil;
alter table public.webhook_sources add constraint webhook_sources_captacao_tem_funil
  check (kind <> 'lead_capture' or (default_pipeline_id is not null and default_stage_id is not null));
alter table public.webhook_sources add column if not exists config jsonb not null default '{}'::jsonb;
comment on column public.webhook_sources.config is
  'Conexão de venda (fork 9003): {dispara, telefone_regiao, seguranca, mapa}. Vazio na captação.';

create table if not exists public.sales_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  webhook_source_id uuid not null references public.webhook_sources(id) on delete cascade,
  plataforma text not null check (plataforma in ('hotmart', 'kiwify', 'kookie', 'personalizada')),
  evento_original text check (char_length(evento_original) <= 100),
  evento text check (char_length(evento) <= 100),
  chave_evento text check (char_length(chave_evento) <= 128),
  entidade text check (char_length(entidade) <= 300),
  pedido text check (char_length(pedido) <= 300),
  produto_id text check (char_length(produto_id) <= 200),
  produto text check (char_length(produto) <= 500),
  email text,
  telefone text,
  order_bump boolean not null default false,
  teste boolean not null default false,
  contact_id uuid references public.contacts(id) on delete set null,
  status text not null default 'recebido'
    check (status in ('recebido', 'ignorado', 'sem_contato', 'processado', 'falhou', 'recusado')),
  motivo text check (char_length(motivo) <= 500),
  venda jsonb not null default '{}'::jsonb,
  payload jsonb,
  recebido_em timestamptz not null default now()
);

create unique index if not exists sales_events_uma_entrega_idx
  on public.sales_events (webhook_source_id, chave_evento) where chave_evento is not null;
create index if not exists sales_events_lista_idx
  on public.sales_events (organization_id, recebido_em desc);
create index if not exists sales_events_comprou_email_idx
  on public.sales_events (organization_id, email, recebido_em desc)
  where evento = 'compra.aprovada' and not teste;
create index if not exists sales_events_comprou_telefone_idx
  on public.sales_events (organization_id, telefone, recebido_em desc)
  where evento = 'compra.aprovada' and not teste;
create index if not exists sales_events_mesmo_pedido_idx
  on public.sales_events (webhook_source_id, entidade)
  where evento = 'compra.aprovada' and not teste;
create index if not exists sales_events_poda_idx
  on public.sales_events (recebido_em) where payload is not null;
-- A pessoa: o contato, o e-mail e o telefone (redação na anonimização e export LGPD).
create index if not exists sales_events_contato_idx
  on public.sales_events (organization_id, contact_id) where contact_id is not null;
create index if not exists sales_events_email_idx
  on public.sales_events (organization_id, email) where email is not null;
create index if not exists sales_events_telefone_idx
  on public.sales_events (organization_id, telefone) where telefone is not null;

alter table public.sales_events enable row level security;
drop policy if exists sales_events_select on public.sales_events;
create policy sales_events_select on public.sales_events
  for select using (
    public.fn_is_platform_admin()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  );
revoke all on public.sales_events from anon, authenticated;
grant select on public.sales_events to authenticated;
grant all on public.sales_events to service_role;
comment on table public.sales_events is
  'Vendas recebidas das plataformas (fork 9003). Escrita só pelo servidor; dados da pessoa saem em 30 dias e na anonimização.';

create table if not exists public.sales_rule_runs (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  rule_id uuid not null references public.automation_rules(id) on delete cascade,
  webhook_source_id uuid not null references public.webhook_sources(id) on delete cascade,
  entidade text not null,
  evento text not null,
  event_id uuid,
  criado_em timestamptz not null default now(),
  primary key (rule_id, webhook_source_id, entidade, evento)
);
alter table public.sales_rule_runs enable row level security;
revoke all on public.sales_rule_runs from anon, authenticated;
grant all on public.sales_rule_runs to service_role;

create or replace function public.fn_vendas_redigir_ao_anonimizar()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  if new.is_anonymized and not coalesce(old.is_anonymized, false) then
    update public.sales_events
       set email = null, telefone = null, venda = '{}'::jsonb, payload = null
     where organization_id = new.organization_id
       and (contact_id = new.id
            or (old.email is not null and email = lower(trim(old.email)))
            or (old.phone_number is not null and telefone = old.phone_number));
  end if;
  return new;
end
$fn$;
revoke all on function public.fn_vendas_redigir_ao_anonimizar() from public, anon, authenticated;
drop trigger if exists trg_vendas_redigir_ao_anonimizar on public.contacts;
create trigger trg_vendas_redigir_ao_anonimizar
  after update of is_anonymized on public.contacts
  for each row execute function public.fn_vendas_redigir_ao_anonimizar();

create or replace function public.fn_vendas_limpar_dados_vencidos(p_dias integer, p_lote integer)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_limpas integer;
begin
  with alvo as (
    select id
      from public.sales_events
     where payload is not null
       and recebido_em < now() - make_interval(days => greatest(coalesce(p_dias, 30), 1))
     order by recebido_em
     limit greatest(coalesce(p_lote, 500), 1)
  )
  update public.sales_events s
     set email = null, telefone = null, venda = '{}'::jsonb, payload = null
    from alvo
   where s.id = alvo.id;
  get diagnostics v_limpas = row_count;
  return v_limpas;
end
$fn$;
revoke all on function public.fn_vendas_limpar_dados_vencidos(integer, integer) from public, anon, authenticated;
grant execute on function public.fn_vendas_limpar_dados_vencidos(integer, integer) to service_role;

-- A partir daqui: fn_service_event_contact e emit_event da 0670 + 'sale.received'.
create or replace function public.fn_service_event_contact(p_org uuid,p_event_type text,p_entity_kind text,p_entity_id uuid)
returns table(contact_id uuid,suportado boolean) language plpgsql stable security definer set search_path=public as $$
begin
 if p_event_type in ('lead.created','lead.stage_changed','lead.tag_added') and p_entity_kind='crm_lead' then
   return query select (select l.contact_id from public.crm_leads l where l.organization_id=p_org and l.id=p_entity_id),true;
 elsif p_event_type in ('contact.tag_added','contact.birthday','contact.phone_added','sale.received') and p_entity_kind='contact' then
   return query select (select c.id from public.contacts c where c.organization_id=p_org and c.id=p_entity_id),true;
 elsif p_event_type in ('appointment.created','appointment.confirmed','appointment.rescheduled','appointment.cancelled','appointment.completed','appointment.no_show') and p_entity_kind='calendar_appointment' then
   return query select (select a.contact_id from public.calendar_appointments a where a.organization_id=p_org and a.id=p_entity_id),true;
 else
   return query select null::uuid,false;
 end if;
end $$;
revoke all on function public.fn_service_event_contact(uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.fn_service_event_contact(uuid,text,text,uuid) to service_role;

CREATE OR REPLACE FUNCTION public.emit_event(p_event_type text, p_entity_kind text, p_entity_id uuid, p_payload jsonb DEFAULT '{}'::jsonb, p_metadata jsonb DEFAULT '{}'::jsonb, p_organization_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_org_id uuid;
  v_event_id uuid;
  v_contact uuid;
  v_origin jsonb;
begin
  -- message.received nasce somente do INSERT inbound interno. Um chamador
  -- público não pode reapresentar uma mensagem existente como evento novo.
  -- `ai.case_opened`/`ai.case_closed` entram pela mesma razão (0279): o caso é
  -- do motor, e um evento de caso forjado por login move o funil e acorda o
  -- agente em nome de uma decisão que ninguém tomou.
  -- `contact.birthday` entra pela 0551: só o cron (`contact-birthdays`, sem
  -- sessão) o emite, e a partir desta migration ele alcança a origem e manda
  -- WhatsApp de verdade — forjado por login, seria envio em nome de um
  -- aniversário que ninguém fez.
  -- `contact.phone_added` entra pela 0670, pela mesma razão do aniversário:
  -- quem o emite é o servidor (o PATCH de contatos, com a chave de serviço,
  -- depois de gravar o número), e ele alcança a origem e manda WhatsApp.
  -- Revogação do turno é fato da tomada nativa, nunca um pedido do login.
  if auth.uid() is not null and p_event_type in (
    'message.received','appointment.outcome_confirmed',
    'ai.case_opened','ai.case_closed','contact.birthday','contact.phone_added',
    'conversation.autonomous_turn_revoked','sale.received'
  ) then
    raise exception 'reserved_message_received' using errcode='42501';
  end if;
  -- Desfecho e responsável do negócio só nascem do gatilho de `crm_leads`
  -- (`fn_emit_event_on_lead_change`), quando a linha muda de fato. Nenhum
  -- emissor do app os pede por RPC; os consumidores produzem efeito real
  -- (push, webhook de saída, conversão de anúncio).
  if auth.uid() is not null
     and p_event_type in ('lead.won','lead.lost','lead.reopened','lead.assigned')
     and coalesce(current_setting('deskcomm.desfecho_pelo_negocio', true), '') <> 'on' then
    raise exception 'reserved_message_received' using errcode='42501';
  end if;
  -- Estes campos autorizam efeitos operacionais; não são payload público.
  if auth.uid() is not null and (
    coalesce(p_payload,'{}'::jsonb) ?| array['service_origin','service_boundary']
    or coalesce(p_metadata,'{}'::jsonb) ?| array['service_origin','service_boundary']
  ) then raise exception 'reserved_service_origin' using errcode='42501'; end if;
  v_org_id := coalesce(p_organization_id, (public.fn_support_context()->>'organization_id')::uuid);
  if v_org_id is null then
    select organization_id into v_org_id
      from public.user_organizations
      where user_id = auth.uid() and revoked_at is null
      limit 1;
  end if;
  if v_org_id is null then
    raise exception 'emit_event: organization_id obrigatorio';
  end if;

  if auth.uid() is not null
     and not public.fn_role_at_least(v_org_id, 'viewer') then
    raise exception 'caller_not_authorized_for_org'
      using hint = 'emit_event: caller must be an active member of the organization';
  end if;

  if not public.fn_support_write_allowed(v_org_id) then raise exception 'support_readonly' using errcode='42501'; end if;

  -- A ORIGEM E RESERVADA AO SERVIDOR — ENTAO O SERVIDOR TEM DE ESCREVE-LA.
  --
  -- O bloco acima recusa `service_origin` vindo de chamador autenticado (42501,
  -- e com razao: e o campo que AUTORIZA efeito operacional, nao payload
  -- publico). So que ninguem o escrevia no lugar dele. Efeito medido: quem move
  -- o negocio pela IA carimba a origem no servidor (`agent-stage-sync`,
  -- `appointment-stage-move`, `handoff-stage-move`) e o follow-up nasce; quem
  -- move PELO QUADRO — o operador, pela rota HTTP autenticada — emitia um
  -- evento SEM origem, `fn_service_event_origin` caia no `service_stale` final
  -- (40001), `serviceForEvent` engolia como `stale_origin` e o follow-up nunca
  -- nascia. Sem erro em lugar nenhum: o gatilho de etapa era inalcancavel pelo
  -- caminho que o produto oferece na tela.
  --
  -- O retrato e tirado AQUI, no instante da emissao, que e exatamente a
  -- semantica de procedencia que a 0223 quer: "quando este evento nasceu, o
  -- atendimento estava assim". A resolucao do contato vem da mesma tabela de
  -- `fn_service_event_contact` — se ela nao souber resolver o tipo, nao ha o que
  -- carimbar e o evento segue sem origem, como antes.
  if not (coalesce(p_payload,'{}'::jsonb) ? 'service_origin')
     and not (coalesce(p_metadata,'{}'::jsonb) ? 'service_origin') then
    select f.contact_id into v_contact
      from public.fn_service_event_contact(v_org_id, p_event_type, p_entity_kind, p_entity_id) f;
    if v_contact is not null
       and exists(select 1 from public.contacts
                   where organization_id=v_org_id and id=v_contact
                     and not is_anonymized and is_merged_into is null) then
      v_origin := jsonb_build_object('kind','command',
        'observed', public.fn_service_observe_command(v_org_id, v_contact));
    end if;
  end if;

  insert into public.event_log
    (organization_id, event_type, entity_kind, entity_id, payload, metadata)
  values
    (v_org_id, p_event_type, p_entity_kind, p_entity_id,
     coalesce(p_payload, '{}'::jsonb)
       || case when v_origin is null then '{}'::jsonb else jsonb_build_object('service_origin', v_origin) end,
     coalesce(p_metadata, '{}'::jsonb)
       || jsonb_build_object('emitted_at', extract(epoch from now())))
  returning id into v_event_id;

  return v_event_id;
end $function$;
revoke execute on function public.emit_event(text, text, uuid, jsonb, jsonb, uuid) from public, anon;
grant  execute on function public.emit_event(text, text, uuid, jsonb, jsonb, uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
