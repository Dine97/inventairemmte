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

1. Remplacer les fichiers à l'identique à l'endroit où ils sont hébergés.
2. Augmenter `APP_VERSION` dans le code pour déclencher la bannière de
   mise à jour chez les utilisateurs déjà connectés.
