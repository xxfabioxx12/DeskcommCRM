-- ---- etiquetas e campos do motor de fluxo (migration 9002, fork) ----
-- Parte 1 da migração do ManyChat: regras e fluxos passam a TIRAR etiqueta (do
-- contato ou do card) e a GRAVAR um campo do contato. Mesma corrida e mesmo
-- desenho da 0682 (`add_tag`) e da 0502 (`fn_lead_anotar_campos`): a conta é
-- feita DENTRO do `UPDATE`, sobre a linha vigente — duas automações ao mesmo
-- tempo não apagam o que a outra gravou.
--
-- Tirar etiqueta: a pré-imagem é lida sob `for update` só para saber QUAIS
-- saíram (`removidas`); quem tira é o `UPDATE`, que refaz a lista sem as
-- pedidas e preserva a ordem das que ficam (`with ordinality`). Elemento nulo no
-- pedido é descartado ANTES: `etiqueta <> all(array['a', null])` dá nulo e
-- tiraria TODAS as etiquetas da linha. Nada a tirar = nada gravado.
--
-- Gravar campo: `custom_fields || p_campos` numa instrução só, raso (campo é
-- chave→valor). Contato anonimizado não é tocado (LGPD).
--
-- Linha de outra organização devolve nulo e não é tocada. Nenhuma função emite
-- evento nem decide papel: isso é de quem chama (a ação do motor de automação,
-- com o client de serviço). Entra ANTES da varredura anon: função depois dela
-- nasceria executável pela anon key em quem atualiza.
--
-- Idempotente: `create or replace`, `revoke`/`grant` reaplicáveis. Sem tabela,
-- coluna, policy ou dado a corrigir.
--
-- Desde a 1.123: TIRAR etiqueta saiu deste bloco. O oficial criou as mesmas
-- `fn_contato_remover_etiquetas`/`fn_lead_remover_etiquetas` (migration 9234,
-- parâmetro `p_etiquetas`, compara sem caixa) com o mesmo retorno
-- {tags, removidas}; ficam as deles. Em produção a 9234 precisa que as nossas
-- (parâmetro `p_tags`) sejam apagadas antes (Postgres não troca nome de
-- parâmetro em `create or replace`).

create or replace function public.fn_contato_anotar_campos(
  p_org uuid,
  p_contato uuid,
  p_campos jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  resultado jsonb;
begin
  if p_campos is null or jsonb_typeof(p_campos) <> 'object' then
    raise exception 'campos_precisa_ser_objeto' using errcode = '22023';
  end if;

  -- UMA instrução, sem leitura prévia: a conta é refeita sobre a linha vigente
  -- quando há escrita concorrente (mesma razão da 0502).
  update public.contacts
     set custom_fields = coalesce(custom_fields, '{}'::jsonb) || p_campos,
         updated_at = now()
   where organization_id = p_org and id = p_contato
     and is_anonymized is not true
   returning custom_fields into resultado;

  return resultado;
end
$fn$;

revoke all on function public.fn_contato_anotar_campos(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.fn_contato_anotar_campos(uuid, uuid, jsonb) to service_role;

comment on function public.fn_contato_anotar_campos(uuid, uuid, jsonb) is
  'Mescla campos em contacts.custom_fields numa instrução atômica, sem apagar as outras chaves. Fork 9002.';

notify pgrst, 'reload schema';
