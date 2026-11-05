-- 007 : les véhicules et séjours inchangés ne sont plus réécrits à chaque import
-- (import hebdomadaire d'un grand parc beaucoup plus rapide, base qui ne gonfle plus)

-- Colonnes « autres » du fichier sans les numéros de ligne (N°, NBRE…), qui changent d'une semaine à l'autre
create or replace function public.stock_data_key(d jsonb) returns jsonb language sql immutable set search_path = public as $$
  select coalesce(jsonb_object_agg(k, v), '{}'::jsonb)
  from jsonb_each(coalesce(d, '{}'::jsonb)) e(k, v)
  where upper(regexp_replace(k, '[^A-Za-z]', '', 'g')) not in ('', 'N', 'NO', 'NUM', 'NUMERO', 'NBRE', 'NB', 'ORDRE', 'NORDRE', 'ID');
$$;

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

  -- (plus de réécriture des séjours inchangés : « dernier import » se lit dans imports / import_snapshots)

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
-- Enregistrement d'un import
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


revoke all on function public.stock_data_key(jsonb), public.stock_apply_import(bigint), public.stock_commit_import(jsonb) from public, anon, authenticated;
grant execute on function public.stock_data_key(jsonb), public.stock_apply_import(bigint), public.stock_commit_import(jsonb) to service_role;
