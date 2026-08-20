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

7. Toujours dans **Project Settings**, va dans **Authentication** → **URL Configuration**. Tu y reviendras à l'étape 3 une fois que tu auras l'adresse de ton site Vercel — pour l'instant tu peux passer à l'étape suivante.
8. Dans **Authentication** → **Email Templates**, ouvre le modèle **Magic Link** et remplace son contenu par quelque chose comme ceci (l'important est la variable `{{ .Token }}`, qui insère le code à 6 chiffres) :

```html
<h2>Connexion à Ensemble</h2>
<p>Ton code de connexion : <strong style="font-size:22px;letter-spacing:2px;">{{ .Token }}</strong></p>
<p>Ce code est valable 1 heure.</p>
```

   C'est ce code que vous entrerez directement dans l'appli — plus fiable qu'un lien cliquable une fois l'appli installée sur l'écran d'accueil (voir l'encadré en bas de ce guide).

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
5. Retourne dans Supabase → **Authentication** → **URL Configuration**, et renseigne :
   - **Site URL** : ton URL Vercel (ex. `https://ensemble-xxxx.vercel.app`)
   - **Redirect URLs** : ajoute la même URL

   C'est cette étape qui permet au lien de connexion reçu par email de vous ramener correctement dans l'appli.

## 4. Premier lancement

1. Ouvre l'URL Vercel sur ton téléphone ou ton ordinateur.
2. Entre ton email → tu reçois un email avec un code à 6 chiffres.
3. Reviens dans l'appli (sans cliquer sur rien dans l'email) et tape le code → tu es connecté·e.
4. Choisis **Créer notre espace**, entre les deux prénoms → un code d'invitation à 8 caractères est généré (visible ensuite dans Réglages).
5. Envoie ce code à ton/ta partenaire. De son côté : même URL, son propre email, puis **Rejoindre mon/ma partenaire** avec le code.
6. Vous êtes maintenant tous les deux connectés au même espace, synchronisé en temps réel.

> **Pourquoi un code et pas un lien ?** Sur téléphone, cliquer un lien reçu dans l'appli Mail l'ouvre dans Safari/Chrome — un espace de stockage complètement séparé de l'appli une fois qu'elle est installée sur l'écran d'accueil. La connexion réussirait dans Safari, mais l'appli installée, elle, ne le saurait jamais et redemanderait de se connecter. Le code tapé directement dans l'appli n'a pas ce problème.

## 5. Installer l'appli comme une vraie appli (PWA)

- **iPhone (Safari)** : ouvre l'URL, bouton Partager → « Sur l'écran d'accueil ».
- **Android (Chrome)** : ouvre l'URL, menu ⋮ → « Installer l'application » (ou une bannière apparaît automatiquement).
- **Ordinateur (Chrome/Edge)** : une icône d'installation apparaît dans la barre d'adresse.

Une fois installée, l'appli s'ouvre en plein écran comme une appli native, avec son icône, et reste utilisable brièvement hors-ligne pour l'affichage (la synchronisation reprend dès que la connexion revient).

## Notes techniques (au cas où)

- Pas de `npm install` ni d'étape de build : le fichier `js/supabase-client.js` charge la librairie Supabase directement depuis un CDN (`esm.sh`) au moment où le navigateur de l'utilisateur charge la page. C'est un choix délibéré pour garder le déploiement le plus simple possible (zéro configuration côté Vercel).
- Pour mettre à jour l'appli plus tard : modifie les fichiers, repousse sur GitHub (ou relance `vercel --prod`) — Vercel redéploie automatiquement.
- Si tu casses quelque chose dans `schema.sql` en le rejouant : les `create table` échoueront si les tables existent déjà. Pour repartir de zéro, supprime les tables concernées depuis l'éditeur SQL avant de relancer le script (attention, ça efface les données).
