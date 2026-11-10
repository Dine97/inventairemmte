-- 6.15.0 — Entrées et sorties déclarées par le parc (feuilles ou fichiers « Entrées » / « Sorties », Excel ou PDF)
-- Règles décidées le 10/11/2026 :
--  * la feuille Stock reste la référence du stock ; les mouvements déclarés la complètent ;
--  * date réelle : un mouvement prend la date déclarée si elle tombe entre l'état précédent et celui-ci ;
--  * une sortie déclarée avec un n° de déclaration est « justifiée (déclarée par le parc) », un agent peut la valider ou la corriger ;
--  * aller-retour : véhicule déclaré sorti, absent de l'état précédent et de celui-ci → entrée et sortie enregistrées ;
--  * contradictions (déclaré sorti mais toujours en stock, déclaré entré mais absent) → « À régulariser ».
-- Les mouvements déclarés sont gardés dans imports.declared->'mouvements' : ils sont réappliqués à chaque recalcul du parc.

alter table public.stays add column if not exists exit_from_file boolean not null default false;

create or replace view public.v_stays_eff_raw as
 SELECT s.id AS stay_id, s.vehicle_id, s.parc_id, s.entry_kind, s.exit_kind, s.entry_date, s.exit_date, s.from_parc_id, s.to_parc_id,
    stock_eff_date(s.entry_date, ((s.entry_move_id IS NULL) AND (NOT COALESCE(s.entry_from_file, false)) AND (s.entry_kind <> 'manuel'::text))) AS entry_eff,
    stock_eff_date(s.exit_date, ((s.exit_move_id IS NULL) AND (NOT COALESCE(s.exit_from_file, false)))) AS exit_eff,
    (s.entry_move_id IS NOT NULL) AS entry_saisie,
    (s.exit_move_id IS NOT NULL) AS exit_saisie
   FROM stays s JOIN vehicles v ON v.id = s.vehicle_id AND v.deleted_at IS NULL
  WHERE s.deleted_at IS NULL;

create or replace function public.stock_apply_declared(p_imp bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare imp imports%rowtype; v_prev date; v_low date; n_dates int := 0; n_just int := 0; n_ar int := 0; n_ent int := 0; v_ids bigint[];
begin
  select * into imp from imports where id = p_imp;
  if imp.id is null or imp.declared is null or jsonb_typeof(imp.declared->'mouvements') <> 'object' then return null; end if;
  select max(stock_date) into v_prev from imports where parc_id = imp.parc_id and status = 'valide' and id <> p_imp
    and (stock_date < imp.stock_date or (stock_date = imp.stock_date and id < p_imp));
  v_low := coalesce(v_prev, imp.stock_date - 31);

  drop table if exists t_decl;
  create temp table t_decl on commit drop as
    select x.sens, coalesce(a.chassis, x.c) as chassis,
      case when x.it->>'date' ~ '^\d{4}-\d{2}-\d{2}$' then (x.it->>'date')::date end as d,
      nullif(trim(x.it->>'justif_numero'), '') as num, nullif(trim(x.it->>'justif_type'), '') as typ,
      case when x.it->>'justif_date' ~ '^\d{4}-\d{2}-\d{2}$' then (x.it->>'justif_date')::date end as jd,
      x.it
    from (
      select 'sortie'::text as sens, upper(regexp_replace(coalesce(it->>'chassis', ''), '[\s\-\./_*]', '', 'g')) as c, it
        from jsonb_array_elements(coalesce(imp.declared->'mouvements'->'sorties', '[]'::jsonb)) it
      union all
      select 'entree', upper(regexp_replace(coalesce(it->>'chassis', ''), '[\s\-\./_*]', '', 'g')), it
        from jsonb_array_elements(coalesce(imp.declared->'mouvements'->'entrees', '[]'::jsonb)) it
    ) x left join chassis_aliases a on a.alias = x.c
    where length(x.c) >= 4;
  alter table t_decl add column vid bigint;
  update t_decl t set vid = v.id from vehicles v where v.chassis = t.chassis;

  -- 1. Sorties constatées : date réelle et justification déclarées par le parc
  with u as (
    update stays s set
      exit_date = case when t.d is not null and t.d <= imp.stock_date and t.d > v_low and t.d >= s.entry_date then t.d else s.exit_date end,
      exit_from_file = (t.d is not null and t.d <= imp.stock_date and t.d > v_low and t.d >= s.entry_date),
      justif_type = case when s.justif_status = 'non_justifiee' and t.num is not null then coalesce(t.typ, 'Déclarée par le parc') else s.justif_type end,
      justif_numero = case when s.justif_status = 'non_justifiee' and t.num is not null then t.num else s.justif_numero end,
      justif_date = case when s.justif_status = 'non_justifiee' and t.num is not null then t.jd else s.justif_date end,
      justif_by = case when s.justif_status = 'non_justifiee' and t.num is not null then 'Déclarée par le parc (fichier)' else s.justif_by end,
      justif_at = case when s.justif_status = 'non_justifiee' and t.num is not null then now() else s.justif_at end,
      justif_status = case when s.justif_status = 'non_justifiee' and t.num is not null then 'justifiee' else s.justif_status end,
      updated_at = now()
    from t_decl t
    where t.sens = 'sortie' and t.vid = s.vehicle_id and s.parc_id = imp.parc_id and s.exit_import_id = p_imp and s.deleted_at is null
    returning s.exit_from_file, (s.justif_by = 'Déclarée par le parc (fichier)') as j
  ) select count(*) filter (where exit_from_file), count(*) filter (where j) into n_dates, n_just from u;

  -- 2. Entrées constatées : date réelle déclarée
  with u as (
    update stays s set entry_date = t.d, entry_from_file = true, updated_at = now()
    from t_decl t
    where v_prev is not null and t.sens = 'entree' and t.vid = s.vehicle_id and s.parc_id = imp.parc_id and s.entry_import_id = p_imp
      and s.entry_kind in ('entree', 'transfert') and s.deleted_at is null and t.d is not null and t.d <= imp.stock_date and t.d > v_prev
      and (s.exit_date is null or t.d <= s.exit_date)
    returning 1
  ) select count(*) into n_ent from u;

  -- 3. Allers-retours : déclaré sorti, absent de l'état précédent et de celui-ci → entrée puis sortie
  insert into vehicles (chassis, chassis_raw, marque, modele, annee, navire, manifeste, bl, date_arrivee, importateur)
  select distinct on (t.chassis) t.chassis, coalesce(nullif(t.it->>'chassis_raw', ''), t.chassis), nullif(t.it->>'marque', ''), nullif(t.it->>'modele', ''),
    nullif(t.it->>'annee', ''), nullif(t.it->>'navire', ''), nullif(t.it->>'manifeste', ''), nullif(t.it->>'bl', ''),
    case when t.it->>'date_arrivee' ~ '^\d{4}-\d{2}-\d{2}$' then (t.it->>'date_arrivee')::date end, nullif(t.it->>'importateur', '')
  from t_decl t where t.sens = 'sortie' and t.vid is null
  on conflict (chassis) do nothing;
  update t_decl t set vid = v.id from vehicles v where t.vid is null and v.chassis = t.chassis;

  with ar as (
    select distinct on (o.vid) o.vid, least(coalesce(o.d, imp.stock_date), imp.stock_date) as d_out,
      (select e.d from t_decl e where e.sens = 'entree' and e.vid = o.vid and e.d is not null and e.d > v_low and e.d <= coalesce(o.d, imp.stock_date) order by e.d limit 1) as d_in,
      o.num, o.typ, o.jd, (o.d is not null and o.d > v_low and o.d <= imp.stock_date) as d_ok
    from t_decl o
    where o.sens = 'sortie' and o.vid is not null
      and (o.d is null or (o.d > v_low and o.d <= imp.stock_date))
      and not exists (select 1 from stays s where s.vehicle_id = o.vid and s.parc_id = imp.parc_id and s.deleted_at is null
                      and s.entry_date <= imp.stock_date and (s.exit_date is null or s.exit_date > v_low))
    order by o.vid, o.d
  ), ins as (
    insert into stays (vehicle_id, parc_id, entry_import_id, entry_date, entry_kind, entry_from_file, exit_import_id, exit_date, exit_kind, exit_from_file,
                       last_import_id, justif_type, justif_numero, justif_date, justif_status, justif_by, justif_at, raw)
    select ar.vid, imp.parc_id, p_imp, coalesce(ar.d_in, ar.d_out), 'entree', true, p_imp, ar.d_out, 'sortie', ar.d_ok,
      p_imp, case when ar.num is not null then coalesce(ar.typ, 'Déclarée par le parc') end, ar.num, ar.jd,
      case when ar.num is not null then 'justifiee' else 'non_justifiee' end,
      case when ar.num is not null then 'Déclarée par le parc (fichier)' end, case when ar.num is not null then now() end,
      jsonb_build_object('aller_retour', true)
    from ar
    returning vehicle_id
  ) select count(*), array_agg(vehicle_id) into n_ar, v_ids from ins;
  if n_ar > 0 then perform stock_recompute_current(v_ids); end if;

  update imports set declared = declared || jsonb_build_object('resultat', jsonb_build_object(
    'dates_sorties', n_dates, 'justifiees', n_just, 'dates_entrees', n_ent, 'allers_retours', n_ar)) where id = p_imp;
  return jsonb_build_object('dates_sorties', n_dates, 'justifiees', n_just, 'dates_entrees', n_ent, 'allers_retours', n_ar);
end $$;
revoke all on function public.stock_apply_declared(bigint) from public, anon, authenticated;
grant execute on function public.stock_apply_declared(bigint) to service_role;

-- Appel à la fin de chaque application d'un import (import normal, import en retard, recalcul du parc)
do $$
declare d text;
begin
  d := pg_get_functiondef('public.stock_apply_import(bigint)'::regprocedure);
  if position('stock_apply_declared' in d) = 0 then
    d := replace(d, '  update imports set nb_chassis = n_tot,', '  perform stock_apply_declared(p_imp);' || chr(10) || '  update imports set nb_chassis = n_tot,');
    if position('stock_apply_declared' in d) = 0 then raise exception 'stock_apply_import : point d''insertion introuvable'; end if;
    execute d;
  end if;
end $$;

-- Contradictions entre les mouvements déclarés et le stock (dernier état du parc) : « À régulariser »
create or replace function public.stock_declared_issues(p_parc bigint)
returns table(motif text, vehicle_id bigint, chassis text, marque text, modele text, navire text, manifeste text, date_ref date, jours int, autre_parc text, detail jsonb)
language sql stable security definer set search_path = public as $$
  with imp as (
    select i.* from imports i where i.parc_id = p_parc and i.status = 'valide'
    order by i.stock_date desc, i.id desc limit 1
  ), d as (
    select x.sens, coalesce(a.chassis, x.c) as chassis, x.it, imp.id as imp_id, imp.stock_date, imp.file_name
    from imp, lateral (
      select 'sortie'::text as sens, upper(regexp_replace(coalesce(it->>'chassis', ''), '[\s\-\./_*]', '', 'g')) as c, it
        from jsonb_array_elements(coalesce(imp.declared->'mouvements'->'sorties', '[]'::jsonb)) it
      union all
      select 'entree', upper(regexp_replace(coalesce(it->>'chassis', ''), '[\s\-\./_*]', '', 'g')), it
        from jsonb_array_elements(coalesce(imp.declared->'mouvements'->'entrees', '[]'::jsonb)) it
    ) x left join chassis_aliases a on a.alias = x.c
    where length(x.c) >= 4
  )
  select 'declare_sorti_present', v.id, v.chassis, v.marque, v.modele, v.navire, v.manifeste, d.stock_date, null::int, null::text,
    jsonb_build_object('date_declaree', d.it->>'date', 'numero', d.it->>'justif_numero', 'fichier', d.file_name)
  from d join vehicles v on v.chassis = d.chassis and v.deleted_at is null
  where d.sens = 'sortie' and exists (select 1 from stays s where s.vehicle_id = v.id and s.parc_id = p_parc and s.exit_date is null and s.deleted_at is null)
  union all
  select 'declare_entre_absent', v.id, d.chassis, coalesce(v.marque, nullif(d.it->>'marque', '')), coalesce(v.modele, nullif(d.it->>'modele', '')),
    coalesce(v.navire, nullif(d.it->>'navire', '')), v.manifeste, d.stock_date, null::int, null::text,
    jsonb_build_object('date_declaree', d.it->>'date', 'fichier', d.file_name)
  from d left join vehicles v on v.chassis = d.chassis and v.deleted_at is null
  where d.sens = 'entree'
    and not exists (select 1 from stays s where s.vehicle_id = v.id and s.parc_id = p_parc and s.deleted_at is null
                    and (s.exit_date is null or s.exit_import_id = d.imp_id or s.entry_import_id = d.imp_id))
    and not exists (select 1 from d d2 where d2.sens = 'sortie' and d2.chassis = d.chassis)
$$;
revoke all on function public.stock_declared_issues(bigint) from public, anon, authenticated;
grant execute on function public.stock_declared_issues(bigint) to service_role;

do $$
declare d text;
begin
  d := pg_get_functiondef('public.stock_regulariser(bigint,date,integer,boolean)'::regprocedure);
  if position('stock_declared_issues' in d) = 0 then
    d := regexp_replace(d, '\$function\$\s*$', '');
    d := regexp_replace(d, '\s+$', '');
    d := d || chr(10) || '  union all' || chr(10) || '  select * from stock_declared_issues(p_parc)' || chr(10) || '$function$';
    execute d;
  end if;
end $$;
