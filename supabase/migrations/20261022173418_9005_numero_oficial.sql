-- manifest: **Número oficial: conta de mensagens e resposta automática (fork 9005, caminho 1).** `channel_sessions` ganha `meta_messaging_account_id` (só dígitos; a conta que paga os envios da conexão oficial) e `responde_sozinho` (boolean sem padrão; nulo = padrão do provedor: oficial desligado, demais ligados). Sem função, sem UPDATE. Idempotente. Cópia exata em `supabase/fork/9005.sql`, no FIM do baseline. Gate: `tests/unit/fork-9005-numero-oficial.test.ts`.

-- ---- número oficial: conta de mensagens e resposta automática (migration 9005, fork) ----
-- Caminho 1 do número oficial (Projetos/DeskcommCRM/Campanha-Template-Meta): o
-- ManyChat segue conectado e disparando os templates dele; este sistema atende o
-- cliente pelo mesmo número.
--
-- `meta_messaging_account_id`: a conta de mensagens da Meta que paga os envios
-- desta conexão (texto, mídia, template e "digitando…"). Nulo = a Meta escolhe a
-- conta pela chave, como antes desta migration.
--
-- `responde_sozinho`: o interruptor "Responder automaticamente por este número".
-- Sem padrão de propósito: nulo = padrão do provedor, decidido no código
-- (`lib/channels/responde-sozinho.ts`): conexão oficial desligada, as demais
-- ligadas. Assim as conexões oficiais que já existem ficam desligadas e os
-- números por QR Code não mudam, sem nenhum UPDATE.
--
-- Não cria função: entra no FIM do baseline. Idempotente.

alter table public.channel_sessions add column if not exists meta_messaging_account_id text;
alter table public.channel_sessions drop constraint if exists channel_sessions_meta_messaging_account_id_check;
alter table public.channel_sessions add constraint channel_sessions_meta_messaging_account_id_check check (meta_messaging_account_id ~ '^[0-9]{5,30}$');
comment on column public.channel_sessions.meta_messaging_account_id is
  'Conta de mensagens da Meta que paga os envios desta conexão oficial (fork 9005). Nulo = a Meta escolhe pela chave.';

alter table public.channel_sessions add column if not exists responde_sozinho boolean;
comment on column public.channel_sessions.responde_sozinho is
  'Interruptor "Responder automaticamente por este número" (fork 9005). Nulo = padrão do provedor: oficial desligado, demais ligados.';

notify pgrst, 'reload schema';
