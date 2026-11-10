// DaggerPlayer service worker: lets the app (and the bundled rules content) load with no connection.
// Pages: network first, falling back to the cached app shell. Hashed build assets (JS, CSS, content
// chunks, icons) are immutable, so they're served cache-first. API calls (Supabase) are never cached.
const VERSION = "v1";
const SHELL = `dp-shell-${VERSION}`;
const ASSETS = `dp-assets-${VERSION}`;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(["/", "/index.html"])).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== ASSETS).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Supabase and other APIs: always the network

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put("/index.html", copy));
          return res;
        })
        .catch(() => caches.match("/index.html").then((r) => r || caches.match("/"))),
    );
    return;
  }

  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(ASSETS).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
    return;
  }

  // anything else on this origin (sw.js itself excluded by the browser): stale-while-revalidate
  event.respondWith(
    caches.open(SHELL).then((cache) =>
      cache.match(req).then((hit) => {
        const net = fetch(req)
          .then((res) => {
            if (res.ok) cache.put(req, res.clone());
            return res;
          })
          .catch(() => hit);
        return hit || net;
      }),
    ),
  );
});
