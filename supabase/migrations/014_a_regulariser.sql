-- 6.11.0 — Onglet « À régulariser » de chaque parc : toutes les situations à traiter, au même endroit.
-- Aucune donnée n'est modifiée : simple lecture des stocks.
create or replace function public.stock_regulariser(p_parc bigint, p_ref date, p_duree int, p_mmte boolean)
returns table(motif text, vehicle_id bigint, chassis text, marque text, modele text, navire text, manifeste text,
  date_ref date, jours int, autre_parc text, detail jsonb)
language sql stable security definer set search_path = public, extensions as $$
  with pres as (
    select s.id as stay_id, s.vehicle_id, s.entry_date, v.chassis, v.marque, v.modele, v.navire, v.manifeste, v.date_arrivee, v.mmte_depot_date,
      case when p_mmte and v.mmte_depot_date is not null then v.mmte_depot_date when v.date_arrivee is not null then v.date_arrivee + p_duree end as depot
    from stays s join vehicles v on v.id = s.vehicle_id and v.deleted_at is null
    where s.parc_id = p_parc and s.exit_date is null and s.deleted_at is null
  )
  -- 1. Dépôt dépassé : délai de séjour expiré, véhicule toujours dans le parc
  select 'depot_depasse', p.vehicle_id, p.chassis, p.marque, p.modele, p.navire, p.manifeste, p.depot, (p_ref - p.depot)::int, null::text,
    jsonb_build_object('date_arrivee', p.date_arrivee)
  from pres p where p.depot is not null and p.depot < p_ref
  union all
  -- 2. Double présence : le véhicule figure aussi dans le stock d'un autre parc
  select 'double_presence', p.vehicle_id, p.chassis, p.marque, p.modele, p.navire, p.manifeste, o.entry_date, null, po.name,
    jsonb_build_object('entree_ici', p.entry_date, 'entree_autre', o.entry_date)
  from pres p join stays o on o.vehicle_id = p.vehicle_id and o.parc_id <> p_parc and o.exit_date is null and o.deleted_at is null
  join parcs po on po.id = o.parc_id
  union all
  -- 3. Transfert à confirmer : sortie d'un parc puis entrée dans un autre au-delà du délai automatique
  select 'transfert_a_confirmer', c.vehicle_id, c.chassis, c.marque, c.modele, null, null, c.date_arrivee, c.ecart,
    case when c.depart_id = p_parc then c.arrivee else c.depart end,
    jsonb_build_object('depart_id', c.depart_id, 'depart', c.depart, 'date_sortie', c.date_sortie, 'arrivee_id', c.arrivee_id,
      'arrivee', c.arrivee, 'date_arrivee', c.date_arrivee, 'sens', case when c.depart_id = p_parc then 'sortie' else 'entree' end)
  from stock_transfer_candidates(180) c where c.depart_id = p_parc or c.arrivee_id = p_parc
  union all
  -- 4. Revenu dans le parc après en être sorti (sortie à vérifier)
  select 'reapparu', v.id, v.chassis, v.marque, v.modele, v.navire, v.manifeste, s2.entry_date, (s2.entry_date - s1.exit_date)::int, null,
    jsonb_build_object('date_sortie', s1.exit_date, 'date_retour', s2.entry_date)
  from stays s1 join stays s2 on s2.vehicle_id = s1.vehicle_id and s2.parc_id = s1.parc_id and s2.entry_date > s1.exit_date
    and s2.entry_kind = 'entree' and s2.exit_date is null and s2.deleted_at is null
  join vehicles v on v.id = s1.vehicle_id and v.deleted_at is null
  where s1.parc_id = p_parc and s1.exit_kind = 'sortie' and s1.deleted_at is null
  union all
  -- 5. Châssis proches : une sortie et une entrée le même jour avec deux châssis presque identiques (faute de frappe probable)
  select 'chassis_proche', ve.id, ve.chassis, ve.marque, ve.modele, ve.navire, ve.manifeste, e.entry_date,
    extensions.levenshtein(ve.chassis, vx.chassis), null,
    jsonb_build_object('autre_chassis', vx.chassis, 'autre_id', vx.id)
  from stays e join stays x on x.exit_import_id = e.entry_import_id and x.parc_id = e.parc_id
  join vehicles ve on ve.id = e.vehicle_id and ve.deleted_at is null join vehicles vx on vx.id = x.vehicle_id and vx.deleted_at is null
  where e.parc_id = p_parc and e.entry_kind = 'entree' and x.exit_kind = 'sortie' and e.deleted_at is null and x.deleted_at is null
    and e.exit_date is null and length(ve.chassis) <= 30 and length(vx.chassis) <= 30
    and extensions.levenshtein(ve.chassis, vx.chassis) between 1 and 2
  union all
  -- 6. Date d'arrivée manquante : date de dépôt impossible à calculer
  select 'sans_date', p.vehicle_id, p.chassis, p.marque, p.modele, p.navire, p.manifeste, p.entry_date, null, null, '{}'::jsonb
  from pres p where p.date_arrivee is null and not (p_mmte and p.mmte_depot_date is not null)
  union all
  -- 7. Châssis atypique : pas 17 caractères ou lettres I, O, Q
  select 'chassis_atypique', p.vehicle_id, p.chassis, p.marque, p.modele, p.navire, p.manifeste, p.entry_date, length(p.chassis), null, '{}'::jsonb
  from pres p where length(p.chassis) <> 17 or p.chassis ~ '[IOQ]'
$$;
revoke all on function public.stock_regulariser(bigint, date, int, boolean) from public, anon, authenticated;
grant execute on function public.stock_regulariser(bigint, date, int, boolean) to service_role;
