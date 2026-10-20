-- ---- campanha com template aprovado (migration 9001, fatia 4 da #1330) ----
-- Não cria função, então pode ficar depois da VARREDURA anon. Sem este bloco,
-- clones novos (install.sh) e clones atualizando (update.sh) ficam sem as
-- colunas, e criar campanha recusa com 42703. Constraint nova sem correção de
-- dados: as colunas nascem nulas/'text'/'{}' e nenhuma linha as viola.
alter table public.campaigns
  add column if not exists message_mode text not null default 'text',
  add column if not exists template_name text,
  add column if not exists template_language text,
  add column if not exists template_contract_hash text,
  add column if not exists template_slot_map jsonb not null default '{}'::jsonb,
  add column if not exists duplicated_from_campaign_id uuid;

-- Num bloco DO: o update.sh aplica o baseline sem ON_ERROR_STOP e em
-- autocommit; soltos, um `add` que falhasse deixaria a tabela sem as três.
do $$
begin
  alter table public.campaigns
    drop constraint if exists campaigns_message_mode_check,
    drop constraint if exists campaigns_template_slot_map_objeto_check,
    drop constraint if exists campaigns_template_coerente_check;
  alter table public.campaigns
    add constraint campaigns_message_mode_check
      check (message_mode in ('text', 'template')),
    add constraint campaigns_template_slot_map_objeto_check
      check (jsonb_typeof(template_slot_map) = 'object'),
    add constraint campaigns_template_coerente_check
      check (
        (message_mode = 'text'
          and template_name is null
          and template_language is null
          and template_contract_hash is null)
        or (message_mode = 'template'
          and template_name is not null
          and template_language is not null
          and template_contract_hash is not null)
      );
end $$;

comment on column public.campaigns.message_mode is
  'text = texto livre (message_body); template = modelo aprovado da plataforma (template_*). Vocabulário em MODOS_DA_MENSAGEM (lib/campanhas/tipos.ts).';
comment on column public.campaigns.template_contract_hash is
  'Hash do contrato (meta_templates.contract_hash) quando o template foi escolhido. Divergente no envio = definição mudou: a campanha pausa com failure_code template_mudou.';
comment on column public.campaigns.template_slot_map is
  'Chave do slot (slotKey: "1", "header:1", "button0:1") → expressão com {{nome}}, {{primeiro_nome}}, {{saudacao}}, {{contato.x}}, {{lead.x}} ou texto fixo.';
-- O disjuntor da rodada (5 falhas seguidas pausam a campanha num número que
-- exige template) lê as últimas pessoas processadas pela hora da reserva.
create index if not exists idx_campaign_recipients_ultimos_processados
  on public.campaign_recipients (campaign_id, sending_at desc)
  where sending_at is not null;

comment on column public.campaigns.duplicated_from_campaign_id is
  'Campanha de onde esta saiu pelo Duplicar. A preparação da cópia pula quem já recebeu a original (status sending/sent/delivered/read/replied). Sem FK de propósito: apagar a original não mexe na cópia; toda leitura filtra organization_id.';

notify pgrst, 'reload schema';
