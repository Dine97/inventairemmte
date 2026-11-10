-- 6.13.0 — Carte d'identité des parcs, agréments, rapports d'inventaire, parcs tampon uniques (PTU), suivis personnels.
-- Décisions du 10/11/2026 :
--  * l'identité d'un parc, ses agréments et ses rapports ne sont modifiables que par un administrateur ;
--  * rappel des agréments 30 jours avant l'échéance par défaut (réglable) ;
--  * les PTU (RORO TERMINAL BÉNIN, BÉNIN MANUTENTIONS) n'envoient jamais de stock : leur stock vient des manifestes,
--    un véhicule quitte automatiquement le PTU dès qu'il apparaît dans un parc, ou par « enlèvement direct » saisi ;
--  * le suivi de véhicules et le décodage du VIN ne modifient jamais le stock.

-- ---------- Identité du parc ----------
alter table public.parcs
  add column if not exists type text not null default 'parc',
  add column if not exists zone text,
  add column if not exists adresse text,
  add column if not exists chef_parc_nom text,
  add column if not exists chef_parc_tel text,
  add column if not exists chef_trafic_nom text,
  add column if not exists chef_trafic_tel text,
  add column if not exists gps_lat double precision,
  add column if not exists gps_lng double precision,
  add column if not exists gps_at timestamptz,
  add column if not exists gps_by text,
  add column if not exists photo_path text,
  add column if not exists identite_at timestamptz,
  add column if not exists identite_by text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'parcs_type_check') then
    alter table public.parcs add constraint parcs_type_check check (type in ('parc', 'ptu'));
  end if;
end $$;

-- Les deux parcs tampon uniques du port
update public.parcs set type = 'ptu', suivi_hebdo = false
where deleted_at is null and (name like 'RORO TERMINAL%' or name in ('BENIN MANUTENTIONS', 'BÉNIN MANUTENTIONS'));

-- ---------- Agréments (un an renouvelable) ----------
create table if not exists public.parc_agrements (
  id bigserial primary key,
  parc_id bigint not null references public.parcs(id) on delete cascade,
  numero text,
  date_emission date not null,
  date_echeance date not null,
  file_path text, file_name text, file_type text, file_size int,
  note text,
  created_by text, created_at timestamptz not null default now(),
  updated_by text, updated_at timestamptz,
  deleted_at timestamptz,
  check (date_echeance >= date_emission)
);
create index if not exists parc_agrements_parc_idx on public.parc_agrements(parc_id, date_echeance desc) where deleted_at is null;
alter table public.parc_agrements enable row level security;
revoke all on public.parc_agrements from anon, authenticated;

-- ---------- Rapports d'inventaire joints ----------
create table if not exists public.parc_rapports (
  id bigserial primary key,
  parc_id bigint not null references public.parcs(id) on delete cascade,
  date_rapport date not null,
  type text,
  commentaire text,
  file_path text not null, file_name text, file_type text, file_size int,
  created_by text, created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists parc_rapports_parc_idx on public.parc_rapports(parc_id, date_rapport desc) where deleted_at is null;
alter table public.parc_rapports enable row level security;
revoke all on public.parc_rapports from anon, authenticated;

-- Stockage privé des photos de façade, agréments et rapports (accès par lien signé de 10 minutes)
insert into storage.buckets (id, name, public, file_size_limit)
values ('parcs', 'parcs', false, 15728640)
on conflict (id) do nothing;

-- ---------- Manifestes reçus par les PTU ----------
create table if not exists public.ptu_manifestes (
  id bigserial primary key,
  ptu_id bigint not null references public.parcs(id),
  numero text not null,
  navire text,
  date_arrivee date not null,
  file_name text,
  nb int not null default 0,
  batch_id bigint,
  comment text,
  created_by text, created_at timestamptz not null default now(),
  cancelled_at timestamptz, cancelled_by text
);
create index if not exists ptu_manifestes_ptu_idx on public.ptu_manifestes(ptu_id, date_arrivee desc);
alter table public.ptu_manifestes enable row level security;
revoke all on public.ptu_manifestes from anon, authenticated;

-- ---------- Suivis personnels (bouton « Suivre ») ----------
create table if not exists public.stock_suivis (
  id bigserial primary key,
  owner_uid text not null,
  vehicle_id bigint not null references public.vehicles(id) on delete cascade,
  liste text not null default 'Mes véhicules',
  created_at timestamptz not null default now(),
  unique (owner_uid, vehicle_id, liste)
);
create index if not exists stock_suivis_owner_idx on public.stock_suivis(owner_uid);
create table if not exists public.stock_suivi_vu (
  owner_uid text primary key,
  vu_at timestamptz not null default now()
);
alter table public.stock_suivis enable row level security;
alter table public.stock_suivi_vu enable row level security;
revoke all on public.stock_suivis, public.stock_suivi_vu from anon, authenticated;

-- ---------- Paramètres par défaut ----------
insert into public.settings(key, value, updated_by) values
  ('seuil_agrement', '30', 'Migration 016'),
  ('delai_ptu', '15', 'Migration 016'),
  ('zones', '["Sèkandji", "MIVVO", "RITIS"]', 'Migration 016'),
  ('types_rapport', '["Inventaire annuel", "Inventaire inopiné", "Contrôle de routine", "Autre"]', 'Migration 016'),
  ('modules_masques', '[]', 'Migration 016'),
  ('droits', '{}', 'Migration 016'),
  ('identite_visible', '"tous"', 'Migration 016')
on conflict (key) do nothing;

-- ---------- Mouvements automatiques des PTU ----------
-- Recalcule, pour les véhicules donnés :
--  * une entrée en PTU est toujours une entrée (jamais un transfert) ;
--  * une arrivée en parc depuis un PTU est une entrée (le PTU reste noté comme provenance) ;
--  * le séjour au PTU se ferme automatiquement à la première entrée dans un parc (tolérance de 7 jours sur les dates),
--    et se rouvre si cette entrée disparaît (import annulé) ; un enlèvement direct saisi n'est jamais touché.
create or replace function public.stock_ptu_sync(p_ids bigint[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_ids is null or cardinality(p_ids) = 0 or not exists (select 1 from parcs where type = 'ptu') then return; end if;

  update stays s set entry_kind = 'entree', from_parc_id = null, updated_at = now()
  from parcs p where p.id = s.parc_id and p.type = 'ptu' and s.vehicle_id = any(p_ids) and s.entry_kind = 'transfert';

  with c as (
    select s.id, s.entry_date as e0, n.entry_date as ne, n.parc_id as np
    from stays s join parcs p on p.id = s.parc_id and p.type = 'ptu'
    left join lateral (
      select x.entry_date, x.parc_id from stays x join parcs px on px.id = x.parc_id and px.type <> 'ptu'
      where x.vehicle_id = s.vehicle_id and x.deleted_at is null and x.entry_date >= s.entry_date - 7
      order by x.entry_date, x.id limit 1) n on true
    where s.vehicle_id = any(p_ids) and s.deleted_at is null
      and (s.exit_date is null or s.justif_by = 'Automatique (arrivée en parc)')
  )
  update stays s set
    exit_date = case when c.np is null then null else greatest(c.ne, c.e0) end,
    exit_kind = case when c.np is null then null else 'transfert' end,
    exit_import_id = null,
    to_parc_id = c.np,
    justif_type = case when c.np is null then null else 'Transfert vers un parc' end,
    justif_status = case when c.np is null then 'non_justifiee' else 'justifiee' end,
    justif_by = case when c.np is null then null else 'Automatique (arrivée en parc)' end,
    justif_at = case when c.np is null then null else coalesce(s.justif_at, now()) end,
    updated_at = now()
  from c
  where s.id = c.id
    and (s.to_parc_id is distinct from c.np
      or s.exit_date is distinct from (case when c.np is null then null else greatest(c.ne, c.e0) end));

  update stays x set entry_kind = case when x.entry_kind = 'transfert' then 'entree' else x.entry_kind end,
    from_parc_id = s.parc_id, updated_at = now()
  from stays s join parcs p on p.id = s.parc_id and p.type = 'ptu'
  where s.vehicle_id = any(p_ids) and s.deleted_at is null and s.justif_by = 'Automatique (arrivée en parc)'
    and x.vehicle_id = s.vehicle_id and x.parc_id = s.to_parc_id and x.deleted_at is null
    and x.entry_date >= s.entry_date - 7 and x.entry_date <= s.exit_date
    and (x.entry_kind = 'transfert' or x.from_parc_id is distinct from s.parc_id) and x.entry_kind <> 'initial';
end $$;

-- Appelé par tous les traitements (import, saisie, reconstruction, annulation) après chaque changement
create or replace function public.stock_recompute_current(p_vehicle_ids bigint[])
returns void language plpgsql security definer set search_path = public as $$
begin
  perform stock_ptu_sync(p_vehicle_ids);
  update vehicles v set current_parc_id = (
    select s.parc_id from stays s
    where s.vehicle_id = v.id and s.exit_date is null and s.deleted_at is null
    order by s.entry_date desc, s.id desc limit 1)
  where v.id = any(p_vehicle_ids);
end $$;

-- Synthèse par manifeste d'un PTU
create or replace function public.stock_ptu_manifestes(p_ptu bigint)
returns table(id bigint, ptu_id bigint, ptu text, numero text, navire text, date_arrivee date, file_name text, created_by text, created_at timestamptz,
  manifestes int, en_parc int, enleves int, au_ptu int, au_ptu_depuis_max int)
language sql stable security definer set search_path = public as $$
  select m.id, m.ptu_id, p.name, m.numero, m.navire, m.date_arrivee, m.file_name, m.created_by, m.created_at,
    count(distinct mv.vehicle_id)::int,
    count(distinct mv.vehicle_id) filter (where s.exit_kind = 'transfert')::int,
    count(distinct mv.vehicle_id) filter (where s.exit_kind in ('sortie', 'manuel'))::int,
    count(distinct mv.vehicle_id) filter (where s.id is not null and s.exit_date is null)::int,
    max(current_date - s.entry_date) filter (where s.id is not null and s.exit_date is null)::int
  from ptu_manifestes m
  join parcs p on p.id = m.ptu_id
  left join stock_moves mv on mv.batch_id = m.batch_id and mv.cancelled_at is null
  left join lateral (select x.* from stays x where x.vehicle_id = mv.vehicle_id and x.parc_id = m.ptu_id and x.deleted_at is null
                     order by x.entry_date desc, x.id desc limit 1) s on true
  where m.cancelled_at is null and (p_ptu is null or m.ptu_id = p_ptu)
  group by m.id, p.name
  order by m.date_arrivee desc, m.id desc;
$$;

-- Véhicules d'un manifeste (ou de tous les manifestes d'un PTU) avec leur devenir
create or replace function public.stock_ptu_vehicules(p_manifeste bigint, p_ptu bigint)
returns table(manifeste_id bigint, numero_manifeste text, vehicle_id bigint, chassis text, marque text, modele text, annee text, navire text, bl text,
  importateur text, date_arrivee date, entree_ptu date, sortie_ptu date, devenir text, parc_id bigint, parc text, justif_numero text, jours int)
language sql stable security definer set search_path = public as $$
  select m.id, m.numero, v.id, v.chassis, v.marque, v.modele, v.annee, v.navire, v.bl, v.importateur, v.date_arrivee,
    s.entry_date, s.exit_date,
    case when s.id is null then 'inconnu' when s.exit_date is null then 'au_ptu' when s.exit_kind = 'transfert' then 'en_parc' else 'enleve' end,
    s.to_parc_id, tp.name, s.justif_numero,
    (coalesce(s.exit_date, current_date) - s.entry_date)::int
  from ptu_manifestes m
  join stock_moves mv on mv.batch_id = m.batch_id and mv.cancelled_at is null
  join vehicles v on v.id = mv.vehicle_id and v.deleted_at is null
  left join lateral (select x.* from stays x where x.vehicle_id = v.id and x.parc_id = m.ptu_id and x.deleted_at is null
                     order by x.entry_date desc, x.id desc limit 1) s on true
  left join parcs tp on tp.id = s.to_parc_id
  where m.cancelled_at is null and (p_manifeste is null or m.id = p_manifeste) and (p_ptu is null or m.ptu_id = p_ptu)
  order by m.date_arrivee desc, v.chassis;
$$;

revoke all on function public.stock_ptu_sync(bigint[]), public.stock_recompute_current(bigint[]),
  public.stock_ptu_manifestes(bigint), public.stock_ptu_vehicules(bigint, bigint) from public, anon, authenticated;
grant execute on function public.stock_ptu_sync(bigint[]), public.stock_recompute_current(bigint[]),
  public.stock_ptu_manifestes(bigint), public.stock_ptu_vehicules(bigint, bigint) to service_role;
