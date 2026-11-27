-- manifest: **Campanha com template aprovado (fatia 4 da #1330).** `campaigns` ganha `message_mode` ('text' | 'template', default 'text'), `template_name`, `template_language`, `template_contract_hash` (o carimbo do contrato no momento da escolha, para detectar mudança na plataforma), `template_slot_map` (jsonb: chave do slot → expressão com as variáveis da campanha) e `duplicated_from_campaign_id` (a campanha de onde a cópia saiu, para a cópia pular quem já recebeu), com CHECK de vocabulário, de coerência (template exige nome, idioma e carimbo; texto exige os três nulos) e de forma do mapa. `campaign_recipients` não ganha coluna (só o índice parcial `idx_campaign_recipients_ultimos_processados`, do disjuntor de falhas seguidas): `variables` guarda os valores resolvidos por pessoa e `rendered_body` a prévia. Toda campanha existente fica `text` e nada muda para ela. Aditiva e idempotente; apêndice igual no `supabase/baseline.sql`; par de `MODOS_DA_MENSAGEM` em `lib/campanhas/tipos.ts`. Gate: `tests/unit/campanha-template-migration.test.ts`.
-- ============================================================================
-- 9001 — CAMPANHA COM TEMPLATE APROVADO (fatia 4 da #1330)
--
-- A 0375 deixou de fora `message_mode`/`provider_template_*` ("quando o canal
-- oficial entrar, entra com a migration dele"). Esta é a migration dele.
--
-- No número que exige template, a plataforma recusa texto livre para quem não
-- falou com a empresa nas últimas 24 horas: a campanha "enviava" e a recusa
-- voltava pelo webhook para quase todo mundo. A campanha passa a guardar QUAL
-- template (nome + idioma — `pt_BR` e `pt` são definições distintas), o CARIMBO
-- do contrato quando foi escolhido (hash divergente = definição mudou: não
-- envia, não adivinha) e o MAPA de cada slot para uma expressão
-- (`{"1": "{{primeiro_nome}}", "2": "Super Presell"}`), resolvida por pessoa
-- na preparação com o mesmo renderizador do texto.
--
-- `campaign_recipients` NÃO ganha coluna: `variables` (jsonb, já zerado pela
-- anonimização LGPD) guarda os valores resolvidos e `rendered_body` a prévia.
--
-- Constraint nova sem correção de dados: as colunas nascem nulas/'text'/'{}',
-- então nenhuma linha existente viola as três.
-- ============================================================================

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
