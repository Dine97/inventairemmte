-- STOCK MMTE v1 : fonctions de base toujours utilisées
-- (les fonctions d'import, d'annulation et de tableau de bord sont définies dans 003 et 004)
create or replace function public.stock_recompute_current(p_vehicle_ids bigint[])
returns void language sql security definer set search_path = public as $$
  update vehicles v set current_parc_id = (
    select s.parc_id from stays s
    where s.vehicle_id = v.id and s.exit_date is null and s.deleted_at is null
    order by s.entry_date desc, s.id desc limit 1)
  where v.id = any(p_vehicle_ids);
$$;

create or replace function public.stock_parc_id(p_name text)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  insert into parcs(name) values (upper(trim(p_name)))
  on conflict (name) do update set deleted_at = null, updated_at = now()
  returning id into v_id;
  return v_id;
end $$;

-- Aperçu (lecture seule) de ce que l'import va produire
create or replace function public.stock_preview_import(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_parc bigint; v_last date; v_first boolean; r jsonb;
begin
  select id into v_parc from parcs where name = upper(trim(p->>'parc_name')) and deleted_at is null;
  select max(stock_date) into v_last from imports where parc_id = v_parc and status = 'valide';
  v_first := v_last is null;
  with incoming as (select distinct upper(x) as chassis from jsonb_array_elements_text(p->'chassis') x),
  open_here as (select v.chassis from stays s join vehicles v on v.id = s.vehicle_id
                where s.parc_id = v_parc and s.exit_date is null and s.deleted_at is null),
  elsewhere as (select v.chassis, pp.name as parc from stays s join vehicles v on v.id = s.vehicle_id join parcs pp on pp.id = s.parc_id
                where s.parc_id is distinct from v_parc and s.exit_date is null and s.deleted_at is null),
  gone as (select distinct v.chassis from stays s join vehicles v on v.id = s.vehicle_id
           where s.exit_kind = 'sortie' and s.deleted_at is null
             and not exists (select 1 from stays s2 where s2.vehicle_id = v.id and s2.exit_date is null and s2.deleted_at is null))
  select jsonb_build_object(
    'parc_exists', v_parc is not null, 'is_initial', v_first, 'last_stock_date', v_last,
    'nb_chassis', (select count(*) from incoming),
    'entrees', coalesce((select jsonb_agg(i.chassis) from incoming i where i.chassis not in (select chassis from open_here)), '[]'),
    'sorties', coalesce((select jsonb_agg(o.chassis) from open_here o where o.chassis not in (select chassis from incoming)), '[]'),
    'inchanges', (select count(*) from incoming i where i.chassis in (select chassis from open_here)),
    'autres_parcs', coalesce((select jsonb_agg(jsonb_build_object('chassis', e.chassis, 'parc', e.parc)) from elsewhere e where e.chassis in (select chassis from incoming)), '[]'),
    'reapparus', coalesce((select jsonb_agg(g.chassis) from gone g where g.chassis in (select chassis from incoming) and g.chassis not in (select chassis from open_here)), '[]')
  ) into r;
  return r;
end $$;

revoke all on function public.stock_recompute_current(bigint[]), public.stock_parc_id(text), public.stock_preview_import(jsonb) from public, anon, authenticated;
grant execute on function public.stock_recompute_current(bigint[]), public.stock_parc_id(text), public.stock_preview_import(jsonb) to service_role;
