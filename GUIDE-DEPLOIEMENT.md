# Ensemble — guide de déploiement

Ce dossier contient la vraie version d'Ensemble : une appli web installable (PWA), synchronisée en temps réel entre vos deux téléphones, avec un vrai compte pour chacun de vous. Pas de build, pas de serveur à gérer — juste des fichiers statiques + Supabase (base de données + authentification) + GitHub Pages (hébergement, gratuit et illimité).

Compter environ 20-25 minutes, aucune compétence technique particulière requise au-delà de copier-coller.

## 1. Créer le projet Supabase (la base de données)

1. Va sur [supabase.com](https://supabase.com) et crée un compte gratuit (le plan gratuit suffit largement pour un usage à deux).
2. Crée un nouveau projet (« New project »). Choisis un nom (ex. `ensemble`), un mot de passe de base de données (garde-le de côté, tu n'en auras normalement plus besoin après), et une région proche de vous.
3. Attends 1-2 minutes que le projet soit prêt.
4. Dans le menu de gauche, ouvre **SQL Editor** → **New query**.
5. Ouvre le fichier `schema.sql` fourni dans ce dossier, copie tout son contenu, colle-le dans l'éditeur SQL, puis clique **Run**. Ça crée toutes les tables, les règles de sécurité (chacun ne voit que les données de son couple) et les fonctions nécessaires. Tu ne devrais voir aucune erreur.
6. Dans le menu de gauche, va dans **Project Settings** (icône engrenage) → **API Keys**. Note deux valeurs :
   - **Project URL** (ressemble à `https://xxxxxxxxxxxx.supabase.co`)
   - **anon public key** (une longue chaîne de caractères)

   Ces deux valeurs sont faites pour être publiques (elles sont visibles dans le code de n'importe quelle appli Supabase) — la vraie sécurité vient des règles qu'on vient d'installer avec `schema.sql`, qui empêchent quiconque de voir les données d'un autre couple.

   Sur cette même page, il existe aussi une clé **`service_role` / secret** (commence par `sb_secret_...`). Contrairement à la précédente, celle-ci donne un accès total à la base, sans restriction — ne jamais la mettre dans le code de l'appli ni dans un dépôt public. Elle ne sert que pour deux choses avancées : la sauvegarde automatique (étape 6) et le dépannage ponctuel d'un compte via l'API admin (voir Notes techniques).

7. Toujours dans **Authentication**, deux réglages à faire :
   - **URL Configuration** : renseigne le **Site URL** et ajoute la même adresse dans **Redirect URLs**. Tu n'auras l'URL définitive qu'après l'étape 3 (déploiement GitHub Pages) — reviens ici à ce moment-là pour la renseigner. Sans ça, la connexion avec Google ne redirige pas au bon endroit (la connexion par mot de passe, elle, fonctionne même sans cette étape).
   - **Providers** → **Email** : désactive **Confirm email**. Comme vous êtes un nombre restreint et connu de personnes à utiliser l'appli, ça évite d'avoir à confirmer un email à la création du compte — la connexion par mot de passe devient immédiate.

## 2. Configurer les clés dans le code

1. Ouvre le fichier `js/config.js` dans ce dossier.
2. Remplace les deux valeurs par celles notées à l'étape 1.6 (la `anon public key`, pas la `service_role`) :

```js
export const SUPABASE_URL = "https://xxxxxxxxxxxx.supabase.co";
export const SUPABASE_ANON_KEY = "eyJ...ta-vraie-clé...";
```

3. Enregistre le fichier.

## 3. Déployer sur GitHub Pages

1. Crée un dépôt GitHub (public — GitHub Pages gratuit l'exige pour un compte personnel) et pousse-y tout le contenu de ce dossier.
2. Sur la page du dépôt : **Settings** → **Pages** (menu de gauche, section "Code and automation").
3. Sous **Build and deployment**, source = **Deploy from a branch**, branche **main**, dossier **/ (root)**. Clique **Save**.
4. Après une minute ou deux, l'URL de ton site apparaît en haut de cette même page, du type `https://ton-pseudo.github.io/nom-du-repo/`.
5. Retourne dans Supabase → **Authentication** → **URL Configuration** (étape 1.7) pour y renseigner cette URL comme **Site URL**, et l'ajouter (avec `**` à la fin, ex. `https://ton-pseudo.github.io/nom-du-repo/**`) dans **Redirect URLs**.

> **Pourquoi pas Vercel ?** Ça fonctionnerait tout aussi bien (le projet a d'ailleurs commencé sur Vercel) — GitHub Pages a simplement été choisi pour rester sur un seul service (le code est de toute façon sur GitHub) et éviter un compte supplémentaire. Seule différence technique : GitHub Pages sert le site dans un sous-dossier (`/nom-du-repo/`) plutôt qu'à la racine du domaine, ce qui demande des chemins de fichiers relatifs plutôt qu'absolus — c'est déjà pris en compte dans les fichiers fournis (`index.html`, `manifest.json`, `sw.js`, `js/auth.js`).

## 4. Activer la connexion

L'appli propose deux façons de se connecter, aucune des deux ne dépend de l'envoi d'email par Supabase (qui est limité à quelques emails/heure sur le plan gratuit) :

- **Email + mot de passe** : fonctionne directement, rien à configurer côté Supabase au-delà de l'étape 1.7 (désactiver "Confirm email"). Chacun choisit son mot de passe à la création de compte, et peut le changer ensuite depuis Réglages.

- **Connexion avec Google** *(optionnel, mais plus confortable au quotidien)* :
  1. Va sur [console.cloud.google.com](https://console.cloud.google.com/), crée un projet.
  2. Menu **Google Auth Platform** → onglet **Branding** : renseigne un nom d'appli et un email de support.
  3. Onglet **Audience** : type d'utilisateur **External**, garde le statut **Testing**, et ajoute dans **Test users** les adresses Gmail des personnes qui utiliseront l'appli (en mode Testing, seules ces adresses-là peuvent se connecter avec Google — pas besoin de publier l'app).
  4. Onglet **Clients** → **Create Client** → type **Web application**. Renseigne :
     - **Authorized JavaScript origins** : ton URL GitHub Pages, sans le sous-dossier (ex. `https://ton-pseudo.github.io`)
     - **Authorized redirect URIs** : `https://xxxxxxxxxxxx.supabase.co/auth/v1/callback` (avec ton Project URL Supabase de l'étape 1.6)
  5. Récupère le **Client ID** et le **Client Secret** générés.
  6. Dans Supabase : **Authentication** → **Providers** → **Google** → active-le, colle le Client ID et le Client Secret → **Save**.

  Note : lors de la connexion, Google affiche d'abord un écran mentionnant l'adresse `xxxxxxxxxxxx.supabase.co` avant l'écran de consentement avec le nom de l'appli — c'est normal, Supabase agit comme intermédiaire technique de l'authentification, ce même écran apparaît pour n'importe quelle appli construite sur Supabase.

## 5. Premier lancement

1. Ouvre l'URL GitHub Pages sur ton téléphone ou ton ordinateur.
2. Clique **Créer un compte**, entre ton email et un mot de passe (ou **Continuer avec Google**).
3. Choisis **Créer notre espace**, entre les deux prénoms → un code d'invitation à 8 caractères est généré (visible ensuite dans Réglages).
4. Envoie ce code à ton/ta partenaire. De son côté : même URL, son propre compte (email/mot de passe ou Google), puis **Rejoindre mon/ma partenaire** avec le code.
5. Vous êtes maintenant tous les deux connectés au même espace, synchronisé en temps réel.

## 6. Installer l'icône sur l'écran d'accueil

Contrairement à l'ancienne version (lien de connexion par email), la connexion par mot de passe ou par Google se fait entièrement dans l'appli elle-même, sans jamais passer par une autre appli (Mail, etc.) — l'icône plein écran ajoutée à l'écran d'accueil fonctionne donc désormais normalement, y compris sur iPhone :

- **iPhone (Safari)** : bouton Partager → « Sur l'écran d'accueil ».
- **Android (Chrome)** : menu ⋮ → « Ajouter à l'écran d'accueil » ou bandeau d'installation automatique.
- **Ordinateur (Chrome/Edge)** : icône d'installation dans la barre d'adresse.

## 7. Automatisations gratuites déjà en place

Deux GitHub Actions tournent automatiquement dans le dépôt (visibles dans l'onglet **Actions** du repo) :

- **Keep Supabase Awake** (`.github/workflows/keep-alive.yml`) : ping le projet Supabase deux fois par semaine pour éviter la mise en pause automatique après 7 jours d'inactivité (limite du plan gratuit).
- **Backup Supabase Data** : sauvegarde toutes les données (dépenses, catégories, etc.) chaque semaine dans un second dépôt GitHub **privé**, séparé de celui du code (le plan gratuit Supabase n'inclut pas de sauvegarde automatique). Nécessite un secret GitHub `SUPABASE_SECRET_KEY` (la clé `service_role` de l'étape 1.6) configuré dans **Settings → Secrets and variables → Actions** du dépôt de sauvegarde.

## Notes techniques (au cas où)

- Pas de `npm install` ni d'étape de build : le fichier `js/supabase-client.js` charge la librairie Supabase directement depuis un CDN (`esm.sh`) au moment où le navigateur de l'utilisateur charge la page. C'est un choix délibéré pour garder le déploiement le plus simple possible (zéro configuration côté hébergement).
- Pour mettre à jour l'appli plus tard : modifie les fichiers, `git push` — GitHub Pages redéploie automatiquement en 1-2 minutes. Le service worker (`sw.js`) va toujours chercher la dernière version en ligne en priorité (stratégie "réseau d'abord"), donc les mises à jour sont visibles immédiatement au rechargement, sans manipulation particulière.
- Si tu casses quelque chose dans `schema.sql` en le rejouant : les `create table` échoueront si les tables existent déjà. Pour repartir de zéro, supprime les tables concernées depuis l'éditeur SQL avant de relancer le script (attention, ça efface les données).
- **Dépannage compte** : si un compte existe déjà côté Supabase sans mot de passe utilisable (par exemple après une migration depuis une ancienne version de l'appli), on peut lui en fixer un directement via l'API admin de Supabase, sans email, avec la clé `service_role` :

  ```powershell
  curl.exe -X PUT "https://xxxxxxxxxxxx.supabase.co/auth/v1/admin/users/<USER_UID>" -H "apikey: <SERVICE_ROLE_KEY>" -H "Authorization: Bearer <SERVICE_ROLE_KEY>" -H "Content-Type: application/json" -d '{\"password\":\"<NOUVEAU_MOT_DE_PASSE>\"}'
  ```

  Le `<USER_UID>` se trouve dans Supabase → **Authentication** → **Users**, en cliquant sur la ligne de la personne concernée.
