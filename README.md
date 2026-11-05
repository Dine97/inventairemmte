# Inventaire MMTE — Bénin Control

Application d'inventaire physique des parcs, avec base de données partagée
en temps réel (Firestore), authentification (Firebase Auth), validation des
comptes agents, traçabilité complète, et configuration à distance.

Contenu du dossier :
```
index.html
manifest.json
service-worker.js
firestore.rules
icons/icon-192.png
icons/icon-512.png
```

---

## ⚠️ Mise en route Firestore (obligatoire)

### 1. Activer Firestore
Console Firebase → **Firestore Database** → **Créer une base de données**
→ choisir une région (ex. `eur3`) → **Mode production**.

### 2. Publier les règles de sécurité
Console Firebase → **Firestore Database → Règles**. Remplacer le contenu
par celui du fichier `firestore.rules` fourni, puis **Publier**.

### 3. Authentication
1. **Authentication → Sign-in method** : activer **E-mail/Mot de passe**
   et **Anonyme**.
2. **Authentication → Settings → Authorized domains** : ajouter l'adresse
   où l'application est hébergée (ex. `inventairemmte.benincontrol.com`).

---

## Import de la liste MMTE — format CSV enrichi

Au démarrage d'un nouvel inventaire, l'application reconnaît automatiquement
un export CSV/Excel MMTE et utilise ces libellés français :

| Colonne du fichier | Libellé affiché |
|---|---|
| chassis | Châssis |
| description | Véhicule (nom affiché sous le châssis) |
| atp | Manifeste |
| registred_at | Date d'enregistrement du manifeste (JJ/MM/AAAA) |
| ship_name | Navire |
| company_number | Manutentionnaire |
| weight | Poids du véhicule |
| bl | BL |
| entry_date | Date d'entrée (JJ/MM/AAAA) |
| expirated_at | Date d'entrée en dépôt (JJ/MM/AAAA) |
| type | Type (dans « Autres informations ») |

Colonnes ignorées : source, id, vaf, state, importateur, constatable_id,
constat_CEN_id, num_colis2, extension_id, extension_state, jours_restant.

**Jours restants** : la colonne d'origine n'est plus utilisée. Le nombre est
recalculé à chaque consultation à partir de la date d'entrée en dépôt :
rouge « Dépassé de X j » si la date est passée, sinon « X j restants »
(orange à 15 jours ou moins, vert au-delà).

- Un fichier sans ces colonnes (simple liste de châssis) continue de
  fonctionner, sans ces informations enrichies.

---

## Fonctionnement

- **Rejoindre un inventaire en cours** : liste en direct des inventaires
  actifs, aucune liste à recharger.
- **Démarrer un nouvel inventaire** : réservé aux agents/admin.
- **Inventaire clôturé pour le même parc/date** : l'application propose de
  le rouvrir tel quel, ou de le remplacer entièrement par la liste qu'on
  vient de charger (cas d'un mauvais fichier associé au départ).
- **Agents ayant participé** : listés automatiquement dans le récapitulatif
  et les exports, à partir des pointages effectués.
- **Fiche de clôture téléchargeable** : depuis le récapitulatif, génère un
  document imprimable avec les deux logos, le parc, la date, les agents
  ayant participé, les chiffres clés, et un espace de signature pour
  Bénin Control, la Douane et le parc inventorié.
- **Suppressions tracées** : jamais définitives, marquées avec auteur et
  horodatage.
- **Configuration à distance** (parcs, code invité, e-mails admin) :
  modifiable depuis le panneau admin de l'application, sans redéploiement.

---

## Condition indispensable : HTTPS

Sans HTTPS, ni l'authentification, ni Firestore, ni l'installation sur
tablette ne fonctionneront.

---

## Mise à jour de l'application

Depuis la version 6.3.0, `index.html`, `lib/stock.js` et `lib/app.css` sont **générés** : on ne les modifie pas à la main.

| Source | Contenu |
|---|---|
| `src/index.template.html` | page HTML (en-tête, bibliothèques) |
| `src/inventaire.js` | application Inventaire MMTE (JavaScript lisible) |
| `stock-src/` | module « Suivi des stocks » (voir `stock-src/LISEZMOI.md`) |
| `tests/` | tests de la lecture des fichiers Excel (données fictives) |

1. Modifier les sources, augmenter `APP_VERSION` dans `src/inventaire.js` et, dans `service-worker.js`,
   `CACHE_NAME` et les deux lignes `lib/app.css?v=…` / `lib/stock.js?v=…`.
2. `npm ci` (une fois), puis `npm test` et `node build.mjs`.
3. Valider et pousser : GitHub Actions relance les tests et vérifie que les fichiers publiés correspondent aux sources.

Les bibliothèques (React 18.3.1, Firebase 10.14.1) sont dans `lib/` avec leur version dans le nom ;
seule la bibliothèque Excel (SheetJS 0.20.1) reste chargée depuis son site officiel, puis gardée sur l'appareil.

---

## Module « Suivi des stocks » (version 6.0.0)

Après la connexion, l'application salue l'utilisateur et lui propose d'ouvrir
**Inventaire MMTE** ou **Suivi des stocks**. Le menu latéral permet ensuite de
passer de l'une à l'autre sans se reconnecter (les invités vont directement à
l'inventaire).

- **Mêmes comptes** : la connexion Firebase d'INVENTAIRE MMTE est réutilisée.
  Agents approuvés et administrateurs y ont accès ; seuls les administrateurs
  annulent un import, valident une justification et modifient ou suppriment
  véhicules, mouvements, parcs et paramètres.
- **Mêmes parcs** : la liste des parcs de l'inventaire est reprise automatiquement.
- **Données** : projet Supabase `stock-mmte` (région Paris). Le navigateur
  n'accède jamais directement à la base : tout passe par la fonction sécurisée
  `stock-api`, qui vérifie le jeton Firebase de l'utilisateur.
- **Aucune configuration supplémentaire** n'est nécessaire dans Firebase.

Fonctions : tableau de bord par parc, import hebdomadaire de tous formats Excel
(détection des colonnes, modèle mémorisé par parc), calcul des entrées / sorties /
transferts par comparaison avec l'import précédent, statut dépôt calculé à
365 jours de la date d'arrivée du navire (paramétrable), stock à une date,
recherche avancée et fiche historique de chaque châssis, justification facultative
des sorties avec pièces jointes, exports Excel et PDF, journal d'audit et corbeille.

### Version 6.1.0 — compléments du suivi des stocks

- **Rapport hebdomadaire** consolidé (tous les parcs) en PDF et Excel, avec les anomalies en cours.
- **Graphiques d'évolution** (stock, entrées, sorties par semaine) : total et par parc.
- **Contrôle inventaire** (dans la vue d'un parc) : stock déclaré par le parc ↔ châssis scannés dans INVENTAIRE MMTE.
- **Centre des anomalies** : présents dans deux parcs, fautes de frappe probables (fusion en un clic, la faute est
  ensuite corrigée automatiquement), réapparitions, sans date, châssis atypiques, écarts avec MMTE.
- **Contrôle avec MMTE** : import d'un export MMTE (ou de la liste MMTE d'un inventaire) ; la date de dépôt MMTE
  peut devenir la référence (Administration › Paramètres).
- **Fichiers en retard acceptés** et **annulation / réactivation de n'importe quel import** : l'historique du parc est
  recalculé à partir des instantanés de chaque fichier, les justificatifs sont conservés.
- **Champs verrouillés** : une correction faite à la main n'est plus écrasée par les imports suivants.
- **Accès par utilisateur** : agent MMTE, consultation seule ou aucun accès.
- **Filtres de recherche enregistrés** (personnels ou partagés), **rappel du lundi** des fichiers non reçus,
  **sauvegarde complète** en Excel (Administration › Sauvegarde).
- **Maintien en éveil** du projet Supabase gratuit par une tâche GitHub (`.github/workflows/supabase-keepalive.yml`).
- Sources versionnées : `stock-src/` (interface), `supabase/` (base et API). Voir `stock-src/LISEZMOI.md`.

### Version 6.2.0

- **Inventaire à partir du stock du parc** : au démarrage d'un inventaire, bouton « Stock du parc » qui charge le dernier
  stock importé dans le suivi des stocks ; option de fusion avec la liste MMTE (étiquette « MMTE + stock du parc »,
  « MMTE seulement », « Stock du parc seulement »).
- **Dates d'entrée** reprises du fichier du parc (date de transfert, sinon date d'arrivée) lorsqu'elles tombent entre
  deux imports ; les sorties restent datées à l'import où le véhicule n'apparaît plus (« constatée »).
- **Export du stock à une date** : tous les parcs ou un parc, tout le stock / disponibles / bientôt en dépôt / dépôt /
  sans date, en Excel ou PDF.
- **Comptes et accès** (Panneau admin › Comptes) : création de compte par l'administrateur, choix par agent de l'accès à
  Inventaire MMTE et au Suivi des stocks (agent, consultation, aucun) ; l'écran de choix n'affiche que les applications
  autorisées.

### Version 6.3.0 — performance et fiabilité

- **Base de données** : un import n'enregistre plus que les lignes qui ont changé (la liste des châssis présents est gardée à part) ; calculs d'import, d'annulation et de reconstruction faits en une seule passe ; nouveaux index ; résumé hebdomadaire précalculé pour les graphiques (`supabase/migrations/006_performance.sql`).
- **Vitesse** : styles générés une fois pour toutes (plus de Tailwind en ligne), bibliothèques hébergées avec l'application et servies depuis l'appareil, module stock chargé à la demande (préchargé dès l'écran de choix), appels à l'API sans requête préalable (le jeton voyage dans le corps), dernier tableau de bord affiché immédiatement puis actualisé.
- **Fiabilité** : les erreurs survenues sur les appareils sont envoyées au serveur et consultables dans *Administration stock → Erreurs récentes* ; sources de l'inventaire lisibles dans `src/`, construction unique (`build.mjs`), tests automatiques et vérification GitHub Actions à chaque envoi.

### Version 6.4.0 — import groupé du lundi

- Nouvel écran *Import groupé du lundi* : on dépose d'un coup tous les fichiers reçus des parcs, avec une seule date de stock.
- Le parc de chaque fichier est reconnu par le nom du fichier (même abrégé, ex. « Stock_ZF »), sinon par la forme de son tableau déjà connue ; sinon on le choisit dans la liste. Une fois importé, la forme du tableau est mémorisée pour les semaines suivantes.
- Pour chaque fichier : véhicules, entrées, sorties, points à vérifier, fichier en retard ou en double ; puis import de tous les fichiers prêts à la suite, avec relance des échecs et liste des parcs sans fichier cette semaine.

### Version 6.5.0 — entrées et sorties saisies

- Nouvel écran *Saisir entrées / sorties* (et bouton « Saisie manuelle » sur chaque parc) : une par une (saisie ou scan du châssis) ou par fichier Excel / liste collée.
- Aperçu avant enregistrement (présent, absent du parc, déjà présent, dans un autre parc → transfert, véhicule inconnu) ; justification facultative des sorties (type, n° et date de déclaration).
- Les saisies sont rejouées avec les imports dans l'ordre des dates (migration `008_mouvements_saisis.sql`) : un fichier en retard ou une annulation ne les perd pas ; une saisie antérieure au dernier import recalcule l'historique du parc.
- Onglet *Saisies enregistrées* : consultation, export Excel, annulation d'une saisie ou d'un lot (un agent annule ses propres saisies, l'administrateur toutes), rétablissement par l'administrateur.

### Version 6.6.0 — revue des anomalies avant import

- Étape *2. Points à vérifier* dans l'import (et dans l'import groupé, fichier par fichier) : chaque point est **corrigé** ou **accepté tel quel** avant que la validation soit possible ; « Tout accepter tel quel » en un clic.
- Châssis atypiques (seulement les nouveaux véhicules dès le 2e import) : correction ligne par ligne, exclusion, et mémorisation de la correction pour les fichiers suivants.
- Véhicules sans date d'arrivée : indiquer la colonne, reprendre la date de transfert, une même date pour tous, ou date par véhicule.
- Nouveau contrôle : dates postérieures à la date du stock (correction, effacement ou acceptation).
- Lignes sans châssis lisible : saisie du châssis pour les ajouter ; doublons et total annoncé : acceptation.
- Les décisions (qui, quoi) sont enregistrées avec l'import et visibles dans l'historique des imports.

