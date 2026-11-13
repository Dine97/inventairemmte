-- 6.16.0 — Recherche technique : caractéristiques décodées depuis le numéro de châssis (base NHTSA), gardées à part du stock.
-- Rien n'est modifié dans les véhicules, les séjours ni les données fournies par les parcs.
-- Décodage par lots de 50 côté serveur : après chaque import, à l'ouverture de l'écran, et chaque nuit (reprise).

create table if not exists public.vehicle_specs (
  vehicle_id bigint primary key references public.vehicles(id) on delete cascade,
  vin text not null,
  status text not null check (status in ('ok', 'inconnu', 'non_decodable', 'erreur')),
  make text, model text, model_year int, series text, vehicle_type text, body_class text, doors int,
  fuel text, fuel2 text, electrification text, energie text,
  displacement_l numeric, cylinders int, hp numeric, drive text, transmission text,
  plant_country text, plant_city text, plant_company text, manufacturer text, gvwr text,
  error_code text, raw jsonb, attempts int not null default 0, decoded_at timestamptz not null default now()
);
create index if not exists vehicle_specs_energie_idx on public.vehicle_specs(energie);
create index if not exists vehicle_specs_pays_idx on public.vehicle_specs(plant_country);
create index if not exists vehicle_specs_make_idx on public.vehicle_specs(make);
create index if not exists vehicle_specs_status_idx on public.vehicle_specs(status);
alter table public.vehicle_specs enable row level security;
revoke all on public.vehicle_specs from anon, authenticated;

-- Clé privée de la tâche de nuit (jamais renvoyée à l'application)
create table if not exists public.stock_secrets (key text primary key, value text not null);
alter table public.stock_secrets enable row level security;
revoke all on public.stock_secrets from anon, authenticated;
insert into public.stock_secrets(key, value) values ('cron', encode(extensions.gen_random_bytes(24), 'hex')) on conflict (key) do nothing;

-- Véhicules à décoder : jamais décodés, ou en erreur (5 essais au plus). Les numéros qui ne sont pas des VIN de 17 caractères
-- sont classés « non décodables » sans appel à la base.
create or replace function public.stock_specs_pending(p_limit int)
returns table(vehicle_id bigint, vin text)
language plpgsql security definer set search_path = public as $$
begin
  insert into vehicle_specs(vehicle_id, vin, status)
  select v.id, v.chassis, 'non_decodable' from vehicles v
  where v.deleted_at is null and not exists (select 1 from vehicle_specs s where s.vehicle_id = v.id)
    and (length(v.chassis) <> 17 or v.chassis ~ '[IOQ]' or v.chassis !~ '^[A-Z0-9]+$')
  on conflict (vehicle_id) do nothing;
  return query
    select v.id, v.chassis from vehicles v left join vehicle_specs s on s.vehicle_id = v.id
    where v.deleted_at is null and length(v.chassis) = 17 and v.chassis !~ '[IOQ]'
      and (s.vehicle_id is null or (s.status = 'erreur' and s.attempts < 5))
    order by (v.current_parc_id is null), v.id desc
    limit greatest(1, least(p_limit, 1000));
end $$;

-- Vue de recherche : véhicule (tel que déclaré) + caractéristiques d'après le châssis + parc actuel
create or replace view public.v_vehicle_specs as
  select v.id, v.chassis, v.marque, v.modele, v.annee, v.navire, v.manifeste, v.bl, v.importateur, v.date_arrivee, v.date_transfert,
    v.mmte_depot_date, v.current_parc_id, p.name as parc,
    s.status, s.make, s.model, s.model_year, s.series, s.vehicle_type, s.body_class, s.doors, s.fuel, s.fuel2, s.electrification, s.energie,
    s.displacement_l, s.cylinders, s.hp, s.drive, s.transmission, s.plant_country, s.plant_city, s.plant_company, s.manufacturer, s.gvwr,
    s.error_code, s.decoded_at
  from vehicles v
  join vehicle_specs s on s.vehicle_id = v.id
  left join parcs p on p.id = v.current_parc_id
  where v.deleted_at is null;
revoke all on public.v_vehicle_specs from anon, authenticated;

-- Couverture et listes de choix des filtres (avec effectifs)
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
    'types', coalesce((select jsonb_agg(jsonb_build_object('v', vehicle_type, 'n', n) order by n desc) from (select vehicle_type, count(*) n from f where vehicle_type is not null group by 1) x), '[]'),
    'carrosseries', coalesce((select jsonb_agg(jsonb_build_object('v', body_class, 'n', n) order by n desc) from (select body_class, count(*) n from f where body_class is not null group by 1) x), '[]'),
    'transmissions', coalesce((select jsonb_agg(jsonb_build_object('v', drive, 'n', n) order by n desc) from (select drive, count(*) n from f where drive is not null group by 1) x), '[]'),
    'energies', coalesce((select jsonb_agg(jsonb_build_object('v', energie, 'n', n) order by n desc) from (select energie, count(*) n from f where energie is not null group by 1) x), '[]')
  );
$$;

revoke all on function public.stock_specs_pending(int), public.stock_specs_overview() from public, anon, authenticated;
grant execute on function public.stock_specs_pending(int), public.stock_specs_overview() to service_role;

-- Reprise chaque nuit (1 h à 5 h, heure du Bénin = 0 h à 4 h UTC) : jusqu'à 300 châssis par passage, 5 passages
create extension if not exists pg_net;
create extension if not exists pg_cron;
do $$
begin
  perform cron.unschedule('specs-nuit') where exists (select 1 from cron.job where jobname = 'specs-nuit');
  perform cron.schedule('specs-nuit', '15 0-4 * * *', $cron$
    select net.http_post(
      url := 'https://hrxldrhfqyxyzsetlamc.supabase.co/functions/v1/stock-api',
      body := jsonb_build_object('action', 'specs_cron', 'key', (select value from public.stock_secrets where key = 'cron')),
      headers := '{"Content-Type": "application/json"}'::jsonb,
      timeout_milliseconds := 120000)
  $cron$);
end $$;
