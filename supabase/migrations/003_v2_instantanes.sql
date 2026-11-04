-- STOCK MMTE v2 : instantanés d'import, reconstruction, verrous, MMTE, accès, rapports
create extension if not exists fuzzystrmatch with schema extensions;

alter table public.vehicles
  add column if not exists locked_fields text[] not null default '{}',
  add column if not exists mmte_depot_date date,
  add column if not exists mmte_entry_date date,
  add column if not exists mmte_registred_at date,
  add column if not exists mmte_data jsonb,
  add column if not exists mmte_sync_at timestamptz;

create table if not exists public.import_items (
  import_id bigint not null references public.imports(id) on delete cascade,
  vehicle_id bigint not null references public.vehicles(id) on delete cascade,
  row jsonb not null,
  primary key (import_id, vehicle_id)
);
create index if not exists import_items_vehicle_idx on public.import_items (vehicle_id);

create table if not exists public.chassis_aliases (
  alias text primary key,
  chassis text not null,
  created_at timestamptz not null default now(),
  created_by text
);

create table if not exists public.stock_users (
  uid text primary key,
  email text, name text,
  access text not null default 'agent' check (access in ('aucun','consultation','agent')),
  last_seen timestamptz,
  updated_at timestamptz not null default now(),
  updated_by text
);

create table if not exists public.saved_filters (
  id bigserial primary key,
  owner_uid text not null, owner_name text,
  name text not null,
  params jsonb not null,
  shared boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.import_items enable row level security;
alter table public.chassis_aliases enable row level security;
alter table public.stock_users enable row level security;
alter table public.saved_filters enable row level security;
revoke all on public.import_items, public.chassis_aliases, public.stock_users, public.saved_filters from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

insert into public.settings(key, value) values ('acces_par_defaut', '"agent"'), ('source_depot', '"parc"')
on conflict (key) do nothing;

create or replace view public.v_stays with (security_invoker = on) as
select s.id as stay_id, s.vehicle_id, s.parc_id, p.name as parc,
       s.entry_import_id, s.entry_date, s.entry_kind, s.from_parc_id, fp.name as from_parc,
       s.exit_import_id, s.exit_date, s.exit_kind, s.to_parc_id, tp.name as to_parc,
       s.justif_type, s.justif_numero, s.justif_date, s.justif_bureau, s.justif_note, s.justif_files,
       s.justif_status, s.justif_by, s.justif_at, s.valide_by, s.valide_at, s.raw,
       v.chassis, v.chassis_raw, v.marque, v.modele, v.annee, v.navire, v.manifeste, v.bl,
       v.date_arrivee, v.date_transfert, v.importateur, v.notes, v.current_parc_id, v.mmte_depot_date
from public.stays s
join public.vehicles v on v.id = s.vehicle_id and v.deleted_at is null
join public.parcs p on p.id = s.parc_id
left join public.parcs fp on fp.id = s.from_parc_id
left join public.parcs tp on tp.id = s.to_parc_id
where s.deleted_at is null;
revoke all on public.v_stays from anon, authenticated;

-- ---------------------------------------------------------------
-- Application d'un import (instantané déjà enregistré) au parc
-- ---------------------------------------------------------------
create or replace function public.stock_apply_import(p_imp bigint)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  imp imports%rowtype; v_parc bigint; v_date date; v_first boolean; v_win int;
  v_entrees int := 0; v_sorties int := 0; v_transf int := 0; v_side jsonb := '[]'; v_ids bigint[]; rec record;
begin
  select * into imp from imports where id = p_imp;
  v_parc := imp.parc_id; v_date := imp.stock_date;
  v_first := not exists (select 1 from imports where parc_id = v_parc and status = 'valide' and id <> p_imp
                         and (stock_date < v_date or (stock_date = v_date and id < p_imp)));
  select coalesce((value)::int, 30) into v_win from settings where key = 'fenetre_transfert';
  v_win := coalesce(v_win, 30);

  drop table if exists t_rows;
  create temp table t_rows on commit drop as
    select vehicle_id, coalesce(row->'data', '{}'::jsonb) as data from import_items where import_id = p_imp;

  update stays s set last_import_id = p_imp, raw = t.data, updated_at = now()
  from t_rows t where s.vehicle_id = t.vehicle_id and s.parc_id = v_parc and s.exit_date is null and s.deleted_at is null;

  -- Sorties
  for rec in
    select s.id, s.vehicle_id,
      (select s2.parc_id from stays s2 where s2.vehicle_id = s.vehicle_id and s2.parc_id <> v_parc
         and s2.exit_date is null and s2.deleted_at is null order by s2.entry_date desc limit 1) as other_parc
    from stays s
    where s.parc_id = v_parc and s.exit_date is null and s.deleted_at is null and s.entry_date <= v_date
      and s.vehicle_id not in (select vehicle_id from t_rows)
  loop
    update stays set exit_date = v_date, exit_import_id = p_imp,
      exit_kind = case when rec.other_parc is not null then 'transfert' else 'sortie' end,
      to_parc_id = rec.other_parc,
      justif_type = case when rec.other_parc is not null then 'Transfert' else justif_type end,
      justif_status = case when rec.other_parc is not null then 'justifiee' else justif_status end,
      justif_by = case when rec.other_parc is not null then 'Automatique (transfert détecté)' else justif_by end,
      justif_at = case when rec.other_parc is not null then now() else justif_at end,
      updated_at = now()
    where id = rec.id;
    if rec.other_parc is not null then v_transf := v_transf + 1; else v_sorties := v_sorties + 1; end if;
  end loop;

  -- Entrées
  for rec in
    select t.vehicle_id, t.data,
      (select s2.parc_id from stays s2 where s2.vehicle_id = t.vehicle_id and s2.exit_date is null and s2.deleted_at is null
         and s2.parc_id <> v_parc order by s2.entry_date desc limit 1) as open_parc,
      (select s3.id from stays s3 where s3.vehicle_id = t.vehicle_id and s3.exit_kind = 'sortie' and s3.deleted_at is null
         and s3.exit_date >= v_date - v_win and s3.exit_date <= v_date and s3.parc_id <> v_parc order by s3.exit_date desc limit 1) as recent_exit
    from t_rows t
    where not exists (select 1 from stays s where s.vehicle_id = t.vehicle_id and s.parc_id = v_parc
                      and s.exit_date is null and s.deleted_at is null)
  loop
    if v_first or rec.open_parc is not null or rec.recent_exit is not null then
      insert into stays(vehicle_id, parc_id, entry_import_id, entry_date, entry_kind, last_import_id, raw, from_parc_id)
      values (rec.vehicle_id, v_parc, p_imp, v_date, case when v_first then 'initial' else 'transfert' end, p_imp, rec.data,
              coalesce(rec.open_parc, (select parc_id from stays where id = rec.recent_exit)));
      if not v_first then v_entrees := v_entrees + 1; end if;
      if rec.recent_exit is not null and rec.open_parc is null then
        v_side := v_side || jsonb_build_array((select jsonb_build_object('stay_id', id, 'exit_kind', exit_kind, 'to_parc_id', to_parc_id,
                   'justif_type', justif_type, 'justif_status', justif_status, 'justif_by', justif_by) from stays where id = rec.recent_exit));
        update stays set exit_kind = 'transfert', to_parc_id = v_parc,
          justif_type = coalesce(justif_type, 'Transfert'),
          justif_status = case when justif_status = 'non_justifiee' then 'justifiee' else justif_status end,
          justif_by = coalesce(justif_by, 'Automatique (transfert détecté)'), justif_at = coalesce(justif_at, now()), updated_at = now()
        where id = rec.recent_exit;
      end if;
    else
      insert into stays(vehicle_id, parc_id, entry_import_id, entry_date, entry_kind, last_import_id, raw)
      values (rec.vehicle_id, v_parc, p_imp, v_date, 'entree', p_imp, rec.data);
      v_entrees := v_entrees + 1;
    end if;
  end loop;

  select array_agg(distinct vehicle_id) into v_ids from (
    select vehicle_id from t_rows union select vehicle_id from stays where exit_import_id = p_imp) z;
  perform stock_recompute_current(coalesce(v_ids, '{}'));

  update imports set nb_chassis = (select count(*) from t_rows), nb_entrees = v_entrees, nb_sorties = v_sorties,
         nb_transferts = v_transf, side_effects = v_side, is_initial = v_first
  where id = p_imp;
  return jsonb_build_object('is_initial', v_first, 'nb_chassis', (select count(*) from t_rows),
    'entrees', v_entrees, 'sorties', v_sorties, 'transferts', v_transf);
end $$;

-- ---------------------------------------------------------------
-- Reconstruction complète de l'historique d'un parc (rejoue les instantanés)
-- ---------------------------------------------------------------
create or replace function public.stock_rebuild_parc(p_parc bigint)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare r record; e jsonb; j record; v_ids bigint[];
begin
  perform pg_advisory_xact_lock(p_parc);
  for r in select id, side_effects from imports where parc_id = p_parc and side_effects <> '[]'::jsonb order by stock_date desc, id desc loop
    for e in select * from jsonb_array_elements(r.side_effects) loop
      update stays set exit_kind = e->>'exit_kind', to_parc_id = nullif(e->>'to_parc_id','')::bigint,
        justif_type = e->>'justif_type', justif_status = coalesce(e->>'justif_status', 'non_justifiee'), justif_by = e->>'justif_by', updated_at = now()
      where id = (e->>'stay_id')::bigint;
    end loop;
    update imports set side_effects = '[]' where id = r.id;
  end loop;

  drop table if exists t_j;
  create temp table t_j on commit drop as
    select vehicle_id, exit_date, justif_type, justif_numero, justif_date, justif_bureau, justif_note, justif_files,
           justif_status, justif_by, justif_at, valide_by, valide_at
    from stays where parc_id = p_parc and entry_kind <> 'manuel' and exit_date is not null and deleted_at is null
      and (justif_status <> 'non_justifiee' or jsonb_array_length(justif_files) > 0)
      and coalesce(justif_by, '') <> 'Automatique (transfert détecté)';
  select array_agg(distinct vehicle_id) into v_ids from stays where parc_id = p_parc;

  delete from stays where parc_id = p_parc and entry_kind <> 'manuel';
  update stays set exit_date = null, exit_import_id = null, exit_kind = null, to_parc_id = null
  where parc_id = p_parc and entry_kind = 'manuel' and exit_import_id is not null;

  for r in select id from imports where parc_id = p_parc and status = 'valide' order by stock_date, id loop
    perform stock_apply_import(r.id);
  end loop;

  for j in select * from t_j loop
    update stays set justif_type = j.justif_type, justif_numero = j.justif_numero, justif_date = j.justif_date,
      justif_bureau = j.justif_bureau, justif_note = j.justif_note, justif_files = j.justif_files,
      justif_status = j.justif_status, justif_by = j.justif_by, justif_at = j.justif_at, valide_by = j.valide_by, valide_at = j.valide_at
    where id = (select id from stays where vehicle_id = j.vehicle_id and parc_id = p_parc and exit_date is not null and deleted_at is null
                order by abs(exit_date - j.exit_date), id limit 1);
  end loop;
  perform stock_recompute_current(coalesce(v_ids, '{}') || coalesce((select array_agg(distinct vehicle_id) from stays where parc_id = p_parc), '{}'));
end $$;

-- Champs des véhicules d'après le dernier import valide (hors champs verrouillés)
create or replace function public.stock_refresh_vehicles(p_ids bigint[])
returns void language sql security definer set search_path = public as $$
  update vehicles v set
    chassis_raw = case when 'chassis_raw' = any(v.locked_fields) then v.chassis_raw else coalesce(nullif(lr.row->>'chassis_raw',''), v.chassis_raw) end,
    marque = case when 'marque' = any(v.locked_fields) then v.marque else coalesce(nullif(lr.row->>'marque',''), v.marque) end,
    modele = case when 'modele' = any(v.locked_fields) then v.modele else coalesce(nullif(lr.row->>'modele',''), v.modele) end,
    annee = case when 'annee' = any(v.locked_fields) then v.annee else coalesce(nullif(lr.row->>'annee',''), v.annee) end,
    navire = case when 'navire' = any(v.locked_fields) then v.navire else coalesce(nullif(lr.row->>'navire',''), v.navire) end,
    manifeste = case when 'manifeste' = any(v.locked_fields) then v.manifeste else coalesce(nullif(lr.row->>'manifeste',''), v.manifeste) end,
    bl = case when 'bl' = any(v.locked_fields) then v.bl else coalesce(nullif(lr.row->>'bl',''), v.bl) end,
    date_arrivee = case when 'date_arrivee' = any(v.locked_fields) then v.date_arrivee else coalesce(nullif(lr.row->>'date_arrivee','')::date, v.date_arrivee) end,
    date_transfert = case when 'date_transfert' = any(v.locked_fields) then v.date_transfert else coalesce(nullif(lr.row->>'date_transfert','')::date, v.date_transfert) end,
    importateur = case when 'importateur' = any(v.locked_fields) then v.importateur else coalesce(nullif(lr.row->>'importateur',''), v.importateur) end,
    updated_at = now()
  from (select distinct on (ii.vehicle_id) ii.vehicle_id, ii.row from import_items ii join imports i on i.id = ii.import_id
        where i.status = 'valide' and ii.vehicle_id = any(p_ids) order by ii.vehicle_id, i.stock_date desc, i.id desc) lr
  where v.id = lr.vehicle_id;
$$;

-- ---------------------------------------------------------------
-- Import : enregistre l'instantané puis l'applique (ou reconstruit si fichier en retard)
-- ---------------------------------------------------------------
create or replace function public.stock_commit_import(p jsonb)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_parc bigint; v_date date := (p->>'stock_date')::date; v_last date; v_imp bigint; v_late boolean; res jsonb;
begin
  if v_date is null then raise exception 'DATE_STOCK_MANQUANTE'; end if;
  v_parc := stock_parc_id(p->>'parc_name');
  perform pg_advisory_xact_lock(v_parc);
  select max(stock_date) into v_last from imports where parc_id = v_parc and status = 'valide';
  v_late := v_last is not null and v_date < v_last;

  insert into imports(parc_id, stock_date, file_name, file_size, sheets, header_row, mapping, declared, anomalies,
                      nb_lignes, comment, created_by_uid, created_by_name)
  values (v_parc, v_date, p->>'file_name', nullif(p->>'file_size','')::int,
          array(select jsonb_array_elements_text(coalesce(p->'sheets','[]'))), nullif(p->>'header_row','')::int,
          p->'mapping', p->'declared', coalesce(p->'anomalies','[]'),
          coalesce((p->>'nb_lignes')::int, 0), p->>'comment', p->>'by_uid', p->>'by_name')
  returning id into v_imp;

  drop table if exists t_in;
  create temp table t_in on commit drop as
    select distinct on (c) c as chassis, r from (
      select coalesce(a.chassis, upper(r->>'chassis')) as c, r
      from jsonb_array_elements(p->'rows') r
      left join chassis_aliases a on a.alias = upper(r->>'chassis')
      where coalesce(r->>'chassis','') <> '') z
    order by c;

  insert into vehicles as v (chassis, chassis_raw, marque, modele, annee, navire, manifeste, bl, date_arrivee, date_transfert, importateur, data)
  select chassis, r->>'chassis_raw', nullif(r->>'marque',''), nullif(r->>'modele',''), nullif(r->>'annee',''), nullif(r->>'navire',''),
         nullif(r->>'manifeste',''), nullif(r->>'bl',''), nullif(r->>'date_arrivee','')::date, nullif(r->>'date_transfert','')::date,
         nullif(r->>'importateur',''), coalesce(r->'data','{}'::jsonb)
  from t_in
  on conflict (chassis) do update set
    chassis_raw = case when 'chassis_raw' = any(v.locked_fields) then v.chassis_raw else coalesce(excluded.chassis_raw, v.chassis_raw) end,
    marque = case when 'marque' = any(v.locked_fields) then v.marque else coalesce(excluded.marque, v.marque) end,
    modele = case when 'modele' = any(v.locked_fields) then v.modele else coalesce(excluded.modele, v.modele) end,
    annee = case when 'annee' = any(v.locked_fields) then v.annee else coalesce(excluded.annee, v.annee) end,
    navire = case when 'navire' = any(v.locked_fields) then v.navire else coalesce(excluded.navire, v.navire) end,
    manifeste = case when 'manifeste' = any(v.locked_fields) then v.manifeste else coalesce(excluded.manifeste, v.manifeste) end,
    bl = case when 'bl' = any(v.locked_fields) then v.bl else coalesce(excluded.bl, v.bl) end,
    date_arrivee = case when 'date_arrivee' = any(v.locked_fields) then v.date_arrivee else coalesce(excluded.date_arrivee, v.date_arrivee) end,
    date_transfert = case when 'date_transfert' = any(v.locked_fields) then v.date_transfert else coalesce(excluded.date_transfert, v.date_transfert) end,
    importateur = case when 'importateur' = any(v.locked_fields) then v.importateur else coalesce(excluded.importateur, v.importateur) end,
    data = v.data || excluded.data, deleted_at = null, updated_at = now();

  insert into import_items(import_id, vehicle_id, row)
  select v_imp, v.id, t.r from t_in t join vehicles v on v.chassis = t.chassis;

  if v_late then
    perform stock_rebuild_parc(v_parc);
    select jsonb_build_object('is_initial', is_initial, 'nb_chassis', nb_chassis, 'entrees', nb_entrees, 'sorties', nb_sorties,
                              'transferts', nb_transferts, 'reconstruit', true) into res from imports where id = v_imp;
  else
    res := stock_apply_import(v_imp);
  end if;
  return res || jsonb_build_object('import_id', v_imp, 'parc_id', v_parc);
end $$;

-- Annulation de n'importe quel import : l'historique du parc est reconstruit
create or replace function public.stock_cancel_import(p_import bigint, p_reason text, p_by text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare imp imports%rowtype; v_ids bigint[];
begin
  select * into imp from imports where id = p_import;
  if not found then raise exception 'IMPORT_INTROUVABLE'; end if;
  if imp.status <> 'valide' then raise exception 'IMPORT_DEJA_ANNULE'; end if;
  perform pg_advisory_xact_lock(imp.parc_id);
  select array_agg(vehicle_id) into v_ids from import_items where import_id = p_import;
  update imports set status = 'annule', cancel_reason = p_reason, cancelled_at = now(), cancelled_by = p_by where id = p_import;
  perform stock_rebuild_parc(imp.parc_id);
  perform stock_refresh_vehicles(coalesce(v_ids, '{}'));
  delete from vehicles v where v.id = any(coalesce(v_ids, '{}'))
    and not exists (select 1 from stays s where s.vehicle_id = v.id)
    and not exists (select 1 from import_items ii join imports i on i.id = ii.import_id where ii.vehicle_id = v.id and i.status = 'valide');
  return jsonb_build_object('ok', true);
end $$;

-- Réactivation d'un import annulé
create or replace function public.stock_restore_import(p_import bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare imp imports%rowtype; v_ids bigint[];
begin
  select * into imp from imports where id = p_import;
  if not found or imp.status <> 'annule' then raise exception 'IMPORT_NON_ANNULE'; end if;
  perform pg_advisory_xact_lock(imp.parc_id);
  update imports set status = 'valide', cancel_reason = null, cancelled_at = null, cancelled_by = null where id = p_import;
  perform stock_rebuild_parc(imp.parc_id);
  select array_agg(vehicle_id) into v_ids from import_items where import_id = p_import;
  perform stock_refresh_vehicles(coalesce(v_ids, '{}'));
  return jsonb_build_object('ok', true);
end $$;

-- Fusion d'un châssis mal saisi dans le bon véhicule (+ mémorisation de la faute)
create or replace function public.stock_merge_vehicles(p_from bigint, p_into bigint, p_by text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare vf vehicles%rowtype; vi vehicles%rowtype; r record;
begin
  select * into vf from vehicles where id = p_from;
  select * into vi from vehicles where id = p_into;
  if vf.id is null or vi.id is null or vf.id = vi.id then raise exception 'FUSION_IMPOSSIBLE'; end if;
  insert into chassis_aliases(alias, chassis, created_by) values (vf.chassis, vi.chassis, p_by)
  on conflict (alias) do update set chassis = excluded.chassis;
  update chassis_aliases set chassis = vi.chassis where chassis = vf.chassis;
  delete from import_items a where a.vehicle_id = p_from and exists (select 1 from import_items b where b.import_id = a.import_id and b.vehicle_id = p_into);
  update import_items set vehicle_id = p_into where vehicle_id = p_from;
  update stays set vehicle_id = p_into where vehicle_id = p_from;
  update vehicles set data = vi.data || vf.data, notes = concat_ws(' / ', vi.notes, 'Châssis mal saisi fusionné : ' || vf.chassis) where id = p_into;
  delete from vehicles where id = p_from;
  for r in select distinct s.parc_id from stays s where s.vehicle_id = p_into loop
    perform stock_rebuild_parc(r.parc_id);
  end loop;
  perform stock_recompute_current(array[p_into]);
  return jsonb_build_object('ok', true, 'alias', vf.chassis, 'chassis', vi.chassis);
end $$;

-- ---------------------------------------------------------------
-- Tableau de bord (date de dépôt : fichier du parc ou MMTE)
-- ---------------------------------------------------------------
create or replace function public.stock_dashboard(p_ref date, p_duree int, p_seuil int, p_mmte boolean)
returns table(parc_id bigint, parc text, active boolean, presents bigint, disponibles bigint, bientot bigint, depot bigint,
              sans_date bigint, last_import date, last_import_id bigint, last_entrees int, last_sorties int, last_transferts int,
              non_justifiees bigint)
language sql security definer set search_path = public as $$
  with o as (
    select s.parc_id,
      case when p_mmte and v.mmte_depot_date is not null then v.mmte_depot_date
           when v.date_arrivee is not null then v.date_arrivee + p_duree end as dep
    from stays s join vehicles v on v.id = s.vehicle_id and v.deleted_at is null
    where s.exit_date is null and s.deleted_at is null)
  select p.id, p.name, p.active,
    count(o.parc_id),
    count(o.parc_id) filter (where o.dep > p_ref + p_seuil),
    count(o.parc_id) filter (where o.dep > p_ref and o.dep <= p_ref + p_seuil),
    count(o.parc_id) filter (where o.dep <= p_ref),
    count(o.parc_id) filter (where o.dep is null),
    li.stock_date, li.id, li.nb_entrees, li.nb_sorties, li.nb_transferts,
    (select count(*) from stays x where x.parc_id = p.id and x.deleted_at is null and x.exit_kind = 'sortie' and x.justif_status = 'non_justifiee')
  from parcs p
  left join o on o.parc_id = p.id
  left join lateral (select i.* from imports i where i.parc_id = p.id and i.status = 'valide'
                     order by i.stock_date desc, i.id desc limit 1) li on true
  where p.deleted_at is null
  group by p.id, p.name, p.active, li.stock_date, li.id, li.nb_entrees, li.nb_sorties, li.nb_transferts
  order by p.name;
$$;

-- Rapport de période (par parc)
create or replace function public.stock_report(p_from date, p_to date, p_duree int, p_seuil int, p_mmte boolean)
returns table(parc_id bigint, parc text, stock_debut bigint, stock_initial bigint, entrees bigint, sorties bigint, transferts bigint,
              stock_fin bigint, disponibles bigint, bientot bigint, depot bigint, sans_date bigint, nb_imports bigint,
              dernier_import date, non_justifiees bigint)
language sql security definer set search_path = public as $$
  select p.id, p.name,
    (select count(*) from stays s where s.parc_id = p.id and s.deleted_at is null and s.entry_date < p_from and (s.exit_date is null or s.exit_date >= p_from)),
    (select count(*) from stays s where s.parc_id = p.id and s.deleted_at is null and s.entry_kind = 'initial' and s.entry_date between p_from and p_to),
    (select count(*) from stays s where s.parc_id = p.id and s.deleted_at is null and s.entry_kind in ('entree','transfert','manuel') and s.entry_date between p_from and p_to),
    (select count(*) from stays s where s.parc_id = p.id and s.deleted_at is null and s.exit_kind in ('sortie','erreur','manuel') and s.exit_date between p_from and p_to),
    (select count(*) from stays s where s.parc_id = p.id and s.deleted_at is null and s.exit_kind = 'transfert' and s.exit_date between p_from and p_to),
    f.n, f.dispo, f.bientot, f.depot, f.sans,
    (select count(*) from imports i where i.parc_id = p.id and i.status = 'valide' and i.stock_date between p_from and p_to),
    (select max(i.stock_date) from imports i where i.parc_id = p.id and i.status = 'valide' and i.stock_date <= p_to),
    (select count(*) from stays s where s.parc_id = p.id and s.deleted_at is null and s.exit_kind = 'sortie' and s.justif_status = 'non_justifiee' and s.exit_date between p_from and p_to)
  from parcs p
  left join lateral (
    select count(*) n, count(*) filter (where dep > p_to + p_seuil) dispo,
           count(*) filter (where dep > p_to and dep <= p_to + p_seuil) bientot,
           count(*) filter (where dep <= p_to) depot, count(*) filter (where dep is null) sans
    from (select case when p_mmte and v.mmte_depot_date is not null then v.mmte_depot_date
                      when v.date_arrivee is not null then v.date_arrivee + p_duree end as dep
          from stays s join vehicles v on v.id = s.vehicle_id and v.deleted_at is null
          where s.parc_id = p.id and s.deleted_at is null and s.entry_date <= p_to and (s.exit_date is null or s.exit_date > p_to)) x
  ) f on true
  where p.deleted_at is null
  order by p.name;
$$;

-- Évolution hebdomadaire (un parc ou tous)
create or replace function public.stock_history(p_parc bigint, p_ref date, p_weeks int)
returns table(d date, stock bigint, entrees bigint, sorties bigint)
language sql security definer set search_path = public as $$
  select g::date,
    (select count(*) from stays s where (p_parc is null or s.parc_id = p_parc) and s.deleted_at is null and s.entry_date <= g::date and (s.exit_date is null or s.exit_date > g::date)),
    (select count(*) from stays s where (p_parc is null or s.parc_id = p_parc) and s.deleted_at is null and s.entry_kind in ('entree','transfert','manuel') and s.entry_date > g::date - 7 and s.entry_date <= g::date),
    (select count(*) from stays s where (p_parc is null or s.parc_id = p_parc) and s.deleted_at is null and s.exit_kind is not null and s.exit_date > g::date - 7 and s.exit_date <= g::date)
  from generate_series((p_ref - (greatest(p_weeks, 1) - 1) * 7)::timestamp, p_ref::timestamp, interval '7 day') g;
$$;

-- Centre des anomalies
create or replace function public.stock_anomalies(p_duree int, p_ecart int default 3)
returns jsonb language sql security definer set search_path = public, extensions as $$
  select jsonb_build_object(
    'multi_parcs', coalesce((select jsonb_agg(x) from (
        select v.id as vehicle_id, v.chassis, string_agg(p.name, ', ' order by s.entry_date) as parcs, count(*) as n
        from stays s join vehicles v on v.id = s.vehicle_id and v.deleted_at is null join parcs p on p.id = s.parc_id
        where s.exit_date is null and s.deleted_at is null group by v.id, v.chassis having count(*) > 1 limit 500) x), '[]'),
    'reapparus', coalesce((select jsonb_agg(x) from (
        select v.id as vehicle_id, v.chassis, ps.name as parc_sortie, s1.exit_date, pe.name as parc_entree, s2.entry_date
        from stays s1 join stays s2 on s2.vehicle_id = s1.vehicle_id and s2.entry_date > s1.exit_date and s2.entry_kind = 'entree'
        join vehicles v on v.id = s1.vehicle_id and v.deleted_at is null
        join parcs ps on ps.id = s1.parc_id join parcs pe on pe.id = s2.parc_id
        where s1.exit_kind = 'sortie' and s1.deleted_at is null and s2.deleted_at is null order by s2.entry_date desc limit 500) x), '[]'),
    'proches', coalesce((select jsonb_agg(x) from (
        select p.name as parc, ve.id as entree_id, ve.chassis as entree, vx.id as sortie_id, vx.chassis as sortie, e.entry_date as date,
               extensions.levenshtein(ve.chassis, vx.chassis) as distance
        from stays e join stays x on x.exit_import_id = e.entry_import_id and x.parc_id = e.parc_id
        join vehicles ve on ve.id = e.vehicle_id and ve.deleted_at is null join vehicles vx on vx.id = x.vehicle_id and vx.deleted_at is null
        join parcs p on p.id = e.parc_id
        where e.entry_kind = 'entree' and x.exit_kind = 'sortie' and e.deleted_at is null and x.deleted_at is null
          and length(ve.chassis) <= 30 and length(vx.chassis) <= 30
          and extensions.levenshtein(ve.chassis, vx.chassis) <= 2 order by e.entry_date desc limit 500) x), '[]'),
    'sans_date', coalesce((select jsonb_agg(x) from (
        select v.id as vehicle_id, v.chassis, p.name as parc from stays s join vehicles v on v.id = s.vehicle_id and v.deleted_at is null
        join parcs p on p.id = s.parc_id where s.exit_date is null and s.deleted_at is null and v.date_arrivee is null order by p.name limit 1000) x), '[]'),
    'atypiques', coalesce((select jsonb_agg(x) from (
        select v.id as vehicle_id, v.chassis, p.name as parc from stays s join vehicles v on v.id = s.vehicle_id and v.deleted_at is null
        join parcs p on p.id = s.parc_id where s.exit_date is null and s.deleted_at is null
          and (length(v.chassis) <> 17 or v.chassis ~ '[IOQ]') order by p.name limit 1000) x), '[]'),
    'ecarts_mmte', coalesce((select jsonb_agg(x) from (
        select v.id as vehicle_id, v.chassis, p.name as parc, v.date_arrivee, v.date_arrivee + p_duree as depot_calcule, v.mmte_depot_date,
               (v.mmte_depot_date - (v.date_arrivee + p_duree)) as ecart
        from stays s join vehicles v on v.id = s.vehicle_id and v.deleted_at is null join parcs p on p.id = s.parc_id
        where s.exit_date is null and s.deleted_at is null and v.mmte_depot_date is not null and v.date_arrivee is not null
          and abs(v.mmte_depot_date - (v.date_arrivee + p_duree)) > p_ecart order by abs(v.mmte_depot_date - (v.date_arrivee + p_duree)) desc limit 1000) x), '[]')
  );
$$;

-- Contrôle croisé avec un export MMTE
create or replace function public.stock_mmte_sync(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_parc bigint; v_duree int; res jsonb;
begin
  select coalesce((value)::int, 365) into v_duree from settings where key = 'duree_sejour';
  if coalesce(p->>'parc_name','') <> '' then select id into v_parc from parcs where name = upper(trim(p->>'parc_name')); end if;
  drop table if exists t_m;
  create temp table t_m on commit drop as
    select distinct on (c) c as chassis, nullif(r->>'depot','')::date as depot, nullif(r->>'entry','')::date as entry,
           nullif(r->>'registred','')::date as reg, coalesce(r->'data','{}'::jsonb) as data
    from (select coalesce(a.chassis, upper(r->>'chassis')) as c, r from jsonb_array_elements(p->'rows') r
          left join chassis_aliases a on a.alias = upper(r->>'chassis') where coalesce(r->>'chassis','') <> '') z order by c;
  update vehicles v set mmte_depot_date = t.depot, mmte_entry_date = t.entry, mmte_registred_at = t.reg, mmte_data = t.data, mmte_sync_at = now()
  from t_m t where v.chassis = t.chassis;
  select jsonb_build_object(
    'lus', (select count(*) from t_m),
    'trouves', (select count(*) from t_m t join vehicles v on v.chassis = t.chassis),
    'absents_base', coalesce((select jsonb_agg(t.chassis) from t_m t where not exists (select 1 from vehicles v where v.chassis = t.chassis)), '[]'),
    'absents_mmte', case when v_parc is null then '[]'::jsonb else coalesce((select jsonb_agg(v.chassis) from stays s join vehicles v on v.id = s.vehicle_id
        where s.parc_id = v_parc and s.exit_date is null and s.deleted_at is null and not exists (select 1 from t_m t where t.chassis = v.chassis)), '[]') end,
    'ecarts', coalesce((select jsonb_agg(x) from (select v.chassis, v.date_arrivee, v.date_arrivee + v_duree as depot_calcule, t.depot as depot_mmte,
        (t.depot - (v.date_arrivee + v_duree)) as ecart
        from t_m t join vehicles v on v.chassis = t.chassis where t.depot is not null and v.date_arrivee is not null
          and abs(t.depot - (v.date_arrivee + v_duree)) > 3 order by abs(t.depot - (v.date_arrivee + v_duree)) desc limit 2000) x), '[]')
  ) into res;
  return res;
end $$;

revoke all on function public.stock_apply_import(bigint), public.stock_rebuild_parc(bigint), public.stock_refresh_vehicles(bigint[]),
  public.stock_commit_import(jsonb), public.stock_cancel_import(bigint, text, text), public.stock_restore_import(bigint),
  public.stock_merge_vehicles(bigint, bigint, text), public.stock_dashboard(date, int, int, boolean),
  public.stock_report(date, date, int, int, boolean), public.stock_history(bigint, date, int), public.stock_anomalies(int, int),
  public.stock_mmte_sync(jsonb) from public, anon, authenticated;
grant execute on function public.stock_apply_import(bigint), public.stock_rebuild_parc(bigint), public.stock_refresh_vehicles(bigint[]),
  public.stock_commit_import(jsonb), public.stock_cancel_import(bigint, text, text), public.stock_restore_import(bigint),
  public.stock_merge_vehicles(bigint, bigint, text), public.stock_dashboard(date, int, int, boolean),
  public.stock_report(date, date, int, int, boolean), public.stock_history(bigint, date, int), public.stock_anomalies(int, int),
  public.stock_mmte_sync(jsonb) to service_role;
