-- 6.13.1 — Type « Parc de divers » : parc qui ne vend pas mais ramène des véhicules sur commande.
-- Il envoie ses états de stock comme un parc de vente ; les transferts entre parcs de divers et parcs de vente
-- (dans les deux sens) sont reconnus comme les autres transferts parc à parc.
alter table public.parcs drop constraint if exists parcs_type_check;
alter table public.parcs add constraint parcs_type_check check (type in ('parc', 'divers', 'ptu'));
