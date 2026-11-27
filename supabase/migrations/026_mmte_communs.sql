-- 6.19.1 — Contrôle avec MMTE : la liste « présents des deux côtés » est conservée avec chaque contrôle
-- (la liste « lus dans MMTE » est reconstituée à l'écran : présents + sortis + autres parcs + inconnus)
create or replace function public.stock_mmte_sync(p jsonb)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_duree int; v_ids bigint[]; v_tous boolean; v_key text; v_parcs text; v_names jsonb;
  r_abs jsonb; r_com jsonb; r_sor jsonb; r_aut jsonb; r_inc jsonb; r_eca jsonb; n_lus int; n_com int; n_dep int; n_inc int;
  v_prev record; v_new jsonb := '[]'; n_reg int; v_row mmte_controles%rowtype;
begin
  select coalesce((value)::int, 365) into v_duree from settings where key = 'duree_sejour';
  v_duree := coalesce(v_duree, 365);
  v_tous := coalesce((p->>'tous')::boolean, false);
  v_names := coalesce(p->'parc_names', case when coalesce(p->>'parc_name', '') <> '' then jsonb_build_array(p->>'parc_name') else '[]'::jsonb end);
  if v_tous then v_parcs := 'Tous les parcs';
  else
    select array_agg(id order by id), string_agg(name, ', ' order by name) into v_ids, v_parcs
    from parcs where deleted_at is null and name in (select upper(trim(x)) from jsonb_array_elements_text(v_names) x);
  end if;
  v_key := case when v_tous then 'tous' when v_ids is null then 'aucun' else array_to_string(v_ids, ',') end;

  drop table if exists t_m;
  create temp table t_m on commit drop as
    select distinct on (c) c as chassis, nullif(r->>'depot','')::date as depot, nullif(r->>'entry','')::date as entry,
           nullif(r->>'registred','')::date as reg, coalesce(r->'data','{}'::jsonb) as data
    from (select coalesce(a.chassis, upper(r->>'chassis')) as c, r from jsonb_array_elements(p->'rows') r
          left join chassis_aliases a on a.alias = upper(r->>'chassis') where coalesce(r->>'chassis','') <> '') z
    order by c;
  create index on t_m(chassis);
  analyze t_m;

  -- véhicules présents dans les parcs contrôlés (avant la mise à jour des dates MMTE, pour connaître le dernier passage)
  drop table if exists t_sc;
  create temp table t_sc on commit drop as
    select v.id, v.chassis, v.marque, v.modele, v.annee, v.navire, v.manifeste, v.bl, v.date_arrivee, v.date_transfert,
           v.mmte_depot_date, v.mmte_sync_at, v.current_parc_id, pc.name as parc
    from vehicles v join parcs pc on pc.id = v.current_parc_id
    where v.deleted_at is null and (v_tous or v.current_parc_id = any(coalesce(v_ids, '{}'::bigint[])));
  create index on t_sc(chassis);

  select count(*), count(*) filter (where depot is not null) into n_lus, n_dep from t_m;
  select count(*) into n_com from t_m t join t_sc s on s.chassis = t.chassis;

  select coalesce(jsonb_agg(jsonb_build_object('chassis', s.chassis, 'id', s.id, 'marque', s.marque, 'modele', s.modele, 'annee', s.annee,
      'navire', s.navire, 'manifeste', s.manifeste, 'bl', s.bl, 'date_arrivee', s.date_arrivee, 'date_transfert', s.date_transfert,
      'mmte_depot_date', s.mmte_depot_date, 'parc', s.parc, 'mmte_vu', s.mmte_sync_at,
      'entry_date', st.entry_date, 'entry_kind', st.entry_kind, 'from_parc', fp.name) order by s.parc, s.chassis), '[]')
  into r_abs
  from t_sc s
  left join lateral (select entry_date, entry_kind, from_parc_id from stays x where x.vehicle_id = s.id and x.parc_id = s.current_parc_id
                     and x.exit_date is null and x.deleted_at is null order by x.entry_date desc limit 1) st on true
  left join parcs fp on fp.id = st.from_parc_id
  where not exists (select 1 from t_m t where t.chassis = s.chassis);

  -- présents des deux côtés (6.19.1) : liste conservée pour affichage
  select coalesce(jsonb_agg(jsonb_build_object('chassis', s.chassis, 'id', s.id, 'marque', s.marque, 'modele', s.modele, 'annee', s.annee,
      'navire', s.navire, 'manifeste', s.manifeste, 'date_arrivee', s.date_arrivee, 'parc', s.parc, 'depot_mmte', t.depot,
      'ecart', case when t.depot is not null and s.date_arrivee is not null then t.depot - (s.date_arrivee + v_duree) end,
      'mmte_navire', t.data->>'navire', 'mmte_manifeste', t.data->>'manifeste') order by s.parc, s.chassis), '[]')
  into r_com
  from t_m t join t_sc s on s.chassis = t.chassis;

  select coalesce(jsonb_agg(jsonb_build_object('chassis', v.chassis, 'id', v.id, 'marque', v.marque, 'modele', v.modele, 'annee', v.annee,
      'parc', ls.parc, 'exit_date', ls.exit_date, 'exit_kind', ls.exit_kind, 'justif_type', ls.justif_type, 'justif_numero', ls.justif_numero,
      'justif_status', ls.justif_status, 'depot_mmte', t.depot, 'mmte', t.data) order by ls.exit_date desc nulls last, v.chassis), '[]')
  into r_sor
  from t_m t join vehicles v on v.chassis = t.chassis and v.deleted_at is null and v.current_parc_id is null
  left join lateral (select x.exit_date, x.exit_kind, x.justif_type, x.justif_numero, x.justif_status, pp.name as parc
                     from stays x join parcs pp on pp.id = x.parc_id where x.vehicle_id = v.id and x.deleted_at is null
                     order by x.exit_date desc nulls first limit 1) ls on true;

  select coalesce(jsonb_agg(jsonb_build_object('chassis', v.chassis, 'id', v.id, 'marque', v.marque, 'modele', v.modele, 'parc', pc.name,
      'depot_mmte', t.depot, 'mmte', t.data) order by pc.name, v.chassis), '[]')
  into r_aut
  from t_m t join vehicles v on v.chassis = t.chassis and v.deleted_at is null and v.current_parc_id is not null
  join parcs pc on pc.id = v.current_parc_id
  where not v_tous and v_ids is not null and not (v.current_parc_id = any(v_ids));

  -- inconnus des stocks : suggestion d'un véhicule connu à 1 ou 2 caractères près (300 premiers)
  drop table if exists t_inc;
  create temp table t_inc on commit drop as
    select t.*, row_number() over (order by t.chassis) as rn from t_m t
    where not exists (select 1 from vehicles v where v.chassis = t.chassis);
  select count(*) into n_inc from t_inc;
  select coalesce(jsonb_agg(jsonb_build_object('chassis', i.chassis, 'depot_mmte', i.depot, 'mmte', i.data,
      'proche', pr.match, 'proche_parc', pr.parc, 'proche_present', pr.present) order by i.chassis), '[]')
  into r_inc
  from (select * from t_inc where rn <= 20000) i
  left join lateral (
    select v.chassis as match, pc.name as parc, (v.current_parc_id is not null) as present
    from vehicles v left join parcs pc on pc.id = v.current_parc_id
    where i.rn <= 300 and v.deleted_at is null and abs(length(v.chassis) - length(i.chassis)) <= 2
      and levenshtein_less_equal(i.chassis, v.chassis, 2) <= 2
    order by levenshtein_less_equal(i.chassis, v.chassis, 2), (v.current_parc_id is not null) desc limit 1) pr on true;

  select coalesce(jsonb_agg(x order by abs(x.ecart) desc), '[]') into r_eca from (
    select v.chassis, v.id, pc.name as parc, v.date_arrivee, v.date_arrivee + v_duree as depot_calcule, t.depot as depot_mmte,
           (t.depot - (v.date_arrivee + v_duree)) as ecart
    from t_m t join vehicles v on v.chassis = t.chassis left join parcs pc on pc.id = v.current_parc_id
    where t.depot is not null and v.date_arrivee is not null and abs(t.depot - (v.date_arrivee + v_duree)) > 3
    order by abs(t.depot - (v.date_arrivee + v_duree)) desc limit 2000) x;

  -- dates MMTE notées sur les fiches (comme avant) : rien d'autre n'est modifié dans le stock
  update vehicles v set mmte_depot_date = t.depot, mmte_entry_date = t.entry, mmte_registred_at = t.reg, mmte_data = t.data, mmte_sync_at = now()
  from t_m t where v.chassis = t.chassis;

  -- comparaison avec le contrôle précédent des mêmes parcs
  select id, result->'absents' as abs into v_prev from mmte_controles
  where scope_key = v_key and deleted_at is null order by at desc limit 1;
  if v_prev.id is not null then
    select coalesce(jsonb_agg(a->>'chassis'), '[]') into v_new from jsonb_array_elements(r_abs) a
    where not exists (select 1 from jsonb_array_elements(coalesce(v_prev.abs, '[]')) b where b->>'chassis' = a->>'chassis');
    select count(*) into n_reg from jsonb_array_elements(coalesce(v_prev.abs, '[]')) b
    where not exists (select 1 from jsonb_array_elements(r_abs) a where a->>'chassis' = b->>'chassis');
  end if;

  insert into mmte_controles(by_uid, by_name, scope_key, parc_ids, parcs, source, lus, communs, absents, sortis, autres, inconnus, ecarts, depot_lus,
                             nouveaux, regularises, prev_id, result)
  values (p->>'by_uid', p->>'by_name', v_key, v_ids, v_parcs, left(p->>'source', 200), n_lus, n_com, jsonb_array_length(r_abs), jsonb_array_length(r_sor),
          jsonb_array_length(r_aut), n_inc, jsonb_array_length(r_eca), n_dep,
          case when v_prev.id is null then null else jsonb_array_length(v_new) end, n_reg, v_prev.id,
          jsonb_build_object('absents', r_abs, 'communs', r_com, 'sortis', r_sor, 'autres', r_aut, 'inconnus', r_inc, 'ecarts', r_eca, 'nouveaux', v_new, 'duree', v_duree))
  returning * into v_row;
  return to_jsonb(v_row);
end $$;
revoke all on function public.stock_mmte_sync(jsonb) from public, anon, authenticated;
grant execute on function public.stock_mmte_sync(jsonb) to service_role;

-- reprise des contrôles déjà faits : véhicules des parcs contrôlés passés dans MMTE lors du contrôle
update public.mmte_controles c set result = c.result || jsonb_build_object('communs', coalesce((
  select jsonb_agg(jsonb_build_object('chassis', v.chassis, 'id', v.id, 'marque', v.marque, 'modele', v.modele, 'annee', v.annee,
      'navire', v.navire, 'manifeste', v.manifeste, 'date_arrivee', v.date_arrivee, 'parc', pc.name, 'depot_mmte', v.mmte_depot_date,
      'ecart', case when v.mmte_depot_date is not null and v.date_arrivee is not null then v.mmte_depot_date - (v.date_arrivee + coalesce((c.result->>'duree')::int, 365)) end,
      'mmte_navire', v.mmte_data->>'navire', 'mmte_manifeste', v.mmte_data->>'manifeste') order by pc.name, v.chassis)
  from vehicles v join parcs pc on pc.id = v.current_parc_id
  where v.deleted_at is null and (c.scope_key = 'tous' or v.current_parc_id = any(coalesce(c.parc_ids, '{}')))
    and v.mmte_sync_at between c.at - interval '10 minutes' and c.at + interval '10 minutes'), '[]'))
where c.deleted_at is null and not (c.result ? 'communs');
