const CACHE_NAME = 'kits-eos-public-v3';

const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/favicon.png',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png',
  '/college_logo.png'
];

// Install: Precache shell assets resiliently and activate immediately
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // Cache each asset individually so failure of one does not abort the rest
      await Promise.allSettled(
        PRECACHE_ASSETS.map((asset) =>
          cache.add(asset).catch((err) => {
            console.warn('[SW-PUBLIC] Precache individual asset notice:', asset, err);
          })
        )
      );
    })
  );
});

// Activate: Evict old caches from previous deployments and claim clients
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch: Strict security and network-first navigation
self.addEventListener('fetch', (event) => {
  // Only process GET requests
  if (event.request.method !== 'GET') {
    return;
  }

  const url = new URL(event.request.url);

  // STRICT SECURITY BOUNDARY:
  // Never intercept or cache Supabase Auth, REST, Storage, RPCs, or Functions
  if (
    url.hostname.includes('supabase.co') ||
    url.hostname.includes('supabase.in') ||
    url.pathname.includes('/rest/v1') ||
    url.pathname.includes('/auth/v1') ||
    url.pathname.includes('/storage/v1') ||
    url.pathname.includes('/functions/v1')
  ) {
    return;
  }

  // Never intercept Google OAuth or identity provider endpoints
  if (
    url.hostname.includes('google') ||
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('gstatic.com')
  ) {
    return;
  }

  // Never intercept or cache authenticated requests
  if (event.request.headers.has('Authorization')) {
    return;
  }

  // SPA Navigation requests: Network-first, fall back to cached index.html or offline fallback
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put('/index.html', responseClone);
            });
          }
          return response;
        })
        .catch(async () => {
          const cachedIndex = await caches.match('/index.html');
          if (cachedIndex) return cachedIndex;

          const cachedRoot = await caches.match('/');
          if (cachedRoot) return cachedRoot;

          return new Response(
            '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Offline - KITS EOS</title></head><body style="font-family:sans-serif;text-align:center;padding:2rem;"><h2>Offline</h2><p>Unable to connect to the network. Please check your internet connection.</p></body></html>',
            {
              status: 503,
              statusText: 'Service Unavailable',
              headers: { 'Content-Type': 'text/html; charset=utf-8' },
            }
          );
        })
    );
    return;
  }

  // Same-origin static assets: Network-first with cache fallback
  const isStaticAsset =
    url.pathname.startsWith('/assets/') ||
    /\.(?:js|css|png|jpg|jpeg|svg|ico|webp|webmanifest|woff|woff2|ttf|eot)$/i.test(url.pathname) ||
    ['script', 'style', 'image', 'font'].includes(event.request.destination);

  if (url.origin === self.location.origin && isStaticAsset) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const contentType = response.headers.get('content-type') || '';
            // Do NOT cache HTML responses for JS/CSS assets (SPA rewrite fallback on 404)
            if ((url.pathname.endsWith('.js') || url.pathname.endsWith('.css')) && contentType.includes('text/html')) {
              return response;
            }
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone);
            });
          }
          return response;
        })
        .catch(async () => {
          const cachedAsset = await caches.match(event.request);
          if (cachedAsset) return cachedAsset;

          return new Response('', {
            status: 504,
            statusText: 'Gateway Timeout',
          });
        })
    );
  }
});
