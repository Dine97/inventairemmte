-- 6.14.0 — « Agrément » devient « Caution bancaire » (caution douanière au profit de la DGDDI) : même fonctionnement.
-- Les tables et actions gardent leur nom technique (parc_agrements, agrement_save...) ; seul l'affichage change.
-- Le 10/11/2026, les 43 cautions de la « Liste des cautions des parcs 2026 » ont été chargées dans parc_agrements
-- (created_by = 'Liste des cautions des parcs 2026').
-- Le journal emploie le nouveau nom sans modifier l'API.
create or replace function public.audit_caution_wording() returns trigger language plpgsql as $$
begin
  if new.action = 'agrement' or new.detail like 'Agrément%' then
    new.detail := replace(replace(new.detail, 'Agrément ', 'Caution bancaire '), 'agrément', 'caution bancaire');
    if new.action = 'agrement' then new.action := 'caution_bancaire'; end if;
  end if;
  return new;
end $$;
drop trigger if exists audit_caution_wording on public.audit_log;
create trigger audit_caution_wording before insert on public.audit_log for each row execute function public.audit_caution_wording();
