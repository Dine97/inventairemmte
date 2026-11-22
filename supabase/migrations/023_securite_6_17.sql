-- 6.17.0 — Durcissement (audit de sécurité du 22/11/2026)

-- Pièces justificatives : ajout et retrait en une seule écriture (deux envois simultanés ne s'écrasent plus)
create or replace function public.stock_stay_add_file(p_ids bigint[], p_file jsonb)
returns void language sql security definer set search_path = public as $$
  update stays set justif_files = coalesce(justif_files, '[]'::jsonb) || jsonb_build_array(p_file), updated_at = now()
  where id = any(p_ids);
$$;
create or replace function public.stock_stay_remove_file(p_id bigint, p_path text)
returns void language sql security definer set search_path = public as $$
  update stays set justif_files = coalesce((select jsonb_agg(e) from jsonb_array_elements(justif_files) e where e->>'path' is distinct from p_path), '[]'::jsonb),
    updated_at = now()
  where id = p_id;
$$;
revoke all on function public.stock_stay_add_file(bigint[], jsonb), public.stock_stay_remove_file(bigint, text) from public, anon, authenticated;
grant execute on function public.stock_stay_add_file(bigint[], jsonb), public.stock_stay_remove_file(bigint, text) to service_role;

-- Chemin de recherche fixé (alerte Supabase « search_path mutable »)
alter function public.stock_eff_date(date, boolean) set search_path = public;
alter function public.audit_caution_wording() set search_path = public;
revoke all on function public.audit_caution_wording() from public, anon, authenticated;

-- Espaces de stockage : seulement PDF, images, Word et Excel
update storage.buckets set allowed_mime_types = array[
  'application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
where id in ('justificatifs', 'parcs');
