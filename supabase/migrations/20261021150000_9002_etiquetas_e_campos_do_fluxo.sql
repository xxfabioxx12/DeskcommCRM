-- manifest: **Etiquetas e campos do motor de fluxo (fork 9002, Parte 1 da migração do ManyChat).** Três funções atômicas no padrão da 0682 e da 0502: `fn_contato_remover_etiquetas` e `fn_lead_remover_etiquetas` tiram etiquetas DENTRO do `UPDATE` (a lista é refeita sobre a linha vigente, preservando a ordem das que ficam; elemento nulo no pedido é descartado) e devolvem `{tags, removidas}`; `fn_contato_anotar_campos` mescla `p_campos` em `contacts.custom_fields` sem apagar as outras chaves (irmã de `fn_lead_anotar_campos`) e não toca contato anonimizado. Linha de outra organização devolve nulo. `security definer`, `EXECUTE` só para `service_role`, `revoke` de `public`, `anon` e `authenticated`. Sem tabela, coluna nem dado a corrigir. Cópia exata em `supabase/fork/9002.sql`, no baseline ANTES da varredura anon. Gate: `tests/unit/fork-9002-etiquetas-e-campos.test.ts`.

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

create or replace function public.fn_contato_remover_etiquetas(
  p_org uuid,
  p_contato uuid,
  p_tags text[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_tags      text[];
  v_antes     text[];
  v_removidas text[];
  v_depois    text[];
begin
  v_tags := array(select x from unnest(coalesce(p_tags, '{}'::text[])) as x where x is not null);
  if cardinality(v_tags) = 0 then
    raise exception 'etiquetas_vazio' using errcode = '22023';
  end if;

  select coalesce(tags, '{}'::text[])
    into v_antes
    from public.contacts
   where organization_id = p_org and id = p_contato
     for update;
  if not found then
    return null;
  end if;

  v_removidas := array(select unnest(v_antes) intersect select unnest(v_tags));
  if cardinality(v_removidas) = 0 then
    return jsonb_build_object('tags', to_jsonb(v_antes), 'removidas', '[]'::jsonb);
  end if;

  update public.contacts
     set tags = array(
           select t.etiqueta
             from unnest(coalesce(tags, '{}'::text[])) with ordinality as t(etiqueta, ordem)
            where not (t.etiqueta = any (v_tags))
            order by t.ordem
         ),
         updated_at = now()
   where organization_id = p_org and id = p_contato
   returning tags into v_depois;

  return jsonb_build_object(
    'tags', to_jsonb(coalesce(v_depois, '{}'::text[])),
    'removidas', to_jsonb(v_removidas)
  );
end
$fn$;

create or replace function public.fn_lead_remover_etiquetas(
  p_org uuid,
  p_lead uuid,
  p_tags text[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_tags      text[];
  v_antes     text[];
  v_removidas text[];
  v_depois    text[];
begin
  -- Irmã da de cima, na tabela do CARD. Corpo idêntico trocando a tabela.
  v_tags := array(select x from unnest(coalesce(p_tags, '{}'::text[])) as x where x is not null);
  if cardinality(v_tags) = 0 then
    raise exception 'etiquetas_vazio' using errcode = '22023';
  end if;

  select coalesce(tags, '{}'::text[])
    into v_antes
    from public.crm_leads
   where organization_id = p_org and id = p_lead
     for update;
  if not found then
    return null;
  end if;

  v_removidas := array(select unnest(v_antes) intersect select unnest(v_tags));
  if cardinality(v_removidas) = 0 then
    return jsonb_build_object('tags', to_jsonb(v_antes), 'removidas', '[]'::jsonb);
  end if;

  update public.crm_leads
     set tags = array(
           select t.etiqueta
             from unnest(coalesce(tags, '{}'::text[])) with ordinality as t(etiqueta, ordem)
            where not (t.etiqueta = any (v_tags))
            order by t.ordem
         ),
         updated_at = now()
   where organization_id = p_org and id = p_lead
   returning tags into v_depois;

  return jsonb_build_object(
    'tags', to_jsonb(coalesce(v_depois, '{}'::text[])),
    'removidas', to_jsonb(v_removidas)
  );
end
$fn$;

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

revoke all on function public.fn_contato_remover_etiquetas(uuid, uuid, text[]) from public, anon, authenticated;
revoke all on function public.fn_lead_remover_etiquetas(uuid, uuid, text[]) from public, anon, authenticated;
revoke all on function public.fn_contato_anotar_campos(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.fn_contato_remover_etiquetas(uuid, uuid, text[]) to service_role;
grant execute on function public.fn_lead_remover_etiquetas(uuid, uuid, text[]) to service_role;
grant execute on function public.fn_contato_anotar_campos(uuid, uuid, jsonb) to service_role;

comment on function public.fn_contato_remover_etiquetas(uuid, uuid, text[]) is
  'Tira etiquetas do contato DENTRO do UPDATE e devolve {tags, removidas}. Fork 9002 (motor de fluxo).';
comment on function public.fn_lead_remover_etiquetas(uuid, uuid, text[]) is
  'Tira etiquetas do card DENTRO do UPDATE e devolve {tags, removidas}. Fork 9002 (motor de fluxo).';
comment on function public.fn_contato_anotar_campos(uuid, uuid, jsonb) is
  'Mescla campos em contacts.custom_fields numa instrução atômica, sem apagar as outras chaves. Fork 9002.';

notify pgrst, 'reload schema';
