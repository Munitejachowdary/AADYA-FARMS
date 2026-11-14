const CACHE = 'aadya-ledger-v3';
const ASSETS = ['./', 'index.html', 'styles.css?v=3', 'bills.css?v=3', 'app.js?v=3', 'ledger-core.js?v=3', 'manifest.webmanifest', 'favicon.svg', 'assets/aadya-logo.png', 'assets/pdf-lib.min.js', 'assets/fontkit.umd.min.js', 'assets/pdf-fonts.js'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS.map(url => new Request(url, { cache: 'reload' })))).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('aadya-ledger-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  const navigation = event.request.mode === 'navigate';
  const appAsset = ASSETS.some(asset => new URL(asset, self.registration.scope).href === url.href);
  if (!navigation && !appAsset) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const response = await fetch(event.request);
      if (response.ok && !response.redirected) await cache.put(event.request, response.clone());
      return response;
    } catch (error) {
      const cached = await cache.match(event.request);
      if (cached) return cached;
      if (navigation) return await cache.match('./index.html') || Response.error();
      return Response.error();
    }
  })());
});
