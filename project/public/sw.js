const CACHE_NAME = 'matmove-shell-v5';
const APP_SHELL = ['/', '/index.html', '/offline.html', '/manifest.webmanifest', '/logo.jpg', '/image-unavailable.svg', '/wallet-icon.png', '/matmove-car.svg', '/matmove-bike.svg', '/matmove-keke.svg', '/matmove-van.svg', '/car.jpg', '/bike.jpg', '/keke.jpg', '/van.jpg'];

async function cacheInitialAppAssets(cache) {
  const shell = await cache.match('/index.html');
  if (!shell) return;

  const html = await shell.text();
  const references = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/gi)]
    .map(match => match[1].split(/[?#]/, 1)[0])
    .filter(path =>
      path.startsWith('/assets/') &&
      /\.(?:js|mjs|css|woff2)$/.test(path)
    );

  // Fallback for a manifest fetch failure: cache the initial entrypoint graph.
  await Promise.all([...new Set(references)].map(async path => {
    try {
      await cache.add(path);
    } catch {
      // A single optional asset must not prevent the offline shell installing.
    }
  }));
}

async function cacheBuildAssets(cache) {
  try {
    const manifestResponse = await fetch('/manifest.json', { cache: 'reload' });
    if (!manifestResponse.ok) {
      await cacheInitialAppAssets(cache);
      return;
    }

    await cache.put('/manifest.json', manifestResponse.clone());
    const manifest = await manifestResponse.json();
    const assets = new Set();

    // Vite lists every entry, including lazy-loaded route chunks, in this manifest.
    for (const entry of Object.values(manifest)) {
      if (!entry || typeof entry !== 'object') continue;
      for (const file of [entry.file, ...(entry.css || []), ...(entry.assets || [])]) {
        if (typeof file === 'string' &&
            /^assets\/(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]+\.(?:js|mjs|css|woff2?|ttf|otf|svg|png|jpe?g|webp|avif|gif|ico)$/i.test(file)) {
          assets.add('/' + file);
        }
      }
    }

    await Promise.all([...assets].map(async path => {
      try {
        const response = await fetch(path, { cache: 'reload' });
        if (response.ok && response.type === 'basic') {
          await cache.put(path, response.clone());
        }
      } catch {
        // One optional asset must not block offline-shell installation.
      }
    }));
  } catch {
    // Keep a usable initial shell even if manifest-based precaching is unavailable.
    await cacheInitialAppAssets(cache);
  }
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_SHELL);
    await cacheBuildAssets(cache);
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

  // Never intercept backend endpoints or private API/auth/storage traffic.
  if (/^\/(?:api|auth|rest|storage|functions|realtime)(?:\/|$)/i.test(url.pathname)) return;

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

  // Only static, versioned Vite assets are cached. API and user data are never cached.
  if (/^\/assets\/.+\.(?:js|mjs|css|woff2|woff|ttf|svg|png|jpe?g|webp|avif|gif|ico)$/.test(url.pathname)) {
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
