# Ensemble

Le suivi de dépenses pensé pour les couples — simple, synchronisé en temps réel, et entièrement gratuit.

**[Voir le site](https://remydutto.github.io/ensemble-app/)** · **[Voir la démo](https://remydutto.github.io/ensemble-app/app/demo.html)** (données fictives, sans compte)

## À propos

Chacun ajoute ses dépenses et ses revenus, l'appli calcule automatiquement qui doit quoi à l'autre, selon la répartition choisie :

- 50/50
- au prorata des revenus du mois
- en **prorata cumulé** — notre calcul signature, qui répartit les dépenses selon les revenus cumulés depuis le tout premier mois plutôt que sur le seul mois en cours, pour qu'une prime ou un mois creux en freelance ne fasse pas exploser l'équilibre du couple.

## Fonctionnalités

- Synchronisation en temps réel entre les deux comptes (Supabase Realtime)
- Répartition équitable configurable, avec calcul automatique du solde
- Dépenses récurrentes (loyer, abonnements...) générées automatiquement chaque mois
- Statistiques par catégorie et par mois
- Installable en PWA — icône sur l'écran d'accueil, fonctionne hors-ligne
- Mode sombre automatique, adapté aux préférences de l'appareil
- Authentification par mot de passe ou par Google, sans jamais dépendre de l'envoi d'email

## Stack technique

- Zéro build : HTML/CSS/JS natifs, modules ES, librairie Supabase chargée depuis un CDN (`esm.sh`)
- [Supabase](https://supabase.com) : Postgres + Auth + Realtime, données protégées par Row Level Security (chaque couple ne voit que les siennes)
- Hébergement : GitHub Pages
- Automatisations gratuites via GitHub Actions : maintien du projet Supabase actif, sauvegarde hebdomadaire des données

## Structure du dépôt

```
├── index.html               # page d'accueil publique (statique, sans dépendance à Supabase)
├── schema.sql                # schéma Supabase : tables + règles de sécurité (RLS)
├── GUIDE-DEPLOIEMENT.md      # guide pas-à-pas pour déployer sa propre instance
└── app/                      # l'appli elle-même (PWA)
    ├── index.html
    ├── demo.html              # démo publique avec données fictives, sans authentification
    ├── style.css
    ├── manifest.json
    ├── sw.js                  # service worker (cache + fonctionnement hors-ligne)
    ├── icon-192.png / icon-512.png / icon-512-maskable.png
    └── js/
        ├── app.js             # rendu de l'interface et logique d'écran
        ├── auth.js            # authentification (mot de passe, Google)
        ├── calc.js            # calcul du solde et des répartitions
        ├── store.js           # état de l'appli + accès aux données Supabase
        ├── config.js          # clés Supabase (clé publique, par design)
        └── supabase-client.js
```

## Déployer sa propre instance

Voir **[GUIDE-DEPLOIEMENT.md](GUIDE-DEPLOIEMENT.md)** — environ 20-25 minutes, aucune compétence technique particulière requise au-delà de copier-coller.

## Crédits

Rémy a eu l'idée, Claude a beaucoup codé.
