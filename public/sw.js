// Darwynn Manifest Scanner — Service Worker
// Caches the app shell so it loads instantly on the dock even with poor signal.

const CACHE = "darwynn-v1";

// These are the routes and assets that make up the app shell.
// Next.js static assets are versioned, so we rely on the browser cache for them
// and only hard-cache the minimal shell here.
const SHELL = ["/", "/manifests", "/login", "/manifest.json", "/icons/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Never intercept Supabase API calls — they must go to the network.
  if (url.hostname.includes("supabase.co")) return;
  // Don't intercept POST/PUT/PATCH — let them fail naturally if offline.
  if (request.method !== "GET") return;

  // For navigation requests: network-first, fall back to cached root.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match("/") )
    );
    return;
  }

  // For everything else: stale-while-revalidate.
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(request);
      const networkFetch = fetch(request).then((resp) => {
        if (resp.ok) cache.put(request, resp.clone());
        return resp;
      }).catch(() => cached);
      return cached ?? networkFetch;
    })
  );
});
