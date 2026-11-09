-- 6.10.0 — Mouvements classés par semaine (du lundi au dimanche) et transferts parc à parc
--
-- Règles décidées le 09/11/2026 :
--  * une semaine va du lundi au dimanche (des véhicules peuvent entrer sur un parc le week-end) ;
--  * un mouvement CONSTATÉ par comparaison de fichiers prend la date du fichier ; un fichier daté d'un lundi
--    décrit l'état du lundi matin, ses mouvements ont donc eu lieu la semaine précédente (date effective = dimanche) ;
--    une date réelle (saisie manuelle, date d'entrée lue dans le fichier) est gardée telle quelle ;
--  * un transfert compte dans la semaine de départ (précisé par la migration 013 : pour les deux parcs) ;
--  * transfert reconnu automatiquement si la sortie du premier parc date de 14 jours au plus.

update public.settings set value = '14', updated_at = now(), updated_by = 'Migration 012' where key = 'fenetre_transfert';
insert into public.settings(key, value, updated_by) select 'fenetre_transfert', '14', 'Migration 012'
where not exists (select 1 from public.settings where key = 'fenetre_transfert');

-- Transferts confirmés (ou écartés) par un agent, au-delà du délai de reconnaissance automatique.
-- Clé : véhicule + parcs + dates (les séjours sont recalculés lors d'un import en retard, leurs numéros changent).
create table if not exists public.stock_transfer_links (
  id bigserial primary key,
  vehicle_id bigint not null references public.vehicles(id) on delete cascade,
  from_parc_id bigint not null references public.parcs(id) on delete cascade,
  exit_date date not null,
  to_parc_id bigint not null references public.parcs(id) on delete cascade,
  entry_date date not null,
  decision text not null check (decision in ('transfert', 'distinct')),
  by_name text,
  at timestamptz not null default now(),
  unique (vehicle_id, from_parc_id, exit_date, to_parc_id, entry_date)
);
create index if not exists stock_transfer_links_to_idx on public.stock_transfer_links(vehicle_id, to_parc_id, entry_date);
alter table public.stock_transfer_links enable row level security;
revoke all on public.stock_transfer_links from anon, authenticated;

-- Date effective d'un mouvement
create or replace function public.stock_eff_date(d date, constate boolean)
returns date language sql immutable as $$
  select case when d is null then null when constate and extract(isodow from d) = 1 then d - 1 else d end
$$;

-- Séjours avec dates effectives d'entrée et de sortie (base des calculs par semaine)
create or replace view public.v_stays_eff as
  select s.id as stay_id, s.vehicle_id, s.parc_id, s.entry_kind, s.exit_kind, s.entry_date, s.exit_date,
    s.from_parc_id, s.to_parc_id,
    stock_eff_date(s.entry_date, s.entry_move_id is null and not coalesce(s.entry_from_file, false) and s.entry_kind <> 'manuel') as entry_eff,
    stock_eff_date(s.exit_date, s.exit_move_id is null) as exit_eff,
    (s.entry_move_id is not null) as entry_saisie, (s.exit_move_id is not null) as exit_saisie
  from stays s join vehicles v on v.id = s.vehicle_id and v.deleted_at is null
  where s.deleted_at is null;
revoke all on public.v_stays_eff from anon, authenticated;

-- Un événement par mouvement : entrée, sortie, transfert reçu, transfert envoyé
create or replace view public.v_mouvements as
  with e as (
    select s.*, lk.from_parc_id as lk_from
    from v_stays_eff s
    left join stock_transfer_links lk on lk.decision = 'transfert' and lk.vehicle_id = s.vehicle_id
      and lk.to_parc_id = s.parc_id and lk.entry_date = s.entry_date
  ), x as (
    select s.*, lk.to_parc_id as lk_to
    from v_stays_eff s
    left join stock_transfer_links lk on lk.decision = 'transfert' and lk.vehicle_id = s.vehicle_id
      and lk.from_parc_id = s.parc_id and lk.exit_date = s.exit_date
  ), ev as (
    select e.stay_id, e.vehicle_id, e.parc_id,
      case when e.entry_kind = 'transfert' or e.lk_from is not null then 'transfert_recu' else 'entree' end as type,
      e.entry_date as date_mvt, e.entry_eff as date_eff,
      coalesce(e.lk_from, case when e.entry_kind = 'transfert' then e.from_parc_id end) as autre_parc_id,
      e.entry_saisie as saisie, (e.lk_from is not null) as confirme
    from e where e.entry_kind <> 'initial'
    union all
    select x.stay_id, x.vehicle_id, x.parc_id,
      case when x.exit_kind = 'transfert' or x.lk_to is not null then 'transfert_envoye' else 'sortie' end,
      x.exit_date, x.exit_eff,
      coalesce(x.lk_to, case when x.exit_kind = 'transfert' then x.to_parc_id end),
      x.exit_saisie, (x.lk_to is not null)
    from x where x.exit_kind is not null
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
revoke all on public.v_mouvements from anon, authenticated;

-- Tableau par semaine : stock début, premier fichier, entrées, sorties, transferts reçus / envoyés, stock fin
create or replace function public.stock_weeks(p_parc bigint, p_from date, p_to date)
returns table(semaine date, stock_debut int, initial int, entrees int, sorties int, tr_recus int, tr_envoyes int, stock_fin int)
language sql stable security definer set search_path = public as $$
  with w as (
    select g::date as l from generate_series(date_trunc('week', p_from)::date, date_trunc('week', p_to)::date, interval '7 day') g
  ), s as (
    select entry_kind, entry_eff, exit_eff from v_stays_eff where p_parc is null or parc_id = p_parc
  ), m as (
    select type, semaine from v_mouvements where (p_parc is null or parc_id = p_parc)
      and semaine between date_trunc('week', p_from)::date and date_trunc('week', p_to)::date
  )
  select w.l,
    (select count(*) from s where s.entry_eff <= w.l - 1 and (s.exit_eff is null or s.exit_eff > w.l - 1))::int,
    (select count(*) from s where s.entry_kind = 'initial' and s.entry_eff between w.l and w.l + 6)::int,
    (select count(*) from m where m.semaine = w.l and m.type = 'entree')::int,
    (select count(*) from m where m.semaine = w.l and m.type = 'sortie')::int,
    (select count(*) from m where m.semaine = w.l and m.type = 'transfert_recu')::int,
    (select count(*) from m where m.semaine = w.l and m.type = 'transfert_envoye')::int,
    (select count(*) from s where s.entry_eff <= w.l + 6 and (s.exit_eff is null or s.exit_eff > w.l + 6))::int
  from w order by w.l desc;
$$;

-- Transferts parc à parc : un par arrivée dans le parc de destination
create or replace function public.stock_transfers(p_parc bigint, p_from date, p_to date)
returns table(vehicle_id bigint, chassis text, marque text, modele text, navire text, manifeste text,
  depart_id bigint, depart text, arrivee_id bigint, arrivee text, date_sortie date, date_arrivee date,
  semaine_depart date, semaine_arrivee date, statut text, delai int, origine text)
language sql stable security definer set search_path = public as $$
  select m.vehicle_id, m.chassis, m.marque, m.modele, m.navire, m.manifeste,
    m.autre_parc_id, m.autre_parc, m.parc_id, m.parc, a.exit_date, m.date_mvt,
    case when a.exit_eff is not null then date_trunc('week', a.exit_eff)::date end, m.semaine,
    case when a.stay_id is not null and a.exit_date is null then 'double_presence' else 'complet' end,
    case when a.exit_date is not null then m.date_mvt - a.exit_date end,
    case when m.confirme then 'confirme' else 'automatique' end
  from v_mouvements m
  left join lateral (
    select x.stay_id, x.exit_date, x.exit_eff from v_stays_eff x
    where x.vehicle_id = m.vehicle_id and x.parc_id = m.autre_parc_id and x.entry_date <= m.date_mvt
    order by x.entry_date desc, x.stay_id desc limit 1
  ) a on true
  where m.type = 'transfert_recu'
    and (p_parc is null or m.parc_id = p_parc or m.autre_parc_id = p_parc)
    and ((m.semaine between date_trunc('week', p_from)::date and date_trunc('week', p_to)::date)
      or (a.exit_eff is not null and date_trunc('week', a.exit_eff)::date between date_trunc('week', p_from)::date and date_trunc('week', p_to)::date)
      or (a.stay_id is not null and a.exit_date is null))
  order by m.date_mvt desc, m.chassis;
$$;

-- Transferts possibles à confirmer : sortie d'un parc puis entrée dans un autre au-delà du délai automatique
create or replace function public.stock_transfer_candidates(p_max_days int default 180)
returns table(vehicle_id bigint, chassis text, marque text, modele text, depart_id bigint, depart text, date_sortie date,
  arrivee_id bigint, arrivee text, date_arrivee date, ecart int, justif_type text, justif_status text)
language sql stable security definer set search_path = public as $$
  select v.id, v.chassis, v.marque, v.modele, a.parc_id, pa.name, a.exit_date, b.parc_id, pb.name, b.entry_date,
    b.entry_date - a.exit_date, a.justif_type, a.justif_status
  from stays a
  join stays b on b.vehicle_id = a.vehicle_id and b.parc_id <> a.parc_id and b.deleted_at is null
    and b.entry_kind in ('entree', 'manuel') and b.entry_date >= a.exit_date and b.entry_date - a.exit_date <= p_max_days
  join vehicles v on v.id = a.vehicle_id and v.deleted_at is null
  join parcs pa on pa.id = a.parc_id
  join parcs pb on pb.id = b.parc_id
  where a.deleted_at is null and a.exit_kind = 'sortie'
    and coalesce(a.justif_status, '') <> 'validee'
    and not exists (select 1 from stays c where c.vehicle_id = a.vehicle_id and c.deleted_at is null and c.id not in (a.id, b.id)
                    and c.entry_date > a.exit_date and c.entry_date < b.entry_date)
    and not exists (select 1 from stock_transfer_links l where l.vehicle_id = a.vehicle_id and l.from_parc_id = a.parc_id
                    and l.exit_date = a.exit_date and l.to_parc_id = b.parc_id and l.entry_date = b.entry_date)
  order by b.entry_date desc, v.chassis;
$$;

revoke all on function public.stock_weeks(bigint, date, date), public.stock_transfers(bigint, date, date),
  public.stock_transfer_candidates(int), public.stock_eff_date(date, boolean) from public, anon, authenticated;
grant execute on function public.stock_weeks(bigint, date, date), public.stock_transfers(bigint, date, date),
  public.stock_transfer_candidates(int), public.stock_eff_date(date, boolean) to service_role;
