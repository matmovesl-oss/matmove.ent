const CACHE_NAME = 'matmove-shell-v4';
const APP_SHELL = ['/', '/index.html', '/offline.html', '/logo.jpg', '/image-unavailable.svg'];

async function precacheBuildAssets(cache) {
  try {
    const manifestResponse = await fetch('/manifest.json', { cache: 'reload' });
    if (!manifestResponse.ok) return;
    await cache.put('/manifest.json', manifestResponse.clone());
    const manifest = await manifestResponse.json();
    const assets = new Set();
    for (const entry of Object.values(manifest)) {
      if (!entry || typeof entry !== 'object') continue;
      for (const file of [entry.file, ...(entry.css || []), ...(entry.assets || [])]) {
        if (typeof file === 'string' &&
            /^assets\/(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]+\.(?:js|mjs|css|woff2?|ttf|otf|svg|png|jpe?g|webp|avif|gif)$/i.test(file)) {
          assets.add('/' + file);
        }
      }
    }
    await Promise.all([...assets].map(async path => {
      try {
        const response = await fetch(path, { cache: 'reload' });
        if (response.ok && response.type === 'basic') await cache.put(path, response.clone());
      } catch {
        // A single optional static asset must not block offline-shell installation.
      }
    }));
  } catch {
    // Live functionality remains available online if the build manifest cannot be cached.
  }
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_SHELL);
    await precacheBuildAssets(cache);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith('matmove-shell-') && name !== CACHE_NAME).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || /auth|wallet|payment|transaction|profile|booking/i.test(url.pathname)) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok && (response.headers.get('content-type') || '').includes('text/html')) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put('/index.html', response.clone());
        }
        return response;
      } catch {
        return (await caches.match('/index.html')) || (await caches.match('/offline.html'));
      }
    })());
    return;
  }

  if (/^\/assets\/[A-Za-z0-9._/-]+\.(?:js|mjs|css|woff2?|ttf|otf|svg|png|jpe?g|webp|avif|gif)$/i.test(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) await cache.put(request, response.clone());
      return response;
    })());
  }
});
