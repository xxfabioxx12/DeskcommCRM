-- ---- campanha com template: fica a do fork (migration 9007, fork) ----
-- A 0710 do oficial (1.89) põe em campaigns o CHECK campaigns_modelo_exige_nome_e_idioma,
-- que exige provider_template_name/language em toda campanha 'template'. A nossa
-- campanha (9001) grava template_name/template_language, então esse CHECK recusaria
-- toda campanha com template nossa. Regra do Fabio (24/10/2026): fica a nossa. As
-- colunas provider_template_* da 0710 ficam (sem uso); só o CHECK sai. Idempotente.
do $fica_a_do_fork$
begin
  if not exists (select 1 from pg_constraint where conname = 'campaigns_template_coerente_check') then
    raise exception '9007: a campanha com template do fork (9001) precisa estar aplicada antes';
  end if;
end
$fica_a_do_fork$;
alter table public.campaigns drop constraint if exists campaigns_modelo_exige_nome_e_idioma;
notify pgrst, 'reload schema';
