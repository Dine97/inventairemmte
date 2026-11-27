-- 6.19.2 — « Mouvements par semaine » et ses détails ne répondaient plus (délai dépassé) :
-- v_stays_eff recalculait toutes les paires de transfert pour CHAQUE séjour (17 640 fois).
-- Les paires sont maintenant calculées une seule fois puis jointes : plus de 60 s → 0,03 s. Même résultat.
create or replace view public.v_stays_eff as
with tp as materialized (select * from public.v_transfer_pairs),
pb as (select distinct on (b_stay) b_stay, t_eff, from_parc_id, confirme from tp order by b_stay),
pa as (select distinct on (a_stay) a_stay, t_eff, to_parc_id, confirme from tp where a_stay is not null and exit_date is not null order by a_stay, entry_date)
select r.stay_id, r.vehicle_id, r.parc_id, r.entry_kind, r.exit_kind, r.entry_date, r.exit_date, r.from_parc_id, r.to_parc_id,
    coalesce(pb.t_eff, r.entry_eff) as entry_eff,
    case when r.exit_date is null then null::date else coalesce(pa.t_eff, r.exit_eff) end as exit_eff,
    r.entry_saisie, r.exit_saisie,
    pb.from_parc_id as tr_from, pb.confirme as tr_from_confirme, pa.to_parc_id as tr_to, pa.confirme as tr_to_confirme
from public.v_stays_eff_raw r
left join pb on pb.b_stay = r.stay_id
left join pa on pa.a_stay = r.stay_id;
