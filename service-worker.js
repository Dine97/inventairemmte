const CACHE_NAME = "inventaire-mmte-v56";
// Bibliothèques (noms de fichiers versionnés) : servies depuis l'appareil sans attendre le réseau.
const LIB_CACHE = "inventaire-mmte-lib-v1";
const LIBS = [
  "./lib/react-18.3.1.production.min.js",
  "./lib/react-dom-18.3.1.production.min.js",
  "./lib/firebase-app-compat-10.14.1.js",
  "./lib/firebase-auth-compat-10.14.1.js",
  "./lib/firebase-firestore-compat-10.14.1.js",
  "https://cdn.sheetjs.com/xlsx-0.20.1/package/dist/xlsx.full.min.js",
];
// Moteur de lecture du texte (gros fichiers) : cache à part, conservé d'une version à l'autre.
const OCR_CACHE = "inventaire-mmte-ocr-v1";
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./lib/jszip.min.js",
  "./lib/app.css?v=6.9.0",
  "./lib/stock.js?v=6.9.0",
  "./lib/stock-worker.js?v=6.9.0",
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    Promise.all([
      caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)),
      caches.open(LIB_CACHE).then((cache) => Promise.all(LIBS.map((u) => cache.match(u).then((hit) => hit || cache.add(u).catch(() => {}))))),
    ])
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME && k !== OCR_CACHE && k !== LIB_CACHE).map((k) => caches.delete(k)))
      )
  );
  self.clients.claim();
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  // Bibliothèques versionnées : depuis l'appareil d'abord (démarrage rapide même sur une connexion lente)
  if (LIBS.some((u) => url.href === new URL(u, self.location).href)) {
    event.respondWith(
      caches.open(LIB_CACHE).then((cache) =>
        cache.match(event.request).then((hit) =>
          hit ||
          fetch(event.request).then((resp) => {
            if (resp && (resp.status === 200 || resp.type === "opaque")) cache.put(event.request, resp.clone());
            return resp;
          })
        )
      )
    );
    return;
  }
  // Styles et module stock (versionnés par ?v=) : depuis l'appareil d'abord aussi
  if (url.origin === self.location.origin && /\/lib\/(app\.css|stock\.js)$/.test(url.pathname) && url.search) {
    event.respondWith(
      caches.match(event.request).then((hit) =>
        hit ||
        fetch(event.request).then((resp) => {
          if (resp && resp.status === 200) { const copy = resp.clone(); caches.open(CACHE_NAME).then((c) => c.put(event.request, copy)); }
          return resp;
        })
      )
    );
    return;
  }
  if (url.pathname.includes("/ocr/")) {
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
