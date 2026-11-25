-- 6.18.0 — Revue de l'import : propositions de correction calculées avec la base
--   connus           : date d'arrivée déjà connue pour les châssis du fichier
--   proches          : pour les châssis atypiques inconnus, véhicule existant à 1 ou 2 caractères près
--   reapparus_detail : date et justificatif de la dernière sortie des véhicules qui réapparaissent
create or replace function public.stock_preview_import(p jsonb)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_parc bigint; v_last date; v_first boolean; r jsonb;
begin
  select id into v_parc from parcs where name = upper(trim(p->>'parc_name')) and deleted_at is null;
  select max(stock_date) into v_last from imports where parc_id = v_parc and status = 'valide';
  v_first := v_last is null;
  with incoming as (
    select distinct upper(x) as chassis from jsonb_array_elements_text(p->'chassis') x
  ), open_here as (
    select v.chassis from stays s join vehicles v on v.id = s.vehicle_id
    where s.parc_id = v_parc and s.exit_date is null and s.deleted_at is null
  ), elsewhere as (
    select v.chassis, pp.name as parc from stays s join vehicles v on v.id = s.vehicle_id join parcs pp on pp.id = s.parc_id
    where s.parc_id is distinct from v_parc and s.exit_date is null and s.deleted_at is null
  ), gone as (
    select distinct v.chassis from stays s join vehicles v on v.id = s.vehicle_id
    where s.exit_kind = 'sortie' and s.deleted_at is null
      and not exists (select 1 from stays s2 where s2.vehicle_id = v.id and s2.exit_date is null and s2.deleted_at is null)
  ), atyp as (
    select i.chassis from incoming i
    where (length(i.chassis) <> 17 or i.chassis ~ '[IOQ]')
      and not exists (select 1 from vehicles v where v.chassis = i.chassis and v.deleted_at is null)
    limit 300
  ), proche as (
    select a.chassis, m.match, m.dist, m.parc, m.ici, m.present
    from atyp a
    cross join lateral (
      select v.chassis as match, levenshtein_less_equal(a.chassis, v.chassis, 2) as dist,
             pc.name as parc, (v.current_parc_id = v_parc) as ici, (v.current_parc_id is not null) as present
      from vehicles v left join parcs pc on pc.id = v.current_parc_id
      where v.deleted_at is null and abs(length(v.chassis) - length(a.chassis)) <= 2
        and levenshtein_less_equal(a.chassis, v.chassis, 2) <= 2
      order by levenshtein_less_equal(a.chassis, v.chassis, 2), (v.current_parc_id = v_parc) desc nulls last, (v.current_parc_id is not null) desc
      limit 1
    ) m
  )
  select jsonb_build_object(
    'parc_exists', v_parc is not null,
    'is_initial', v_first,
    'last_stock_date', v_last,
    'nb_chassis', (select count(*) from incoming),
    'entrees', coalesce((select jsonb_agg(i.chassis) from incoming i where i.chassis not in (select chassis from open_here)), '[]'),
    'sorties', coalesce((select jsonb_agg(o.chassis) from open_here o where o.chassis not in (select chassis from incoming)), '[]'),
    'inchanges', (select count(*) from incoming i where i.chassis in (select chassis from open_here)),
    'autres_parcs', coalesce((select jsonb_agg(jsonb_build_object('chassis', e.chassis, 'parc', e.parc)) from elsewhere e where e.chassis in (select chassis from incoming)), '[]'),
    'reapparus', coalesce((select jsonb_agg(g.chassis) from gone g where g.chassis in (select chassis from incoming) and g.chassis not in (select chassis from open_here)), '[]'),
    'reapparus_detail', coalesce((select jsonb_agg(jsonb_build_object('chassis', x.chassis, 'exit_date', x.exit_date, 'parc', x.parc, 'justif_numero', x.justif_numero))
        from (select distinct on (v.chassis) v.chassis, s.exit_date, pp.name as parc, s.justif_numero
              from stays s join vehicles v on v.id = s.vehicle_id join parcs pp on pp.id = s.parc_id
              where s.exit_kind = 'sortie' and s.deleted_at is null
                and v.chassis in (select g.chassis from gone g where g.chassis in (select chassis from incoming) and g.chassis not in (select chassis from open_here))
              order by v.chassis, s.exit_date desc) x), '[]'),
    'connus', coalesce((select jsonb_object_agg(v.chassis, v.date_arrivee) from vehicles v
        where v.chassis in (select chassis from incoming) and v.date_arrivee is not null and v.deleted_at is null), '{}'),
    'proches', coalesce((select jsonb_agg(jsonb_build_object('chassis', chassis, 'match', match, 'distance', dist, 'parc', parc, 'ici', coalesce(ici, false), 'present', present)) from proche), '[]')
  ) into r;
  return r;
end $$;
revoke all on function public.stock_preview_import(jsonb) from public, anon, authenticated;
grant execute on function public.stock_preview_import(jsonb) to service_role;
