// ============================================================================
// Service worker minimal : met en cache la coquille de l'appli (HTML/CSS/JS/icônes)
// pour un chargement instantané et un fonctionnement basique hors-ligne.
// Ne touche JAMAIS aux requêtes vers Supabase ou esm.sh (autre origine) : ces
// requêtes passent toujours directement par le réseau, pour ne jamais servir
// de données ou une session périmées.
// ============================================================================
const CACHE_NAME = "ensemble-shell-v6";
const APP_SHELL = [
  "./",
  "index.html",
  "style.css",
  "manifest.json",
  "icon-192.png",
  "icon-512.png",
  "js/app.js",
  "js/store.js",
  "js/calc.js",
  "js/auth.js",
  "js/config.js",
  "js/supabase-client.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Seulement les requêtes GET de même origine (l'appli elle-même) : le reste
  // (Supabase, esm.sh, etc.) part directement au réseau, sans passer par ici.
  if (req.method !== "GET" || url.origin !== self.location.origin) return;

  // Réseau d'abord : on va toujours chercher la dernière version en ligne, et on
  // ne retombe sur le cache que si le réseau échoue (hors-ligne). Ça évite de
  // servir une version périmée du code après un déploiement (ce qui arrivait
  // avec l'ancienne stratégie stale-while-revalidate) — le cache ne sert plus
  // que de filet de secours hors-ligne, plus de "readonly" à surveiller/bumper.
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req))
  );
});
