-- 6.10.0 — Un transfert compte dans la semaine de DÉPART pour les deux parcs (décision du 09/11/2026 :
-- les transferts se font le plus souvent dans la même semaine). Le véhicule quitte le parc de départ et entre
-- dans le parc d'arrivée à la même date effective : la plus ancienne des deux (sortie constatée au départ,
-- entrée constatée à l'arrivée). Les stocks par semaine restent ainsi justes pour chaque parc.
-- Tant que le parc de départ n'a pas envoyé de fichier sans le véhicule (« double présence »), la date d'arrivée est gardée.
drop view if exists public.v_mouvements;
drop view if exists public.v_stays_eff;

create or replace view public.v_stays_eff_raw as
  select s.id as stay_id, s.vehicle_id, s.parc_id, s.entry_kind, s.exit_kind, s.entry_date, s.exit_date,
    s.from_parc_id, s.to_parc_id,
    stock_eff_date(s.entry_date, s.entry_move_id is null and not coalesce(s.entry_from_file, false) and s.entry_kind <> 'manuel') as entry_eff,
    stock_eff_date(s.exit_date, s.exit_move_id is null) as exit_eff,
    (s.entry_move_id is not null) as entry_saisie, (s.exit_move_id is not null) as exit_saisie
  from stays s join vehicles v on v.id = s.vehicle_id and v.deleted_at is null
  where s.deleted_at is null;

-- Paires de transfert : arrivée dans le parc B (b_stay) et séjour quitté dans le parc A (a_stay)
create or replace view public.v_transfer_pairs as
  select b.stay_id as b_stay, b.vehicle_id, b.parc_id as to_parc_id, b.entry_date, b.entry_eff,
    coalesce(lk.from_parc_id, b.from_parc_id) as from_parc_id, (lk.id is not null) as confirme,
    a.stay_id as a_stay, a.exit_date, a.exit_eff,
    case when a.exit_eff is not null then least(a.exit_eff, b.entry_eff) else b.entry_eff end as t_eff
  from v_stays_eff_raw b
  left join stock_transfer_links lk on lk.decision = 'transfert' and lk.vehicle_id = b.vehicle_id
    and lk.to_parc_id = b.parc_id and lk.entry_date = b.entry_date
  left join lateral (
    select x.stay_id, x.exit_date, x.exit_eff from v_stays_eff_raw x
    where x.vehicle_id = b.vehicle_id and x.parc_id = coalesce(lk.from_parc_id, b.from_parc_id)
      and x.stay_id <> b.stay_id and x.entry_date <= b.entry_date
    order by x.entry_date desc, x.stay_id desc limit 1
  ) a on true
  where (b.entry_kind = 'transfert' and b.from_parc_id is not null) or lk.id is not null;

create or replace view public.v_stays_eff as
  select r.stay_id, r.vehicle_id, r.parc_id, r.entry_kind, r.exit_kind, r.entry_date, r.exit_date, r.from_parc_id, r.to_parc_id,
    coalesce(pb.t_eff, r.entry_eff) as entry_eff,
    case when r.exit_date is null then null else coalesce(pa.t_eff, r.exit_eff) end as exit_eff,
    r.entry_saisie, r.exit_saisie,
    pb.from_parc_id as tr_from, pb.confirme as tr_from_confirme,
    pa.to_parc_id as tr_to, pa.confirme as tr_to_confirme
  from v_stays_eff_raw r
  left join lateral (select p.t_eff, p.from_parc_id, p.confirme from v_transfer_pairs p where p.b_stay = r.stay_id limit 1) pb on true
  left join lateral (select p.t_eff, p.to_parc_id, p.confirme from v_transfer_pairs p where p.a_stay = r.stay_id and p.exit_date is not null
                     order by p.entry_date limit 1) pa on true;

create or replace view public.v_mouvements as
  with ev as (
    select e.stay_id, e.vehicle_id, e.parc_id,
      case when e.tr_from is not null then 'transfert_recu' else 'entree' end as type,
      e.entry_date as date_mvt, e.entry_eff as date_eff, e.tr_from as autre_parc_id,
      e.entry_saisie as saisie, coalesce(e.tr_from_confirme, false) as confirme
    from v_stays_eff e where e.entry_kind <> 'initial'
    union all
    select x.stay_id, x.vehicle_id, x.parc_id,
      case when x.exit_kind = 'transfert' or x.tr_to is not null then 'transfert_envoye' else 'sortie' end,
      x.exit_date, x.exit_eff, coalesce(x.tr_to, case when x.exit_kind = 'transfert' then x.to_parc_id end),
      x.exit_saisie, coalesce(x.tr_to_confirme, false)
    from v_stays_eff x where x.exit_kind is not null
  )
  select ev.*, date_trunc('week', ev.date_eff)::date as semaine,
    p.name as parc, ap.name as autre_parc,
    v.chassis, v.chassis_raw, v.marque, v.modele, v.annee, v.navire, v.manifeste, v.bl, v.date_arrivee, v.date_transfert,
    v.importateur, v.mmte_depot_date, v.current_parc_id,
    s.entry_date, s.entry_kind, s.exit_date, s.exit_kind, s.justif_type, s.justif_numero, s.justif_status, s.justif_by
  from ev
  join stays s on s.id = ev.stay_id
  join vehicles v on v.id = ev.vehicle_id
  join parcs p on p.id = ev.parc_id
  left join parcs ap on ap.id = ev.autre_parc_id;
revoke all on public.v_stays_eff_raw, public.v_transfer_pairs, public.v_stays_eff, public.v_mouvements from anon, authenticated;

create or replace function public.stock_transfers(p_parc bigint, p_from date, p_to date)
returns table(vehicle_id bigint, chassis text, marque text, modele text, navire text, manifeste text,
  depart_id bigint, depart text, arrivee_id bigint, arrivee text, date_sortie date, date_arrivee date,
  semaine_depart date, semaine_arrivee date, statut text, delai int, origine text)
language sql stable security definer set search_path = public as $$
  select t.vehicle_id, v.chassis, v.marque, v.modele, v.navire, v.manifeste,
    t.from_parc_id, pa.name, t.to_parc_id, pb.name, t.exit_date, t.entry_date,
    case when t.exit_date is not null then date_trunc('week', t.t_eff)::date end, date_trunc('week', t.t_eff)::date,
    case when t.a_stay is not null and t.exit_date is null then 'double_presence' else 'complet' end,
    case when t.exit_date is not null then t.entry_date - t.exit_date end,
    case when t.confirme then 'confirme' else 'automatique' end
  from v_transfer_pairs t
  join vehicles v on v.id = t.vehicle_id
  join parcs pa on pa.id = t.from_parc_id
  join parcs pb on pb.id = t.to_parc_id
  where (p_parc is null or t.to_parc_id = p_parc or t.from_parc_id = p_parc)
    and (date_trunc('week', t.t_eff)::date between date_trunc('week', p_from)::date and date_trunc('week', p_to)::date
      or (t.a_stay is not null and t.exit_date is null))
  order by t.entry_date desc, v.chassis;
$$;
revoke all on function public.stock_transfers(bigint, date, date) from public, anon, authenticated;
grant execute on function public.stock_transfers(bigint, date, date) to service_role;
