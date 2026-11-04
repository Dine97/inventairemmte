# Sources du module « Suivi des stocks »

| Fichier | Contenu |
|---|---|
| `parser.js` | Lecteur universel des fichiers Excel des parcs (en-têtes, synonymes, dates, doublons…) |
| `stock_core.jsx` | Appels à l'API, calcul des situations (dépôt), exports Excel/PDF, composants communs |
| `stock_views.jsx` | Tableau de bord, parc, recherche, fiche véhicule, justification, mouvements, imports |
| `stock_import_admin.jsx` | Import d'un fichier, administration, écran de choix d'application |
| `stock_v2.jsx` | Rapport hebdomadaire, graphiques, anomalies, contrôles inventaire et MMTE, filtres, sauvegarde, utilisateurs |

Le code compilé est injecté dans `index.html` entre les marqueurs `STOCK-MODULE-DEBUT` et `STOCK-MODULE-FIN`.
Après une modification : `npm i --no-save esbuild` puis `node stock-src/build.mjs`.

Côté serveur (projet Supabase `stock-mmte`) :
- `supabase/migrations/` : structure de la base et fonctions de calcul (à appliquer dans l'ordre) ;
- `supabase/functions/stock-api/index.ts` : API sécurisée (vérifie le jeton Firebase de l'utilisateur).
