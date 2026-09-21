/* Service worker Miabe Esport — rend le site installable et lui donne un mode hors ligne minimal.
 *
 * Volontairement prudent : il ne touche JAMAIS à l'API (autre origine) ni aux requêtes qui modifient
 * quelque chose (POST/PATCH/DELETE). Les pages se chargent d'abord depuis le réseau (donc toujours à
 * jour) ; le cache ne sert que de filet quand le réseau est coupé. Les fichiers statiques versionnés de
 * Next (/_next/static, hachés, immuables) et les icônes sont servis depuis le cache.
 * Changer VERSION invalide tous les anciens caches. */
const VERSION = "v1";
const STATIC_CACHE = "miabe-static-" + VERSION;
const PAGES_CACHE = "miabe-pages-" + VERSION;
const OFFLINE_URL = "/offline.html";
const PRECACHE = [OFFLINE_URL, "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== STATIC_CACHE && k !== PAGES_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // API, CDN, polices : on ne s'en mêle pas

  // Navigation : réseau d'abord, puis dernière version en cache, puis page hors ligne.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(PAGES_CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(async () => (await caches.match(req)) || (await caches.match("/")) || (await caches.match(OFFLINE_URL))),
    );
    return;
  }

  // Fichiers statiques hachés de Next et icônes : cache d'abord.
  if (url.pathname.startsWith("/_next/static/") || /^\/(icon|apple-touch-icon)[^/]*\.png$/.test(url.pathname)) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(STATIC_CACHE).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
  }
});
