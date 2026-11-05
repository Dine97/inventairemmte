-- 009 : recherche par liste de châssis et vue par navire

-- Situation d'une liste de châssis (exacts, corrigés par une correction mémorisée, ou retrouvés par leur fin)
create or replace function public.stock_lookup(p_chassis text[])
returns jsonb language sql stable security definer set search_path = public, extensions as $$
  with inp as (
    select distinct x from unnest(p_chassis[1:5000]) x where length(x) >= 4),
  m as (
    select i.x as saisi,
      coalesce(
        (select a.chassis from chassis_aliases a where a.alias = i.x),
        (select v.chassis from vehicles v where v.chassis = i.x and v.deleted_at is null),
        case when length(i.x) between 5 and 12 then
          (select min(v.chassis) from vehicles v where v.deleted_at is null and v.chassis like '%' || i.x having count(*) = 1) end,
        i.x) as c
    from inp i)
  select coalesce(jsonb_agg(jsonb_build_object(
    'saisi', m.saisi, 'chassis', coalesce(v.chassis, m.c), 'trouve', v.id is not null,
    'retrouve', case when v.id is null then null when (select count(*) from chassis_aliases a where a.alias = m.saisi) > 0 then 'correction'
                     when m.c <> m.saisi then 'fin' end,
    'vehicle_id', v.id, 'marque', v.marque, 'modele', v.modele, 'annee', v.annee, 'navire', v.navire, 'manifeste', v.manifeste,
    'bl', v.bl, 'date_arrivee', v.date_arrivee, 'date_transfert', v.date_transfert, 'mmte_depot_date', v.mmte_depot_date,
    'importateur', v.importateur,
    'parc', cur.parc, 'entry_date', cur.entry_date,
    'sortie', lx.j,
    'suggestion', case when v.id is null and length(m.saisi) >= 8 then
      (select v2.chassis from vehicles v2 where v2.deleted_at is null and v2.chassis % m.saisi
       order by similarity(v2.chassis, m.saisi) desc limit 1) end
  ) order by m.saisi), '[]'::jsonb)
  from m
  left join vehicles v on v.chassis = m.c and v.deleted_at is null
  left join lateral (select p.name as parc, s.entry_date from stays s join parcs p on p.id = s.parc_id
                     where s.vehicle_id = v.id and s.exit_date is null and s.deleted_at is null order by s.entry_date desc limit 1) cur on true
  left join lateral (select jsonb_build_object('parc', p.name, 'date', s.exit_date, 'kind', s.exit_kind, 'to_parc', tp.name,
                            'justif_numero', s.justif_numero, 'justif_status', s.justif_status) as j
                     from stays s join parcs p on p.id = s.parc_id left join parcs tp on tp.id = s.to_parc_id
                     where s.vehicle_id = v.id and s.exit_date is not null and s.deleted_at is null
                     order by s.exit_date desc limit 1) lx on true;
$$;

-- Véhicules encore en parc, regroupés par navire
create or replace function public.stock_ships(p_ref date, p_duree int, p_seuil int, p_mmte boolean default false)
returns jsonb language sql stable security definer set search_path = public as $$
  with o as (
    select coalesce(nullif(v.navire, ''), '(navire non indiqué)') as navire, v.manifeste, v.date_arrivee, s.parc_id, p.name as parc,
      case when p_mmte and v.mmte_depot_date is not null then v.mmte_depot_date
           when v.date_arrivee is not null then v.date_arrivee + p_duree end as dep
    from stays s join vehicles v on v.id = s.vehicle_id and v.deleted_at is null join parcs p on p.id = s.parc_id
    where s.exit_date is null and s.deleted_at is null)
  select coalesce(jsonb_agg(x order by x.presents desc, x.navire), '[]'::jsonb) from (
    select navire, count(*) as presents, count(distinct parc_id) as nb_parcs,
      (array_agg(distinct parc order by parc))[1:12] as parcs,
      min(date_arrivee) as arrivee_min, max(date_arrivee) as arrivee_max, min(dep) as depot_min,
      count(*) filter (where dep <= p_ref) as depot,
      count(*) filter (where dep > p_ref and dep <= p_ref + p_seuil) as bientot,
      count(*) filter (where dep is null) as sans_date,
      count(distinct manifeste) as nb_manifestes,
      (array_agg(distinct manifeste) filter (where manifeste is not null))[1:15] as manifestes
    from o group by navire) x;
$$;

revoke all on function public.stock_lookup(text[]), public.stock_ships(date, int, int, boolean) from public, anon, authenticated;
grant execute on function public.stock_lookup(text[]), public.stock_ships(date, int, int, boolean) to service_role;
