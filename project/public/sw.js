const CACHE_NAME = 'matmove-shell-v5';
const APP_SHELL = ['/', '/index.html', '/offline.html', '/logo.jpg', '/image-unavailable.svg'];
const VERSIONED_VITE_ASSET = /^\/assets\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+-[A-Za-z0-9_-]{8,}\.(?:js|mjs|css|woff2?|ttf|otf|svg|png|jpe?g|webp|avif|gif)$/i;
const BACKSLASH = String.fromCharCode(92);

function isVersionedViteAsset(pathname) {
  if (typeof pathname !== 'string' || pathname.includes(BACKSLASH)) return false;
  if (pathname.split('/').some(segment => segment === '.' || segment === '..')) return false;
  return VERSIONED_VITE_ASSET.test(pathname);
}

async function precacheBuildAssets(cache) {
  try {
    const manifestResponse = await fetch('/manifest.json', { cache: 'reload' });
    if (!manifestResponse.ok || manifestResponse.type !== 'basic') return;

    const manifest = await manifestResponse.json();
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return;

    const assets = new Set();
    for (const entry of Object.values(manifest)) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;

      const files = [
        entry.file,
        ...(Array.isArray(entry.css) ? entry.css : []),
        ...(Array.isArray(entry.assets) ? entry.assets : [])
      ];

      for (const file of files) {
        if (typeof file !== 'string' || !/^assets\//i.test(file)) continue;
        if (file.includes(BACKSLASH) || file.includes('?') || file.includes('#')) continue;
        const path = '/' + file;
        if (isVersionedViteAsset(path)) assets.add(path);
      }
    }

    await Promise.all([...assets].map(async path => {
      try {
        const response = await fetch(path, { cache: 'reload' });
        if (response.ok && response.type === 'basic') {
          await cache.put(path, response.clone());
        }
      } catch {
        // A single optional asset must not block installation of the offline shell.
      }
    }));
  } catch {
    // Keep online use available even if the build manifest cannot be precached.
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

  // Never cache API, authentication, profile, wallet, booking, payment or transaction data.
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

  // Only same-origin, hashed Vite build assets are cached.
  if (!url.search && isVersionedViteAsset(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok && response.type === 'basic') await cache.put(request, response.clone());
      return response;
    })());
  }
});
