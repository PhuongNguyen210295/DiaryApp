// Offline support.
// Online: always load fresh files from the network (so every file comes from the same release),
// and keep a copy. Offline: fall back to the saved copy.
const CACHE = 'diary-v13';
const ASSETS = [
  './', 'index.html', 'styles.css', 'app.js', 'db.js', 'levels.js', 'checkin.js', 'journeymap.js', 'manifest.webmanifest',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
  'fonts/fonts.css',
  'fonts/be-vietnam-pro-400-vietnamese.woff2',
  'fonts/be-vietnam-pro-400-latin-ext.woff2',
  'fonts/be-vietnam-pro-400-latin.woff2',
  'fonts/be-vietnam-pro-600-vietnamese.woff2',
  'fonts/be-vietnam-pro-600-latin-ext.woff2',
  'fonts/be-vietnam-pro-600-latin.woff2',
  'fonts/chakra-petch-500-vietnamese.woff2',
  'fonts/chakra-petch-500-latin-ext.woff2',
  'fonts/chakra-petch-500-latin.woff2',
  'fonts/chakra-petch-700-vietnamese.woff2',
  'fonts/chakra-petch-700-latin-ext.woff2',
  'fonts/chakra-petch-700-latin.woff2',
];

self.addEventListener('install', e => {
  // cache: 'reload' skips the browser's HTTP cache, so old and new files never get mixed.
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(ASSETS.map(url => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await fetch(req, { cache: 'no-cache' });   // revalidate with the server
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch {
      const cached = await cache.match(req, { ignoreSearch: true });
      if (cached) return cached;
      if (req.mode === 'navigate') return cache.match('index.html');
      throw new Error('offline');
    }
  })());
});
