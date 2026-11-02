/* ======================================================================
   Service worker.

   Due regole, e sono quelle che contano:

   1. Le chiamate a api.github.com NON vengono MAI toccate. Sono i dati
      veri: servirli da una cache significherebbe mostrare roba vecchia
      o, peggio, salvare partendo da uno sha scaduto.

   2. Il guscio dell'app usa "prima la rete, poi la cache". Cosi' un
      aggiornamento arriva subito invece di restare prigioniero della
      cache, e senza rete l'app si apre comunque.
   ====================================================================== */

const VERSIONE = 'quaderno-v2';

const GUSCIO = [
  './',
  './index.html',
  './stile.css',
  './app.js',
  './fonte.js',
  './markdown.js',
  './modifica.js',
  './dialogo.js',
  './manifest.webmanifest',
  './icone/icona-192.png',
  './icone/icona-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSIONE)
      // addAll fallisce tutto se un solo file manca: meglio uno per uno
      .then((c) => Promise.allSettled(GUSCIO.map((u) => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((chiavi) => Promise.all(
        chiavi.filter((k) => k !== VERSIONE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // regola 1: i dati non si mettono mai in cache
  if (url.hostname === 'api.github.com' || url.hostname.endsWith('.githubusercontent.com')) {
    return;
  }
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

  // regola 2: prima la rete, poi la cache
  e.respondWith(
    fetch(e.request)
      .then((risposta) => {
        if (risposta && risposta.ok) {
          const copia = risposta.clone();
          caches.open(VERSIONE).then((c) => c.put(e.request, copia)).catch(() => {});
        }
        return risposta;
      })
      .catch(async () => {
        const dallaCache = await caches.match(e.request);
        if (dallaCache) return dallaCache;
        // navigazione senza rete e senza copia: si apre comunque il guscio
        if (e.request.mode === 'navigate') {
          const guscio = await caches.match('./index.html');
          if (guscio) return guscio;
        }
        return new Response('Non disponibile senza rete.', {
          status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
      })
  );
});
