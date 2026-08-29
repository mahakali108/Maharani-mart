/* Maharani Traders — production-safe service worker.
 *
 * SECURITY MODEL (do not weaken):
 *   - Only STATIC, non-user-specific assets are cached (cache-first):
 *       /_next/static/*, public images, fonts, and other immutable files.
 *     These are byte-identical for every user, so caching them is safe.
 *   - Everything dynamic / user-specific is NETWORK-ONLY and is NEVER cached:
 *       * navigations (HTML pages, including authenticated ones)
 *       * /api/* responses (orders, cart, credit, prices, retailer data, ...)
 *       * Supabase endpoints (*.supabase.co) — auth, sessions, access tokens,
 *         RLS-protected data, AI responses
 *       * any non-GET request (POST / PUT / PATCH / DELETE)
 *   - On a navigation failure (offline) we serve a generic, honest
 *     "no internet connection" page (/offline.html). It never shows any
 *     cached user data. This is the BROWSER PWA offline screen and is kept
 *     separate from Capacitor's www/offline.html (Android WebView).
 */

const STATIC_CACHE = 'mt-static-v1';
const OFFLINE_URL = '/offline.html';
const PRECACHE = [OFFLINE_URL];

self.addEventListener('install', (event) => {
  // Precache the offline page, but never fail install if the network is down.
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      await Promise.allSettled(PRECACHE.map((url) => cache.add(url)));
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((key) => key !== STATIC_CACHE).map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

function isStaticAsset(url) {
  if (url.origin !== self.location.origin) return false;
  if (url.pathname.startsWith('/_next/static')) return true;
  return /\.(?:png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|eot|css|js|json)$/i.test(
    url.pathname
  );
}

function isApi(url) {
  return url.origin === self.location.origin && url.pathname.startsWith('/api/');
}

function isSupabase(url) {
  return url.hostname.endsWith('.supabase.co') || url.hostname.endsWith('.supabase.in');
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return; // never cache mutations

  const url = new URL(request.url);

  // NETWORK-ONLY: API responses and Supabase (auth, sessions, tokens, data).
  // These contain user-specific information and must never be cached.
  if (isApi(url) || isSupabase(url)) return;

  // Only manage same-origin requests; let cross-origin (analytics, etc.) pass.
  if (url.origin !== self.location.origin) return;

  // NAVIGATIONS (HTML pages, including authenticated ones): network-first.
  // The response is NEVER cached. On failure we show the generic offline page.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match(OFFLINE_URL).then((res) => res || Response.error())
      )
    );
    return;
  }

  // STATIC ASSETS: cache-first (safe — identical for every user).
  if (isStaticAsset(url)) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) return cached;
        try {
          const res = await fetch(request);
          if (res && res.ok && res.type === 'basic') {
            cache.put(request, res.clone());
          }
          return res;
        } catch (err) {
          return cached || Response.error();
        }
      })
    );
    return;
  }

  // Any other same-origin GET: pass through to the network untouched.
});
