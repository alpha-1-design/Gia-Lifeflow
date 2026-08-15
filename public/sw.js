/* Lifeflow offline service worker.
 *
 * The whole app is local-first (all data lives in IndexedDB), so this worker's
 * only job is to keep the app *shell* — the HTML, JS and CSS that make the UI
 * load — available with no network at all. It never caches cross-origin
 * traffic (fonts, weather, news, AI, downloads), so those requests keep going
 * straight to the network.
 */
const CACHE = "lifeflow-shell-v1";
const SHELL = ["/", "/index.html", "/manifest.webmanifest", "/logo.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  // Only handle same-origin requests; never touch third-party origins.
  if (url.origin !== self.location.origin) return;

  // App navigation: network-first so updates land when online, but fall back
  // to the cached shell so the app still opens offline.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put("/index.html", copy));
          return res;
        })
        .catch(() => caches.match("/index.html").then((c) => c || Response.error())),
    );
    return;
  }

  // Static assets (hashed JS/CSS/images): cache-first, then network + cache.
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      });
    }),
  );
});
