-- L'annulation d'un import met à l'écart (sans supprimer) les véhicules qui n'existaient que par lui,
-- pour pouvoir les retrouver si l'import est réactivé.
create or replace function public.stock_cancel_import(p_import bigint, p_reason text, p_by text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare imp imports%rowtype; v_ids bigint[];
begin
  select * into imp from imports where id = p_import;
  if not found then raise exception 'IMPORT_INTROUVABLE'; end if;
  if imp.status <> 'valide' then raise exception 'IMPORT_DEJA_ANNULE'; end if;
  perform pg_advisory_xact_lock(imp.parc_id);
  select array_agg(vehicle_id) into v_ids from import_items where import_id = p_import;
  update imports set status = 'annule', cancel_reason = p_reason, cancelled_at = now(), cancelled_by = p_by where id = p_import;
  perform stock_rebuild_parc(imp.parc_id);
  perform stock_refresh_vehicles(coalesce(v_ids, '{}'));
  update vehicles v set deleted_at = now(), notes = concat_ws(' / ', nullif(v.notes, ''), 'Écarté par l''annulation d''un import')
  where v.id = any(coalesce(v_ids, '{}')) and v.deleted_at is null
    and not exists (select 1 from stays s where s.vehicle_id = v.id and s.deleted_at is null)
    and not exists (select 1 from import_items ii join imports i on i.id = ii.import_id where ii.vehicle_id = v.id and i.status = 'valide');
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.stock_restore_import(p_import bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare imp imports%rowtype; v_ids bigint[];
begin
  select * into imp from imports where id = p_import;
  if not found or imp.status <> 'annule' then raise exception 'IMPORT_NON_ANNULE'; end if;
  perform pg_advisory_xact_lock(imp.parc_id);
  select array_agg(vehicle_id) into v_ids from import_items where import_id = p_import;
  update vehicles set deleted_at = null, notes = nullif(replace(replace(coalesce(notes, ''), ' / Écarté par l''annulation d''un import', ''), 'Écarté par l''annulation d''un import', ''), '')
  where id = any(coalesce(v_ids, '{}')) and deleted_at is not null;
  update imports set status = 'valide', cancel_reason = null, cancelled_at = null, cancelled_by = null where id = p_import;
  perform stock_rebuild_parc(imp.parc_id);
  perform stock_refresh_vehicles(coalesce(v_ids, '{}'));
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.stock_cancel_import(bigint, text, text), public.stock_restore_import(bigint) from public, anon, authenticated;
grant execute on function public.stock_cancel_import(bigint, text, text), public.stock_restore_import(bigint) to service_role;
