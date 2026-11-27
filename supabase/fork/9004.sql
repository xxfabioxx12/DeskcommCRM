-- ---- reprocessar as vendas que falharam (migration 9004, fork) ----
-- Parte 2b da migração do ManyChat: venda que deu erro DEPOIS de registrada
-- (banco fora por um instante, contato que não nasceu, gatilho que não saiu)
-- ganha nova tentativa automática (5 min, 30 min, 2 h; no máximo 3) e o botão
-- "Tentar de novo" na lista de eventos de venda.
--
-- `tentativas`: quantas tentativas automáticas já saíram (a chegada não conta;
-- o botão zera). `proxima_tentativa_em`: em `falhou`, quando sai a próxima
-- (nulo = não volta sozinha: falha de configuração, 3ª falha ou fora das 24 h);
-- em `recebido`, o prazo de quem pegou a venda — passou, ela volta para a fila
-- (queda no meio da decisão).
--
-- A pega é um UPDATE condicional (só se ainda está como foi lida): duas
-- execuções ao mesmo tempo não pegam a mesma venda.
--
-- Não cria função: entra no FIM do baseline. Idempotente.

alter table public.sales_events add column if not exists tentativas integer not null default 0;
alter table public.sales_events add column if not exists proxima_tentativa_em timestamptz;
alter table public.sales_events drop constraint if exists sales_events_tentativas_check;
alter table public.sales_events add constraint sales_events_tentativas_check check (tentativas between 0 and 3);
comment on column public.sales_events.tentativas is
  'Tentativas automáticas já feitas (fork 9004). A chegada não conta; o botão "Tentar de novo" zera.';
comment on column public.sales_events.proxima_tentativa_em is
  'falhou: quando sai a próxima tentativa (nulo = não volta sozinha). recebido: prazo de quem pegou a venda (fork 9004).';

create index if not exists sales_events_fila_da_tentativa_idx
  on public.sales_events (proxima_tentativa_em)
  where proxima_tentativa_em is not null and status in ('falhou', 'recebido');

notify pgrst, 'reload schema';
