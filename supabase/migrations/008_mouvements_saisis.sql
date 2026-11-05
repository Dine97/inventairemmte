-- 008 : entrées et sorties saisies (une par une ou par fichier), entre deux imports du lundi
--
-- Principe : chaque saisie est un « mouvement » daté (table stock_moves). Il s'applique au stock du parc
-- comme un import : une entrée ouvre un séjour, une sortie ferme le séjour en cours à sa date.
-- Lors d'une reconstruction (fichier en retard, annulation…), imports et mouvements sont rejoués
-- ensemble dans l'ordre des dates : rien n'est perdu.

create table if not exists public.stock_moves (
  id bigserial primary key,
  parc_id bigint not null references public.parcs(id),
  vehicle_id bigint not null references public.vehicles(id) on delete cascade,
  kind text not null check (kind in ('entree', 'sortie')),
  move_date date not null,
  motif text,
  justif_type text, justif_numero text, justif_date date, justif_bureau text,
  source text not null default 'saisie' check (source in ('saisie', 'fichier')),
  file_name text,
  batch_id bigint,
  result text,
  created_by_uid text, created_by_name text, created_at timestamptz not null default now(),
  cancelled_at timestamptz, cancelled_by text, cancel_reason text
);
create sequence if not exists public.stock_moves_batch_seq;
create index if not exists stock_moves_parc_idx on public.stock_moves (parc_id, move_date) where cancelled_at is null;
create index if not exists stock_moves_vehicle_idx on public.stock_moves (vehicle_id);
create index if not exists stock_moves_batch_idx on public.stock_moves (batch_id);
alter table public.stock_moves enable row level security;
revoke all on public.stock_moves from anon, authenticated;
revoke all on sequence public.stock_moves_id_seq, public.stock_moves_batch_seq from anon, authenticated;

alter table public.stays add column if not exists entry_move_id bigint references public.stock_moves(id) on delete set null;
alter table public.stays add column if not exists exit_move_id bigint references public.stock_moves(id) on delete set null;
create index if not exists stays_entry_move_idx on public.stays (entry_move_id) where entry_move_id is not null;
create index if not exists stays_exit_move_idx on public.stays (exit_move_id) where exit_move_id is not null;
-- index signalés par le conseiller de performance
create index if not exists stays_from_parc_idx on public.stays (from_parc_id) where from_parc_id is not null;
create index if not exists stays_to_parc_idx on public.stays (to_parc_id) where to_parc_id is not null;

create or replace view public.v_stays as
 SELECT s.id AS stay_id, s.vehicle_id, s.parc_id, p.name AS parc, s.entry_import_id, s.entry_date, s.entry_kind,
    s.from_parc_id, fp.name AS from_parc, s.exit_import_id, s.exit_date, s.exit_kind, s.to_parc_id, tp.name AS to_parc,
    s.justif_type, s.justif_numero, s.justif_date, s.justif_bureau, s.justif_note, s.justif_files, s.justif_status,
    s.justif_by, s.justif_at, s.valide_by, s.valide_at, s.raw, v.chassis, v.chassis_raw, v.marque, v.modele, v.annee,
    v.navire, v.manifeste, v.bl, v.date_arrivee, v.date_transfert, v.importateur, v.notes, v.current_parc_id,
    v.mmte_depot_date, s.entry_from_file, s.entry_move_id, s.exit_move_id
   FROM stays s
     JOIN vehicles v ON v.id = s.vehicle_id AND v.deleted_at IS NULL
     JOIN parcs p ON p.id = s.parc_id
     LEFT JOIN parcs fp ON fp.id = s.from_parc_id
     LEFT JOIN parcs tp ON tp.id = s.to_parc_id
  WHERE s.deleted_at IS NULL;
revoke all on public.v_stays from anon, authenticated;

-- Application d'un mouvement au stock du parc (renvoie le résultat)
create or replace function public.stock_apply_move(p_move bigint)
returns text language plpgsql security definer set search_path = public as $$
declare m stock_moves%rowtype; v_stay bigint; v_other bigint; v_res text;
begin
  select * into m from stock_moves where id = p_move;
  if m.kind = 'entree' then
    if exists (select 1 from stays where vehicle_id = m.vehicle_id and parc_id = m.parc_id and deleted_at is null
               and entry_date <= m.move_date and (exit_date is null or exit_date > m.move_date)) then
      v_res := 'deja_present';
    else
      select parc_id into v_other from stays where vehicle_id = m.vehicle_id and parc_id <> m.parc_id and exit_date is null and deleted_at is null
        order by entry_date desc limit 1;
      insert into stays(vehicle_id, parc_id, entry_date, entry_kind, from_parc_id, entry_move_id, entry_from_file)
      values (m.vehicle_id, m.parc_id, m.move_date, case when v_other is not null then 'transfert' else 'entree' end, v_other, m.id, false);
      v_res := case when v_other is not null then 'ok_transfert' else 'ok' end;
    end if;
  else
    select id into v_stay from stays where vehicle_id = m.vehicle_id and parc_id = m.parc_id and deleted_at is null
      and exit_date is null and entry_date <= m.move_date order by entry_date desc limit 1;
    if v_stay is null then
      v_res := 'absent';
    else
      update stays set exit_date = m.move_date, exit_kind = 'sortie', exit_move_id = m.id, exit_import_id = null,
        justif_type = coalesce(m.justif_type, justif_type), justif_numero = coalesce(m.justif_numero, justif_numero),
        justif_date = coalesce(m.justif_date, justif_date), justif_bureau = coalesce(m.justif_bureau, justif_bureau),
        justif_note = coalesce(m.motif, justif_note),
        justif_status = case when justif_status = 'non_justifiee' and (m.justif_numero is not null or m.justif_type is not null) then 'justifiee' else justif_status end,
        justif_by = case when justif_status = 'non_justifiee' and (m.justif_numero is not null or m.justif_type is not null) then m.created_by_name else justif_by end,
        justif_at = case when justif_status = 'non_justifiee' and (m.justif_numero is not null or m.justif_type is not null) then now() else justif_at end,
        updated_at = now()
      where id = v_stay;
      v_res := 'ok';
    end if;
  end if;
  update stock_moves set result = v_res where id = m.id;
  perform stock_recompute_current(array[m.vehicle_id]);
  return v_res;
end $$;

-- Reconstruction d'un parc : imports et mouvements saisis rejoués ensemble, dans l'ordre des dates
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
    from stays where parc_id = p_parc and (entry_kind <> 'manuel' or entry_move_id is not null) and exit_date is not null and deleted_at is null
      and exit_move_id is null
      and (justif_status <> 'non_justifiee' or jsonb_array_length(justif_files) > 0)
      and coalesce(justif_by, '') <> 'Automatique (transfert détecté)';
  -- pièces jointes et validations ajoutées après coup sur une sortie saisie
  drop table if exists t_jm;
  create temp table t_jm on commit drop as
    select exit_move_id, justif_type, justif_numero, justif_date, justif_bureau, justif_note, justif_files, justif_status, justif_by, justif_at, valide_by, valide_at
    from stays where parc_id = p_parc and exit_move_id is not null and deleted_at is null;
  select array_agg(distinct vehicle_id) into v_ids from stays where parc_id = p_parc;

  delete from stays where parc_id = p_parc and (entry_kind <> 'manuel' or entry_move_id is not null);
  update stays set exit_date = null, exit_import_id = null, exit_move_id = null, exit_kind = null, to_parc_id = null
  where parc_id = p_parc and entry_kind = 'manuel' and (exit_import_id is not null or exit_move_id is not null);

  for r in
    select 'i' as t, id, stock_date as d, 0 as o from imports where parc_id = p_parc and status = 'valide'
    union all
    select 'm', id, move_date, 1 from stock_moves where parc_id = p_parc and cancelled_at is null
    order by d, o, id
  loop
    if r.t = 'i' then perform stock_apply_import(r.id); else perform stock_apply_move(r.id); end if;
  end loop;

  update stays s set justif_type = j.justif_type, justif_numero = j.justif_numero, justif_date = j.justif_date,
    justif_bureau = j.justif_bureau, justif_note = j.justif_note, justif_files = j.justif_files,
    justif_status = j.justif_status, justif_by = j.justif_by, justif_at = j.justif_at, valide_by = j.valide_by, valide_at = j.valide_at
  from t_jm j where s.exit_move_id = j.exit_move_id;
  update stays s set justif_type = j.justif_type, justif_numero = j.justif_numero, justif_date = j.justif_date,
    justif_bureau = j.justif_bureau, justif_note = j.justif_note, justif_files = j.justif_files,
    justif_status = j.justif_status, justif_by = j.justif_by, justif_at = j.justif_at, valide_by = j.valide_by, valide_at = j.valide_at
  from t_j j
  where s.id = (select x.id from stays x where x.vehicle_id = j.vehicle_id and x.parc_id = p_parc and x.exit_date is not null and x.deleted_at is null
                  and x.exit_move_id is null
                order by abs(x.exit_date - j.exit_date), x.id limit 1);
  perform stock_recompute_current(coalesce(v_ids, '{}') || coalesce((select array_agg(distinct vehicle_id) from stays where parc_id = p_parc), '{}'));
end $$;

-- Un import est « en retard » aussi quand des mouvements saisis sont datés après lui
create or replace function public.stock_commit_import_late(p_parc bigint, p_date date)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from imports where parc_id = p_parc and status = 'valide' and stock_date > p_date)
      or exists (select 1 from stock_moves where parc_id = p_parc and cancelled_at is null and move_date > p_date);
$$;

-- Enregistrement d'un lot de mouvements (saisie unique ou fichier)
-- p : { parc_name, kind, date, motif, justif_type, justif_numero, justif_date, justif_bureau, source, file_name, by_uid, by_name,
--       items: [ { chassis, chassis_raw?, marque?, modele?, annee?, navire?, bl?, date_arrivee?, importateur?, date?, motif?, justif_numero? } ] }
create or replace function public.stock_add_moves(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_parc bigint; v_batch bigint; v_kind text := p->>'kind'; v_retro boolean; r record; res jsonb;
begin
  if v_kind not in ('entree', 'sortie') then raise exception 'TYPE_MOUVEMENT_INVALIDE'; end if;
  if jsonb_array_length(coalesce(p->'items', '[]')) = 0 then raise exception 'AUCUN_CHASSIS'; end if;
  v_parc := stock_parc_id(p->>'parc_name');
  perform pg_advisory_xact_lock(v_parc);
  v_batch := nextval('stock_moves_batch_seq');

  drop table if exists t_m;
  create temp table t_m on commit drop as
    select distinct on (c) c as chassis, it,
           coalesce(nullif(it->>'date','')::date, (p->>'date')::date) as d
    from (select coalesce(a.chassis, upper(regexp_replace(it->>'chassis', '[\s\-\./_*]', '', 'g'))) as c, it
          from jsonb_array_elements(p->'items') it
          left join chassis_aliases a on a.alias = upper(regexp_replace(it->>'chassis', '[\s\-\./_*]', '', 'g'))
          where coalesce(it->>'chassis', '') <> '') z
    order by c;
  if exists (select 1 from t_m where d is null) then raise exception 'DATE_MOUVEMENT_MANQUANTE'; end if;

  -- véhicules inconnus (entrées) : création de la fiche avec les informations fournies
  insert into vehicles (chassis, chassis_raw, marque, modele, annee, navire, manifeste, bl, date_arrivee, importateur)
  select t.chassis, coalesce(nullif(t.it->>'chassis_raw',''), t.it->>'chassis'), nullif(t.it->>'marque',''), nullif(t.it->>'modele',''), nullif(t.it->>'annee',''),
         nullif(t.it->>'navire',''), nullif(t.it->>'manifeste',''), nullif(t.it->>'bl',''), nullif(t.it->>'date_arrivee','')::date, nullif(t.it->>'importateur','')
  from t_m t where v_kind = 'entree' and not exists (select 1 from vehicles v where v.chassis = t.chassis)
  on conflict (chassis) do nothing;
  -- fiche existante : compléter seulement les informations manquantes
  update vehicles v set
    marque = coalesce(v.marque, nullif(t.it->>'marque','')), modele = coalesce(v.modele, nullif(t.it->>'modele','')),
    annee = coalesce(v.annee, nullif(t.it->>'annee','')), navire = coalesce(v.navire, nullif(t.it->>'navire','')),
    manifeste = coalesce(v.manifeste, nullif(t.it->>'manifeste','')), bl = coalesce(v.bl, nullif(t.it->>'bl','')),
    date_arrivee = coalesce(v.date_arrivee, nullif(t.it->>'date_arrivee','')::date), importateur = coalesce(v.importateur, nullif(t.it->>'importateur','')),
    deleted_at = null, updated_at = now()
  from t_m t
  where v.chassis = t.chassis and (v.deleted_at is not null
    or (v.marque is null and nullif(t.it->>'marque','') is not null) or (v.date_arrivee is null and nullif(t.it->>'date_arrivee','') is not null)
    or (v.navire is null and nullif(t.it->>'navire','') is not null) or (v.bl is null and nullif(t.it->>'bl','') is not null));

  insert into stock_moves (parc_id, vehicle_id, kind, move_date, motif, justif_type, justif_numero, justif_date, justif_bureau,
                           source, file_name, batch_id, created_by_uid, created_by_name)
  select v_parc, v.id, v_kind, t.d,
         coalesce(nullif(t.it->>'motif',''), nullif(p->>'motif','')),
         nullif(p->>'justif_type',''), coalesce(nullif(t.it->>'justif_numero',''), nullif(p->>'justif_numero','')),
         coalesce(nullif(t.it->>'justif_date','')::date, nullif(p->>'justif_date','')::date), nullif(p->>'justif_bureau',''),
         coalesce(nullif(p->>'source',''), 'saisie'), nullif(p->>'file_name',''), v_batch, p->>'by_uid', p->>'by_name'
  from t_m t join vehicles v on v.chassis = t.chassis;

  -- mouvement daté avant un import déjà enregistré : l'historique du parc est rejoué
  v_retro := exists (select 1 from imports i where i.parc_id = v_parc and i.status = 'valide'
                     and i.stock_date > (select min(d) from t_m))
          or exists (select 1 from stock_moves m where m.parc_id = v_parc and m.cancelled_at is null and m.batch_id <> v_batch
                     and m.move_date > (select min(d) from t_m));
  if v_retro then
    perform stock_rebuild_parc(v_parc);
  else
    for r in select id from stock_moves where batch_id = v_batch order by move_date, id loop
      perform stock_apply_move(r.id);
    end loop;
  end if;

  select jsonb_build_object('batch_id', v_batch, 'parc_id', v_parc, 'reconstruit', v_retro,
           'total', count(*), 'ok', count(*) filter (where m.result in ('ok', 'ok_transfert')),
           'transferts', count(*) filter (where m.result = 'ok_transfert'),
           'deja_present', count(*) filter (where m.result = 'deja_present'),
           'absents', count(*) filter (where m.result = 'absent'),
           'details', coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'chassis', v.chassis, 'date', m.move_date, 'result', m.result) order by v.chassis), '[]'))
  into res from stock_moves m join vehicles v on v.id = m.vehicle_id where m.batch_id = v_batch;
  -- sorties de châssis inconnus de la base : signalées, rien n'est créé
  select res || jsonb_build_object('total', (res->>'total')::int + count(*), 'inconnus', count(*),
           'details', (res->'details') || coalesce(jsonb_agg(jsonb_build_object('chassis', t.chassis, 'date', t.d, 'result', 'inconnu') order by t.chassis), '[]'))
  into res from t_m t where not exists (select 1 from vehicles v where v.chassis = t.chassis);
  if not exists (select 1 from stock_moves where batch_id = v_batch) and (res->>'inconnus')::int = 0 then raise exception 'AUCUN_CHASSIS'; end if;
  return res;
end $$;

-- Annulation (ou réactivation) d'un mouvement saisi ou d'un lot entier
create or replace function public.stock_cancel_moves(p_ids bigint[], p_reason text, p_by text, p_restore boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record; n int;
begin
  if p_restore then
    update stock_moves set cancelled_at = null, cancelled_by = null, cancel_reason = null where id = any(p_ids) and cancelled_at is not null;
  else
    update stock_moves set cancelled_at = now(), cancelled_by = p_by, cancel_reason = p_reason, result = null where id = any(p_ids) and cancelled_at is null;
  end if;
  get diagnostics n = row_count;
  for r in select distinct parc_id from stock_moves where id = any(p_ids) loop
    perform stock_rebuild_parc(r.parc_id);
  end loop;
  return jsonb_build_object('ok', true, 'n', n);
end $$;

-- Aperçu avant enregistrement : où se trouve chaque châssis aujourd'hui
create or replace function public.stock_moves_preview(p_parc_name text, p_chassis text[])
returns jsonb language sql stable security definer set search_path = public as $$
  with c as (
    select distinct coalesce(a.chassis, x) as chassis, x as saisi
    from unnest(p_chassis) x left join chassis_aliases a on a.alias = x),
  pk as (select id from parcs where name = upper(trim(p_parc_name)))
  select coalesce(jsonb_agg(jsonb_build_object(
    'chassis', c.chassis,
    'connu', v.id is not null,
    'marque', v.marque, 'modele', v.modele, 'date_arrivee', v.date_arrivee,
    'dans_ce_parc', exists (select 1 from stays s where s.vehicle_id = v.id and s.parc_id = (select id from pk) and s.exit_date is null and s.deleted_at is null),
    'autre_parc', (select p.name from stays s join parcs p on p.id = s.parc_id where s.vehicle_id = v.id and s.exit_date is null and s.deleted_at is null
                   and s.parc_id <> coalesce((select id from pk), 0) limit 1),
    'entre_le', (select s.entry_date from stays s where s.vehicle_id = v.id and s.parc_id = (select id from pk) and s.exit_date is null and s.deleted_at is null limit 1)
  ) order by c.chassis), '[]'::jsonb)
  from c left join vehicles v on v.chassis = c.chassis and v.deleted_at is null;
$$;

revoke all on function public.stock_apply_move(bigint), public.stock_rebuild_parc(bigint), public.stock_commit_import_late(bigint, date),
  public.stock_add_moves(jsonb), public.stock_cancel_moves(bigint[], text, text, boolean), public.stock_moves_preview(text, text[]) from public, anon, authenticated;
grant execute on function public.stock_apply_move(bigint), public.stock_rebuild_parc(bigint), public.stock_commit_import_late(bigint, date),
  public.stock_add_moves(jsonb), public.stock_cancel_moves(bigint[], text, text, boolean), public.stock_moves_preview(text, text[]) to service_role;

-- Import : tient compte des mouvements saisis datés après lui
create or replace function public.stock_commit_import(p jsonb)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_parc bigint; v_date date := (p->>'stock_date')::date; v_last date; v_imp bigint; v_late boolean; res jsonb;
begin
  if v_date is null then raise exception 'DATE_STOCK_MANQUANTE'; end if;
  v_parc := stock_parc_id(p->>'parc_name');
  perform pg_advisory_xact_lock(v_parc);
  v_late := stock_commit_import_late(v_parc, v_date);

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

  -- Véhicules nouveaux : insertion
  insert into vehicles (chassis, chassis_raw, marque, modele, annee, navire, manifeste, bl, date_arrivee, date_transfert, importateur, data)
  select t.chassis, t.r->>'chassis_raw', nullif(t.r->>'marque',''), nullif(t.r->>'modele',''), nullif(t.r->>'annee',''), nullif(t.r->>'navire',''),
         nullif(t.r->>'manifeste',''), nullif(t.r->>'bl',''), nullif(t.r->>'date_arrivee','')::date, nullif(t.r->>'date_transfert','')::date,
         nullif(t.r->>'importateur',''), coalesce(t.r->'data','{}'::jsonb)
  from t_in t
  where not exists (select 1 from vehicles v where v.chassis = t.chassis)
  on conflict (chassis) do nothing;

  -- Véhicules connus : mis à jour seulement si une information a changé (les inchangés ne sont plus réécrits)
  update vehicles v set
    chassis_raw = case when 'chassis_raw' = any(v.locked_fields) then v.chassis_raw else coalesce(t.r->>'chassis_raw', v.chassis_raw) end,
    marque = case when 'marque' = any(v.locked_fields) then v.marque else coalesce(nullif(t.r->>'marque',''), v.marque) end,
    modele = case when 'modele' = any(v.locked_fields) then v.modele else coalesce(nullif(t.r->>'modele',''), v.modele) end,
    annee = case when 'annee' = any(v.locked_fields) then v.annee else coalesce(nullif(t.r->>'annee',''), v.annee) end,
    navire = case when 'navire' = any(v.locked_fields) then v.navire else coalesce(nullif(t.r->>'navire',''), v.navire) end,
    manifeste = case when 'manifeste' = any(v.locked_fields) then v.manifeste else coalesce(nullif(t.r->>'manifeste',''), v.manifeste) end,
    bl = case when 'bl' = any(v.locked_fields) then v.bl else coalesce(nullif(t.r->>'bl',''), v.bl) end,
    date_arrivee = case when 'date_arrivee' = any(v.locked_fields) then v.date_arrivee else coalesce(nullif(t.r->>'date_arrivee','')::date, v.date_arrivee) end,
    date_transfert = case when 'date_transfert' = any(v.locked_fields) then v.date_transfert else coalesce(nullif(t.r->>'date_transfert','')::date, v.date_transfert) end,
    importateur = case when 'importateur' = any(v.locked_fields) then v.importateur else coalesce(nullif(t.r->>'importateur',''), v.importateur) end,
    data = v.data || coalesce(t.r->'data','{}'::jsonb), deleted_at = null, updated_at = now()
  from t_in t join t_old o on o.chassis = t.chassis
  where v.chassis = t.chassis
    and (v.deleted_at is not null
         or not (o.oldr @> t.cr)
         or not (stock_data_key(v.data) @> stock_data_key(coalesce(t.r->'data','{}'::jsonb))));

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

-- Fusion d'un châssis mal saisi : ses mouvements saisis suivent
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
  update stock_moves set vehicle_id = p_into where vehicle_id = p_from;
  update vehicles set data = vi.data || vf.data, notes = concat_ws(' / ', vi.notes, 'Châssis mal saisi fusionné : ' || vf.chassis) where id = p_into;
  delete from vehicles where id = p_from;
  for r in select distinct s.parc_id from stays s where s.vehicle_id = p_into loop
    perform stock_rebuild_parc(r.parc_id);
  end loop;
  perform stock_recompute_current(array[p_into]);
  return jsonb_build_object('ok', true, 'alias', vf.chassis, 'chassis', vi.chassis);
end $$;

revoke all on function public.stock_commit_import(jsonb), public.stock_merge_vehicles(bigint, bigint, text) from public, anon, authenticated;
grant execute on function public.stock_commit_import(jsonb), public.stock_merge_vehicles(bigint, bigint, text) to service_role;
