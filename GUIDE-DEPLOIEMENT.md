# Ensemble — guide de déploiement

Ce dossier contient la vraie version d'Ensemble : une appli web installable (PWA), synchronisée en temps réel entre vos deux téléphones, avec un vrai compte pour chacun de vous. Pas de build, pas de serveur à gérer — juste des fichiers statiques + Supabase (base de données + authentification) + Vercel (hébergement).

Compter environ 15-20 minutes, aucune compétence technique particulière requise au-delà de copier-coller.

## 1. Créer le projet Supabase (la base de données)

1. Va sur [supabase.com](https://supabase.com) et crée un compte gratuit (le plan gratuit suffit largement pour un usage à deux).
2. Crée un nouveau projet (« New project »). Choisis un nom (ex. `ensemble`), un mot de passe de base de données (garde-le de côté, tu n'en auras normalement plus besoin après), et une région proche de vous.
3. Attends 1-2 minutes que le projet soit prêt.
4. Dans le menu de gauche, ouvre **SQL Editor** → **New query**.
5. Ouvre le fichier `schema.sql` fourni dans ce dossier, copie tout son contenu, colle-le dans l'éditeur SQL, puis clique **Run**. Ça crée toutes les tables, les règles de sécurité (chacun ne voit que les données de son couple) et les fonctions nécessaires. Tu ne devrais voir aucune erreur.
6. Dans le menu de gauche, va dans **Project Settings** (icône engrenage) → **API**. Note deux valeurs :
   - **Project URL** (ressemble à `https://xxxxxxxxxxxx.supabase.co`)
   - **anon public key** (une longue chaîne de caractères)

   Ces deux valeurs sont faites pour être publiques (elles sont visibles dans le code de n'importe quelle appli Supabase) — la vraie sécurité vient des règles qu'on vient d'installer avec `schema.sql`, qui empêchent quiconque de voir les données d'un autre couple.

7. Toujours dans **Project Settings**, va dans **Authentication** → **URL Configuration**, et renseigne (tu y reviendras à l'étape 3 une fois que tu auras l'adresse de ton site Vercel) :
   - **Site URL** : ton URL Vercel (ex. `https://ensemble-xxxx.vercel.app`)
   - **Redirect URLs** : ajoute la même URL

   C'est cette étape qui permet au lien de connexion reçu par email de vous ramener correctement dans l'appli.

> **Optionnel — pour plus tard.** Par défaut, Supabase envoie les emails de connexion via son propre service, avec un lien cliquable classique. Ça fonctionne très bien tant que vous ouvrez ce lien dans Safari/Chrome directement (voir l'encadré à l'étape 4). Si un jour tu veux une expérience "icône plein écran sur l'écran d'accueil" plus poussée (avec connexion par code à taper plutôt qu'un lien), il faudra configurer un service d'email personnalisé (SMTP) — demande-moi à ce moment-là, c'est un chantier à part qu'on peut faire plus tard sans bloquer le reste.

## 2. Configurer les clés dans le code

1. Ouvre le fichier `js/config.js` dans ce dossier.
2. Remplace les deux valeurs par celles notées à l'étape 1.6 :

```js
export const SUPABASE_URL = "https://xxxxxxxxxxxx.supabase.co";
export const SUPABASE_ANON_KEY = "eyJ...ta-vraie-clé...";
```

3. Enregistre le fichier.

## 3. Déployer sur Vercel

1. Va sur [vercel.com](https://vercel.com) et crée un compte gratuit (tu peux te connecter avec GitHub si tu en as un, ou par email).
2. Le plus simple : mets ce dossier entier dans un dépôt GitHub (crée un nouveau repo, pousse les fichiers), puis dans Vercel clique **Add New → Project** et importe ce repo.
   - Alternative sans GitHub : installe l'outil en ligne de commande Vercel (`npm i -g vercel`) et lance `vercel` puis `vercel --prod` depuis ce dossier.
3. Dans les réglages du projet Vercel : **aucune configuration de build n'est nécessaire**. C'est un site 100% statique — laisse « Build Command » et « Output Directory » vides/par défaut (Vercel détecte un site statique automatiquement).
4. Clique **Deploy**. Après une minute, tu obtiens une URL du type `https://ensemble-xxxx.vercel.app`.
5. Si ce n'est pas déjà fait, retourne dans Supabase → **Authentication** → **URL Configuration** (étape 1.7) pour y mettre cette URL.

## 4. Premier lancement

1. Ouvre l'URL Vercel **dans Safari ou Chrome directement** (pas via une icône ajoutée à l'écran d'accueil — voir l'encadré ci-dessous) sur ton téléphone ou ton ordinateur.
2. Entre ton email → tu reçois un lien de connexion (aucun mot de passe à retenir).
3. Clique le lien reçu par email, sur le même appareil → tu es connecté·e.
4. Choisis **Créer notre espace**, entre les deux prénoms → un code d'invitation à 8 caractères est généré (visible ensuite dans Réglages).
5. Envoie ce code à ton/ta partenaire. De son côté : même URL, son propre email, puis **Rejoindre mon/ma partenaire** avec le code.
6. Vous êtes maintenant tous les deux connectés au même espace, synchronisé en temps réel.

> **Pourquoi éviter l'icône sur l'écran d'accueil pour se connecter ?** Sur iPhone, une icône ajoutée à l'écran d'accueil a un espace de stockage complètement séparé de Safari. Cliquer le lien reçu dans l'email ouvre toujours Safari (jamais l'icône) — la connexion réussit dans Safari, mais l'icône, elle, ne le saura jamais et redemandera de se connecter. Tant que vous utilisez le site directement dans Safari/Chrome (par exemple via un signet), ce problème n'existe pas.

## 5. Un signet plutôt qu'une icône plein écran (pour l'instant)

Pour retrouver l'appli facilement sans retomber sur l'écran de connexion :

- **iPhone (Safari)** : bouton Partager → « Ajouter aux favoris » (pas « Sur l'écran d'accueil »).
- **Android (Chrome)** : menu ⋮ → « Ajouter à l'écran d'accueil » fonctionne en général bien mieux qu'sur iPhone (Chrome partage son stockage entre l'icône et le navigateur), mais en cas de souci, un signet classique marche aussi.
- **Ordinateur** : bouton Partager"/étoile → favoris, comme n'importe quel site.

L'appli reste installable en PWA plein écran (`manifest.json` et `sw.js` sont déjà en place) si tu veux tenter l'expérience icône malgré tout — simplement, la reconnexion depuis l'icône butera sur le même problème tant qu'on n'aura pas mis en place la connexion par code (voir l'encadré optionnel à l'étape 1.8).

## Notes techniques (au cas où)

- Pas de `npm install` ni d'étape de build : le fichier `js/supabase-client.js` charge la librairie Supabase directement depuis un CDN (`esm.sh`) au moment où le navigateur de l'utilisateur charge la page. C'est un choix délibéré pour garder le déploiement le plus simple possible (zéro configuration côté Vercel).
- Pour mettre à jour l'appli plus tard : modifie les fichiers, repousse sur GitHub (ou relance `vercel --prod`) — Vercel redéploie automatiquement.
- Si tu casses quelque chose dans `schema.sql` en le rejouant : les `create table` échoueront si les tables existent déjà. Pour repartir de zéro, supprime les tables concernées depuis l'éditeur SQL avant de relancer le script (attention, ça efface les données).
