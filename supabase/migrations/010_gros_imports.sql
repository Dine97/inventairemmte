-- 6.8.0 — Imports de très gros parcs (12 000 à 15 000 véhicules)
-- Mesure du 09/11/2026 sur un parc de 15 000 véhicules : premier import 40 s, import hebdomadaire 4,7 s.
-- Cause : juste après l'ajout de milliers de véhicules, PostgreSQL croit encore les tables petites et choisit
-- un plan de lecture ligne par ligne. On met ses statistiques à jour avant de calculer entrées et sorties.
-- Après : premier import 6,5 s, import hebdomadaire 3,1 s.
do $mig$
declare def text; old text := '  if v_late then
    perform stock_rebuild_parc(v_parc);';
begin
  def := pg_get_functiondef('public.stock_commit_import(jsonb)'::regprocedure);
  if position('analyze vehicles' in def) > 0 then return; end if;
  if position(old in def) = 0 then raise exception 'stock_commit_import : texte attendu introuvable'; end if;
  def := replace(def, old, '  -- gros fichier : statistiques à jour avant le calcul des entrées et sorties (6.8.0)
  if (select count(*) from t_in) > 2000 then analyze vehicles; analyze import_rows; analyze stays; end if;
' || old);
  execute def;
end $mig$;
