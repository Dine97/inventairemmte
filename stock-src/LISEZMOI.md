# Sources du module « Suivi des stocks »

| Fichier | Contenu |
|---|---|
| `stock_boot.jsx` | Partie légère chargée avec la page : appels à l'API, menu, écran de choix d'application, chargement à la demande du reste, journal des erreurs |
| `parser.js` | Lecteur universel des fichiers Excel des parcs (en-têtes, synonymes, dates, doublons…) |
| `stock_core.jsx` | Calcul des situations (dépôt), exports Excel/PDF, composants communs |
| `stock_views.jsx` | Tableau de bord, parc, recherche, fiche véhicule, justification, mouvements, imports |
| `stock_import_admin.jsx` | Import d'un fichier, administration (dont « Erreurs récentes ») |
| `stock_v2.jsx` | Rapport hebdomadaire, graphiques, anomalies, contrôles inventaire et MMTE, filtres, sauvegarde, utilisateurs |
| `stock_v4.jsx` | Import groupé du lundi (plusieurs fichiers de parcs en une fois) |
| `stock_v3.jsx` | Inventaire depuis le stock du parc, export du stock à une date, comptes et accès aux applications |

`stock_boot.jsx` est compilé dans `index.html` (entre les marqueurs `STOCK-MODULE-DEBUT` et `STOCK-MODULE-FIN`) ;
les autres fichiers forment `lib/stock.js`, chargé seulement quand on ouvre le suivi des stocks.
Après une modification, depuis la racine du dépôt : `npm ci` (une fois) puis `node build.mjs`.

Côté serveur (projet Supabase `stock-mmte`) :
- `supabase/migrations/` : structure de la base et fonctions de calcul (à appliquer dans l'ordre) ;
- `supabase/functions/stock-api/index.ts` : API sécurisée (vérifie le jeton Firebase de l'utilisateur).
