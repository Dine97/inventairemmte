# Inventaire MMTE — Bénin Control

Application d'inventaire physique des parcs, à installer sur tablette.
Contenu du dossier :

```
index.html
manifest.json
service-worker.js
icons/icon-192.png
icons/icon-512.png
```

Ces 5 fichiers doivent rester ensemble, dans la même arborescence
(le dossier `icons` à côté de `index.html`).

---

## Condition indispensable : HTTPS

Pour que l'installation sur tablette et le fonctionnement hors-ligne
fonctionnent, l'application doit être servie en **HTTPS** (adresse
commençant par `https://`). En HTTP simple, la page s'ouvre mais
Chrome refusera l'installation et le mode hors-ligne.

---

## Option A — Hébergement sur le site interne Bénin Control

1. Transmettre ce dossier `pwa` à l'équipe qui gère le site/intranet.
2. Leur demander de déposer les 5 fichiers dans un répertoire du
   serveur web, par exemple : `https://intranet.benincontrol.bj/inventaire-mmte/`
   (n'importe quel nom de dossier convient, tant que la structure
   interne — `icons/` à côté de `index.html` — est respectée).
3. Vérifier que cette adresse est bien accessible en HTTPS.
4. Communiquer l'adresse finale aux agents pour l'installation sur
   tablette (voir plus bas).

Aucun serveur d'application n'est nécessaire : ce sont uniquement des
fichiers statiques (HTML/JS/CSS), servis tels quels par n'importe
quel serveur web (Apache, Nginx, IIS...).

---

## Option B — Hébergement gratuit sur GitHub Pages

1. Créer un compte sur github.com (gratuit) si nécessaire.
2. Créer un nouveau dépôt (repository), par exemple `inventaire-mmte`,
   en le laissant **Public**.
3. Sur la page du dépôt : **Add file → Upload files**.
4. Glisser-déposer `index.html`, `manifest.json`, `service-worker.js`
   ainsi que le dossier `icons` (avec les deux images dedans), puis
   cliquer sur **Commit changes**.
5. Aller dans **Settings → Pages**.
6. Sous « Build and deployment », choisir **Source : Deploy from a
   branch**, puis **Branch : main** et dossier **/ (root)**. Cliquer
   sur **Save**.
7. Attendre 1 à 2 minutes. L'adresse apparaît en haut de la page
   Pages, de la forme :
   `https://<votre-nom-utilisateur>.github.io/inventaire-mmte/`
8. Ouvrir cette adresse pour vérifier que l'application se charge
   correctement.

---

## Installation sur chaque tablette (une fois l'adresse en ligne)

1. Ouvrir l'adresse dans **Chrome** sur la tablette.
2. Appuyer sur le menu ⋮ (en haut à droite).
3. Choisir **« Installer l'application »** (ou « Ajouter à l'écran
   d'accueil »).
4. L'icône Bénin Control apparaît sur l'écran d'accueil et ouvre
   l'application en plein écran, sans barre de navigateur.
5. Une fois ouverte une première fois avec internet, la saisie reste
   utilisable hors connexion (les listes en cours restent
   sauvegardées dans le navigateur de la tablette).

---

## Mise à jour de l'application

Pour publier une nouvelle version : remplacer les fichiers à
l'identique à l'endroit où ils sont hébergés (même noms, même
structure). Les tablettes récupèrent automatiquement la nouvelle
version au prochain lancement avec connexion internet.

---

Conception & réalisation : **Nourou Dine LOKA** — Bénin Control / MAD-MAE
