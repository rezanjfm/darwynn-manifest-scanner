// Darwynn Scanner — Service Worker
// Caches the app shell for instant load even on poor warehouse Wi-Fi.

const CACHE = "darwynn-v2";

const SHELL = [
  "/",
  "/manifests",
  "/quickscan",
  "/login",
  "/manifest.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Never intercept Supabase — must reach the network.
  if (url.hostname.includes("supabase.co")) return;
  // Let mutations through — they fail naturally offline.
  if (request.method !== "GET") return;

  // Navigation: network-first, fall back to cached shell.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match("/manifests") ?? caches.match("/"))
    );
    return;
  }

  // Everything else: stale-while-revalidate.
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(request);
      const network = fetch(request).then((resp) => {
        if (resp.ok) cache.put(request, resp.clone());
        return resp;
      }).catch(() => cached);
      return cached ?? network;
    })
  );
});
