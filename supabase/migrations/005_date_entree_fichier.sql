-- Entrées datées d'après le fichier du parc (date de transfert, sinon date d'arrivée) lorsque cette date tombe
-- entre l'import précédent et l'import courant (ou avant le premier import) ; sinon date de l'import.
-- Les sorties restent datées à l'import où le véhicule n'apparaît plus.
-- (Texte complet appliqué sur le projet : voir la migration « v3_date_entree_fichier ».)
alter table public.stays add column if not exists entry_from_file boolean not null default false;
