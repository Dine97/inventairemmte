const CACHE_NAME = "inventaire-mmte-v41";
// Moteur de lecture du texte (gros fichiers) : cache à part, conservé d'une version à l'autre.
const OCR_CACHE = "inventaire-mmte-ocr-v1";
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./lib/jszip.min.js",
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME && k !== OCR_CACHE).map((k) => caches.delete(k)))
      )
  );
  self.clients.claim();
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  if (new URL(event.request.url).pathname.includes("/ocr/")) {
    event.respondWith(
      caches.open(OCR_CACHE).then((cache) =>
        cache.match(event.request).then((hit) =>
          hit ||
          fetch(event.request).then((resp) => {
            if (resp && resp.status === 200) cache.put(event.request, resp.clone());
            return resp;
          })
        )
      )
    );
    return;
  }
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
