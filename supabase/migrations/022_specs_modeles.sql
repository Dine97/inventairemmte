-- 6.16.2 — Recherche technique : modèles par marque (filtre « Modèle » qui suit les marques choisies).
create or replace function public.stock_specs_overview()
returns jsonb language sql stable security definer set search_path = public as $$
  with s as (select s.* from vehicle_specs s join vehicles v on v.id = s.vehicle_id and v.deleted_at is null),
  f as (select * from s where status = 'ok')
  select jsonb_build_object(
    'total', (select count(*) from vehicles where deleted_at is null),
    'ok', (select count(*) from s where status = 'ok'),
    'inconnu', (select count(*) from s where status = 'inconnu'),
    'non_decodable', (select count(*) from s where status = 'non_decodable'),
    'erreur', (select count(*) from s where status = 'erreur'),
    'pays', coalesce((select jsonb_agg(jsonb_build_object('v', plant_country, 'n', n) order by n desc) from (select plant_country, count(*) n from f where plant_country is not null group by 1) x), '[]'),
    'marques', coalesce((select jsonb_agg(jsonb_build_object('v', make, 'n', n) order by make) from (select make, count(*) n from f where make is not null group by 1) x), '[]'),
    'modeles', coalesce((select jsonb_agg(jsonb_build_object('m', make, 'v', model, 'n', n) order by make, model) from (select make, model, count(*) n from f where make is not null and model is not null group by 1, 2) x), '[]'),
    'types', coalesce((select jsonb_agg(jsonb_build_object('v', vehicle_type, 'n', n) order by n desc) from (select vehicle_type, count(*) n from f where vehicle_type is not null group by 1) x), '[]'),
    'carrosseries', coalesce((select jsonb_agg(jsonb_build_object('v', body_class, 'n', n) order by n desc) from (select body_class, count(*) n from f where body_class is not null group by 1) x), '[]'),
    'transmissions', coalesce((select jsonb_agg(jsonb_build_object('v', drive, 'n', n) order by n desc) from (select drive, count(*) n from f where drive is not null group by 1) x), '[]'),
    'energies', coalesce((select jsonb_agg(jsonb_build_object('v', energie, 'n', n) order by n desc) from (select energie, count(*) n from f where energie is not null group by 1) x), '[]'),
    'moteurs', coalesce((select jsonb_agg(jsonb_build_object('v', d::text, 'n', n) order by d) from (select round(displacement_l, 1) d, count(*) n from f where displacement_l > 0 group by 1) x), '[]')
  );
$$;
revoke all on function public.stock_specs_overview() from public, anon, authenticated;
grant execute on function public.stock_specs_overview() to service_role;
