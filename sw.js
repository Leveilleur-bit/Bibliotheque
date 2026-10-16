/* ============================================================
   Service Worker — Ma Bibliothèque
   Rend l'appli installable et utilisable hors ligne.
   Fichiers de l'appli : cache d'abord, rafraîchis en arrière-plan.
   Incrémente CACHE_VERSION à chaque changement des fichiers.
   ============================================================ */
const CACHE_VERSION = "v22";
const CACHE_NAME = "ma-bibliotheque-" + CACHE_VERSION;
const FICHIERS = [
  "./", "./index.html", "./manifest.json", "./css/style.css",
  "./js/app.js", "./js/sync.js", "./icon-192.png", "./icon-512.png", "./img/accueil.jpg", "./img/audible.jpg", "./img/autres.jpg", "./img/envies.jpg", "./img/idees.jpg", "./img/reglages.jpg", "./img/fantasy.jpg", "./img/sf.jpg"
];

self.addEventListener("install", event => {
  // cache: "reload" : on contourne le cache HTTP du navigateur pour ne jamais
  // mélanger des fichiers de deux versions différentes
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(FICHIERS.map(f => new Request(f, { cache: "reload" })))));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(noms => Promise.all(
    noms.filter(n => n.startsWith("ma-bibliotheque-") && n !== CACHE_NAME).map(n => caches.delete(n))
  )));
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.hostname === "api.github.com") return;            // synchronisation : jamais en cache
  if (url.origin === self.location.origin && url.pathname.endsWith("/version.json")) return;
  if (url.origin === self.location.origin) {
    event.respondWith(caches.match(req).then(enCache => {
      const reseau = fetch(req).then(rep => {
        if (rep && rep.ok) { const copie = rep.clone(); caches.open(CACHE_NAME).then(c => c.put(req, copie)); }
        return rep;
      }).catch(() => enCache);
      return enCache || reseau;
    }));
  } else {
    event.respondWith(fetch(req).then(rep => {
      if (rep && (rep.ok || rep.type === "opaque")) { const copie = rep.clone(); caches.open(CACHE_NAME).then(c => c.put(req, copie)); }
      return rep;
    }).catch(() => caches.match(req)));
  }
});
