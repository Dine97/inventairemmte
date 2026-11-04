-- STOCK MMTE v4 : capacité et performance
-- * Instantané d'import compact : tableau des véhicules (import_snapshots) + seulement les lignes modifiées (import_rows)
-- * Application d'un import en traitements ensemblistes (plus de boucle par véhicule)
-- * Index manquants, résumé hebdomadaire précalculé (stock_weekly), journal des erreurs de l'application

create table if not exists public.import_snapshots (
  import_id bigint primary key references public.imports(id) on delete cascade,
  vehicle_ids bigint[] not null
);
create table if not exists public.import_rows (
  import_id bigint not null references public.imports(id) on delete cascade,
  vehicle_id bigint not null references public.vehicles(id) on delete cascade,
  row jsonb not null,
  primary key (import_id, vehicle_id)
);
create index if not exists import_rows_vehicle_idx on public.import_rows (vehicle_id);

create table if not exists public.stock_weekly (
  parc_id bigint not null references public.parcs(id) on delete cascade,
  d date not null,
  stock integer not null, entrees integer not null, sorties integer not null,
  primary key (parc_id, d)
);
alter table public.parcs add column if not exists changed_at timestamptz not null default now();
alter table public.parcs add column if not exists weekly_at timestamptz;

create table if not exists public.client_errors (
  id bigserial primary key, at timestamptz not null default now(),
  uid text, name text, app_version text, kind text, message text, stack text, url text, ua text
);
create index if not exists client_errors_at_idx on public.client_errors (at desc);

alter table public.import_snapshots enable row level security;
alter table public.import_rows enable row level security;
alter table public.stock_weekly enable row level security;
alter table public.client_errors enable row level security;
revoke all on public.import_snapshots, public.import_rows, public.stock_weekly, public.client_errors from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

create index if not exists stays_entry_import_idx on public.stays (entry_import_id);
create index if not exists stays_exit_import_idx on public.stays (exit_import_id);
create index if not exists stays_entry_date_idx on public.stays (entry_date);
create index if not exists stays_exit_date_idx on public.stays (exit_date);
create index if not exists stays_vehicle_open_idx on public.stays (vehicle_id) where exit_date is null and deleted_at is null;
create index if not exists imports_parc_status_idx on public.imports (parc_id, status, stock_date);

-- Toute modification des séjours marque le parc « à recalculer » pour le résumé hebdomadaire
create or replace function public.stock_touch_parcs() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    update parcs set changed_at = now() where id in (select distinct parc_id from old_rows);
  else
    update parcs set changed_at = now() where id in (select distinct parc_id from new_rows);
  end if;
  return null;
end $$;
create or replace trigger stays_touch_ins after insert on public.stays referencing new table as new_rows for each statement execute function public.stock_touch_parcs();
create or replace trigger stays_touch_upd after update on public.stays referencing new table as new_rows for each statement execute function public.stock_touch_parcs();
create or replace trigger stays_touch_del after delete on public.stays referencing old table as old_rows for each statement execute function public.stock_touch_parcs();

-- Ligne compacte d'un véhicule (sans les colonnes brutes du fichier, conservées dans vehicles.data)
create or replace function public.stock_compact_row(r jsonb) returns jsonb language sql immutable as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'chassis_raw', nullif(r->>'chassis_raw',''), 'marque', nullif(r->>'marque',''), 'modele', nullif(r->>'modele',''),
    'annee', nullif(r->>'annee',''), 'navire', nullif(r->>'navire',''), 'manifeste', nullif(r->>'manifeste',''),
    'bl', nullif(r->>'bl',''), 'date_arrivee', nullif(r->>'date_arrivee',''), 'date_transfert', nullif(r->>'date_transfert',''),
    'importateur', nullif(r->>'importateur','')));
$$;

-- ---------------------------------------------------------------
-- Application d'un import (ensembliste)
-- ---------------------------------------------------------------
create or replace function public.stock_apply_import(p_imp bigint)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  imp imports%rowtype; v_parc bigint; v_date date; v_prev date; v_first boolean; v_win int;
  n_ent int := 0; n_sor int := 0; n_tr int := 0; n_tot int := 0; v_side jsonb := '[]';
begin
  select * into imp from imports where id = p_imp;
  v_parc := imp.parc_id; v_date := imp.stock_date;
  select max(stock_date) into v_prev from imports where parc_id = v_parc and status = 'valide' and id <> p_imp
    and (stock_date < v_date or (stock_date = v_date and id < p_imp));
  v_first := v_prev is null and not exists (select 1 from imports where parc_id = v_parc and status = 'valide' and id <> p_imp
                         and stock_date = v_date and id < p_imp);
  select coalesce((value)::int, 30) into v_win from settings where key = 'fenetre_transfert';
  v_win := coalesce(v_win, 30);

  drop table if exists t_rows;
  create temp table t_rows on commit drop as
    select u.vid as vehicle_id,
           coalesce(nullif(r.row->>'date_transfert','')::date, nullif(r.row->>'date_arrivee','')::date, v.date_transfert, v.date_arrivee) as d_file
    from import_snapshots sn
    cross join lateral unnest(sn.vehicle_ids) as u(vid)
    join vehicles v on v.id = u.vid
    left join import_rows r on r.import_id = sn.import_id and r.vehicle_id = u.vid
    where sn.import_id = p_imp;
  create index on t_rows (vehicle_id);
  select count(*) into n_tot from t_rows;

  update stays s set last_import_id = p_imp
  from t_rows t where s.vehicle_id = t.vehicle_id and s.parc_id = v_parc and s.exit_date is null and s.deleted_at is null;

  -- Sorties (et transferts sortants)
  with ex as (
    select s.id,
      (select s2.parc_id from stays s2 where s2.vehicle_id = s.vehicle_id and s2.parc_id <> v_parc
         and s2.exit_date is null and s2.deleted_at is null order by s2.entry_date desc limit 1) as other
    from stays s
    where s.parc_id = v_parc and s.exit_date is null and s.deleted_at is null and s.entry_date <= v_date
      and not exists (select 1 from t_rows t where t.vehicle_id = s.vehicle_id)
  ), up as (
    update stays st set exit_date = v_date, exit_import_id = p_imp,
      exit_kind = case when ex.other is not null then 'transfert' else 'sortie' end,
      to_parc_id = ex.other,
      justif_type = case when ex.other is not null then 'Transfert' else st.justif_type end,
      justif_status = case when ex.other is not null then 'justifiee' else st.justif_status end,
      justif_by = case when ex.other is not null then 'Automatique (transfert détecté)' else st.justif_by end,
      justif_at = case when ex.other is not null then now() else st.justif_at end,
      updated_at = now()
    from ex where st.id = ex.id
    returning (ex.other is not null) as tr
  )
  select count(*) filter (where not tr), count(*) filter (where tr) into n_sor, n_tr from up;

  -- Entrées
  drop table if exists t_new;
  create temp table t_new on commit drop as
    select t.vehicle_id, t.d_file,
      (select s2.parc_id from stays s2 where s2.vehicle_id = t.vehicle_id and s2.exit_date is null and s2.deleted_at is null
         and s2.parc_id <> v_parc order by s2.entry_date desc limit 1) as open_parc,
      (select s3.id from stays s3 where s3.vehicle_id = t.vehicle_id and s3.exit_kind = 'sortie' and s3.deleted_at is null
         and s3.exit_date >= v_date - v_win and s3.exit_date <= v_date and s3.parc_id <> v_parc order by s3.exit_date desc limit 1) as recent_exit
    from t_rows t
    where not exists (select 1 from stays s where s.vehicle_id = t.vehicle_id and s.parc_id = v_parc
                      and s.exit_date is null and s.deleted_at is null);

  insert into stays(vehicle_id, parc_id, entry_import_id, entry_date, entry_kind, last_import_id, from_parc_id, entry_from_file)
  select n.vehicle_id, v_parc, p_imp,
         case when n.ff then n.d_file else v_date end,
         case when v_first then 'initial' when n.open_parc is not null or n.recent_exit is not null then 'transfert' else 'entree' end,
         p_imp,
         coalesce(n.open_parc, (select parc_id from stays where id = n.recent_exit)),
         n.ff
  from (select t.*, (t.d_file is not null and t.d_file <= v_date and (v_prev is null or t.d_file > v_prev)) as ff from t_new t) n;
  n_ent := case when v_first then 0 else (select count(*) from t_new) end;

  -- Une sortie récente d'un autre parc était en réalité un transfert
  select coalesce(jsonb_agg(jsonb_build_object('stay_id', s.id, 'exit_kind', s.exit_kind, 'to_parc_id', s.to_parc_id,
           'justif_type', s.justif_type, 'justif_status', s.justif_status, 'justif_by', s.justif_by)), '[]'::jsonb)
  into v_side
  from stays s where s.id in (select recent_exit from t_new where recent_exit is not null and open_parc is null);
  update stays set exit_kind = 'transfert', to_parc_id = v_parc,
    justif_type = coalesce(justif_type, 'Transfert'),
    justif_status = case when justif_status = 'non_justifiee' then 'justifiee' else justif_status end,
    justif_by = coalesce(justif_by, 'Automatique (transfert détecté)'), justif_at = coalesce(justif_at, now()), updated_at = now()
  where id in (select recent_exit from t_new where recent_exit is not null and open_parc is null);

  perform stock_recompute_current(array(select vehicle_id from t_new union select vehicle_id from stays where exit_import_id = p_imp));

  update imports set nb_chassis = n_tot, nb_entrees = n_ent, nb_sorties = n_sor,
         nb_transferts = n_tr, side_effects = v_side, is_initial = v_first
  where id = p_imp;
  return jsonb_build_object('is_initial', v_first, 'nb_chassis', n_tot, 'entrees', n_ent, 'sorties', n_sor, 'transferts', n_tr);
end $$;

-- ---------------------------------------------------------------
-- Reconstruction de l'historique d'un parc
-- ---------------------------------------------------------------
create or replace function public.stock_rebuild_parc(p_parc bigint)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare r record; e jsonb; v_ids bigint[];
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

  update stays s set justif_type = j.justif_type, justif_numero = j.justif_numero, justif_date = j.justif_date,
    justif_bureau = j.justif_bureau, justif_note = j.justif_note, justif_files = j.justif_files,
    justif_status = j.justif_status, justif_by = j.justif_by, justif_at = j.justif_at, valide_by = j.valide_by, valide_at = j.valide_at
  from t_j j
  where s.id = (select x.id from stays x where x.vehicle_id = j.vehicle_id and x.parc_id = p_parc and x.exit_date is not null and x.deleted_at is null
                order by abs(x.exit_date - j.exit_date), x.id limit 1);
  perform stock_recompute_current(coalesce(v_ids, '{}') || coalesce((select array_agg(distinct vehicle_id) from stays where parc_id = p_parc), '{}'));
end $$;

-- Champs des véhicules d'après la dernière ligne enregistrée (hors champs verrouillés)
create or replace function public.stock_refresh_vehicles(p_ids bigint[])
returns void language sql security definer set search_path = public as $$
  update vehicles v set
    chassis_raw = case when 'chassis_raw' = any(v.locked_fields) then v.chassis_raw else coalesce(lr.row->>'chassis_raw', v.chassis_raw) end,
    marque = case when 'marque' = any(v.locked_fields) then v.marque else coalesce(lr.row->>'marque', v.marque) end,
    modele = case when 'modele' = any(v.locked_fields) then v.modele else coalesce(lr.row->>'modele', v.modele) end,
    annee = case when 'annee' = any(v.locked_fields) then v.annee else coalesce(lr.row->>'annee', v.annee) end,
    navire = case when 'navire' = any(v.locked_fields) then v.navire else coalesce(lr.row->>'navire', v.navire) end,
    manifeste = case when 'manifeste' = any(v.locked_fields) then v.manifeste else coalesce(lr.row->>'manifeste', v.manifeste) end,
    bl = case when 'bl' = any(v.locked_fields) then v.bl else coalesce(lr.row->>'bl', v.bl) end,
    date_arrivee = case when 'date_arrivee' = any(v.locked_fields) then v.date_arrivee else coalesce((lr.row->>'date_arrivee')::date, v.date_arrivee) end,
    date_transfert = case when 'date_transfert' = any(v.locked_fields) then v.date_transfert else coalesce((lr.row->>'date_transfert')::date, v.date_transfert) end,
    importateur = case when 'importateur' = any(v.locked_fields) then v.importateur else coalesce(lr.row->>'importateur', v.importateur) end,
    updated_at = now()
  from (select distinct on (ir.vehicle_id) ir.vehicle_id, ir.row from import_rows ir join imports i on i.id = ir.import_id
        where i.status = 'valide' and ir.vehicle_id = any(p_ids) order by ir.vehicle_id, i.stock_date desc, i.id desc) lr
  where v.id = lr.vehicle_id;
$$;

-- ---------------------------------------------------------------
-- Import : instantané compact puis application (ou reconstruction si fichier en retard)
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
    select distinct on (c) c as chassis, r, stock_compact_row(r) as cr from (
      select coalesce(a.chassis, upper(r->>'chassis')) as c, r
      from jsonb_array_elements(p->'rows') r
      left join chassis_aliases a on a.alias = upper(r->>'chassis')
      where coalesce(r->>'chassis','') <> '') z
    order by c;

  -- valeurs connues avant l'import (pour ne garder que les lignes modifiées)
  drop table if exists t_old;
  create temp table t_old on commit drop as
    select v.chassis, stock_compact_row(jsonb_build_object('chassis_raw', v.chassis_raw, 'marque', v.marque, 'modele', v.modele, 'annee', v.annee,
             'navire', v.navire, 'manifeste', v.manifeste, 'bl', v.bl, 'date_arrivee', v.date_arrivee, 'date_transfert', v.date_transfert,
             'importateur', v.importateur)) as oldr
    from vehicles v join t_in t on t.chassis = v.chassis;

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

  insert into import_snapshots(import_id, vehicle_ids)
  select v_imp, coalesce(array_agg(v.id order by v.id), '{}') from t_in t join vehicles v on v.chassis = t.chassis;

  insert into import_rows(import_id, vehicle_id, row)
  select v_imp, v.id, t.cr
  from t_in t join vehicles v on v.chassis = t.chassis left join t_old o on o.chassis = t.chassis
  where o.chassis is null or not (o.oldr @> t.cr);

  if v_late then
    perform stock_rebuild_parc(v_parc);
    select jsonb_build_object('is_initial', is_initial, 'nb_chassis', nb_chassis, 'entrees', nb_entrees, 'sorties', nb_sorties,
                              'transferts', nb_transferts, 'reconstruit', true) into res from imports where id = v_imp;
  else
    res := stock_apply_import(v_imp);
  end if;
  return res || jsonb_build_object('import_id', v_imp, 'parc_id', v_parc);
end $$;

create or replace function public.stock_cancel_import(p_import bigint, p_reason text, p_by text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare imp imports%rowtype; v_ids bigint[];
begin
  select * into imp from imports where id = p_import;
  if not found then raise exception 'IMPORT_INTROUVABLE'; end if;
  if imp.status <> 'valide' then raise exception 'IMPORT_DEJA_ANNULE'; end if;
  perform pg_advisory_xact_lock(imp.parc_id);
  select vehicle_ids into v_ids from import_snapshots where import_id = p_import;
  update imports set status = 'annule', cancel_reason = p_reason, cancelled_at = now(), cancelled_by = p_by where id = p_import;
  perform stock_rebuild_parc(imp.parc_id);
  perform stock_refresh_vehicles(coalesce(v_ids, '{}'));
  update vehicles v set deleted_at = now(), notes = concat_ws(' / ', nullif(v.notes, ''), 'Écarté par l''annulation d''un import')
  where v.id = any(coalesce(v_ids, '{}')) and v.deleted_at is null
    and not exists (select 1 from stays s where s.vehicle_id = v.id and s.deleted_at is null)
    and not exists (select 1 from import_snapshots sn join imports i on i.id = sn.import_id where i.status = 'valide' and v.id = any(sn.vehicle_ids));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.stock_restore_import(p_import bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare imp imports%rowtype; v_ids bigint[];
begin
  select * into imp from imports where id = p_import;
  if not found or imp.status <> 'annule' then raise exception 'IMPORT_NON_ANNULE'; end if;
  perform pg_advisory_xact_lock(imp.parc_id);
  select vehicle_ids into v_ids from import_snapshots where import_id = p_import;
  update vehicles set deleted_at = null, notes = nullif(replace(replace(coalesce(notes, ''), ' / Écarté par l''annulation d''un import', ''), 'Écarté par l''annulation d''un import', ''), '')
  where id = any(coalesce(v_ids, '{}')) and deleted_at is not null;
  update imports set status = 'valide', cancel_reason = null, cancelled_at = null, cancelled_by = null where id = p_import;
  perform stock_rebuild_parc(imp.parc_id);
  perform stock_refresh_vehicles(coalesce(v_ids, '{}'));
  return jsonb_build_object('ok', true);
end $$;

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
  update import_snapshots set vehicle_ids = array(select distinct x from unnest(array_replace(vehicle_ids, p_from, p_into)) x order by x)
  where p_from = any(vehicle_ids);
  delete from import_rows a where a.vehicle_id = p_from and exists (select 1 from import_rows b where b.import_id = a.import_id and b.vehicle_id = p_into);
  update import_rows set vehicle_id = p_into where vehicle_id = p_from;
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
-- Résumé hebdomadaire précalculé (semaines du lundi au dimanche)
-- ---------------------------------------------------------------
create or replace function public.stock_refresh_weekly(p_parc bigint)
returns void language plpgsql security definer set search_path = public as $$
declare v_start date; v_end date;
begin
  delete from stock_weekly where parc_id = p_parc;
  select min(stock_date) into v_start from imports where parc_id = p_parc and status = 'valide';
  if v_start is not null then
    v_start := date_trunc('week', v_start)::date + 6;
    v_end := date_trunc('week', (now() at time zone 'Africa/Porto-Novo')::date)::date + 6;
    insert into stock_weekly(parc_id, d, stock, entrees, sorties)
    select p_parc, g::date,
      (select count(*) from stays s where s.parc_id = p_parc and s.deleted_at is null and s.entry_date <= g::date and (s.exit_date is null or s.exit_date > g::date)),
      (select count(*) from stays s where s.parc_id = p_parc and s.deleted_at is null and s.entry_kind in ('entree','transfert','manuel') and s.entry_date > g::date - 7 and s.entry_date <= g::date),
      (select count(*) from stays s where s.parc_id = p_parc and s.deleted_at is null and s.exit_kind is not null and s.exit_date > g::date - 7 and s.exit_date <= g::date)
    from generate_series(v_start::timestamp, v_end::timestamp, interval '7 day') g;
  end if;
  update parcs set weekly_at = now() where id = p_parc;
end $$;

create or replace function public.stock_history(p_parc bigint, p_ref date, p_weeks int)
returns table(d date, stock bigint, entrees bigint, sorties bigint)
language plpgsql security definer set search_path = public as $$
declare r record; v_end date := date_trunc('week', p_ref)::date + 6;
begin
  for r in select id from parcs
           where (p_parc is null or id = p_parc) and deleted_at is null
             and (weekly_at is null or weekly_at < changed_at
                  or weekly_at < date_trunc('week', (now() at time zone 'Africa/Porto-Novo'))::timestamp at time zone 'Africa/Porto-Novo')
  loop
    perform stock_refresh_weekly(r.id);
  end loop;
  return query
    select g::date, coalesce(sum(w.stock), 0)::bigint, coalesce(sum(w.entrees), 0)::bigint, coalesce(sum(w.sorties), 0)::bigint
    from generate_series((v_end - (greatest(p_weeks, 1) - 1) * 7)::timestamp, v_end::timestamp, interval '7 day') g
    left join stock_weekly w on w.d = g::date and (p_parc is null or w.parc_id = p_parc)
    group by g order by g;
end $$;

-- L'ancienne table import_items (vide) n'est plus utilisée ; elle peut être supprimée à tout moment.

revoke all on function public.stock_apply_import(bigint), public.stock_rebuild_parc(bigint), public.stock_refresh_vehicles(bigint[]),
  public.stock_commit_import(jsonb), public.stock_cancel_import(bigint, text, text), public.stock_restore_import(bigint),
  public.stock_merge_vehicles(bigint, bigint, text), public.stock_refresh_weekly(bigint), public.stock_history(bigint, date, int),
  public.stock_compact_row(jsonb), public.stock_touch_parcs() from public, anon, authenticated;
grant execute on function public.stock_apply_import(bigint), public.stock_rebuild_parc(bigint), public.stock_refresh_vehicles(bigint[]),
  public.stock_commit_import(jsonb), public.stock_cancel_import(bigint, text, text), public.stock_restore_import(bigint),
  public.stock_merge_vehicles(bigint, bigint, text), public.stock_refresh_weekly(bigint), public.stock_history(bigint, date, int),
  public.stock_compact_row(jsonb) to service_role;

alter function public.stock_compact_row(jsonb) set search_path = public;
