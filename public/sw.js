/* Maha Bazar by Maharani — production-safe service worker.
 *
 * SECURITY MODEL (do not weaken):
 *   - Only allowlisted STATIC, non-user-specific assets are cached:
 *       /_next/static/*, known public icons/art and local fonts.
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

if (typeof importScripts === 'function') importScripts('/pwa-release.js');
const STATIC_CACHE = 'mt-static-v3-' + (self.MAHA_RELEASE || 'local');
const OFFLINE_URL = '/offline.html';
// Pin the reviewed static file, not just a marker in potentially personalised HTML.
const OFFLINE_DIGEST = 'a8ed64c5dd09e876ce2d691a43a31ec044d46e26ef4f309d4239fd8ae6577d28';

async function cacheOfflinePage() {
  const url = new URL(OFFLINE_URL, self.location.origin).href;
  const response = await fetch(url, { credentials: 'omit', redirect: 'error', cache: 'no-store' });
  if (!response.ok || response.status !== 200 || response.redirected || response.url !== url ||
      !/^text\/html(?:;|$)/i.test(response.headers.get('content-type') || '')) throw Error('Invalid offline page');
  const bytes = await response.arrayBuffer();
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
    n => n.toString(16).padStart(2, '0')).join('');
  if (digest !== OFFLINE_DIGEST) throw Error('Unexpected offline content');
  const store = await caches.open(STATIC_CACHE);
  await store.put(OFFLINE_URL, new Response(bytes, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }));
}
self.addEventListener('install', event => event.waitUntil(cacheOfflinePage()));

// A waiting worker does not control the incumbent's clients, so include uncontrolled
// windows too. The snapshot is advisory ONLY: paths can change immediately afterwards.
const windows = () => self.clients.matchAll({ type: 'window', includeUncontrolled: true });
self.addEventListener('message', event => {
  if (event.data !== 'CHECK_UPDATE_READINESS') return;
  event.waitUntil((async () => {
    const clients = await windows();
    for (const client of clients) client.postMessage({ type: 'UPDATE_PENDING', openWindows: clients.length });
  })());
});

// Never call skipWaiting or claim clients. The browser, not a racy vote or timeout,
// retires the old worker once its clients unload. An unexpectedly closed tab needs no ACK.
self.addEventListener('activate', event => event.waitUntil((async () => {
  if ((await windows()).length) return; // includes uncontrolled/legacy documents
  const keys = await caches.keys();
  await Promise.all(keys.filter(key => key.startsWith('mt-static-') && key !== STATIC_CACHE).map(key => caches.delete(key)));
})()));

function isStaticAsset(url) {
  // A personalized URL can carry private query parameters even for a path
  // shaped like an asset. Cache only the canonical, query-free public URL.
  if (url.origin !== self.location.origin || url.search) return false;
  const path = url.pathname;
  // A file extension is NOT proof an endpoint is public: /_next/data/*.json
  // or /orders/*.json may contain account data. Never cache those paths.
  if (path.startsWith('/_next/static/')) return true;
  if (path === '/favicon.ico' || path === '/apple-touch-icon.png') return true;
  return /^\/(?:icons|logos|banners)\/[a-zA-Z0-9/_-]+\.(?:png|jpe?g|svg|webp|avif)$/.test(path);
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
        caches.open(STATIC_CACHE).then(store => store.match(OFFLINE_URL)).catch(() => null)
          .then(res => res || new Response('Maha Bazar is offline. Reconnect to continue.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }))
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
          const cacheControl = res?.headers?.get('cache-control') || '';
          const contentType = res?.headers?.get('content-type') || '';
          if (res && res.ok && res.type === 'basic' && !res.redirected
              && !/private|no-store/i.test(cacheControl)
              && !/text\/html|application\/json/i.test(contentType)) {
            // A redirect or JSON/HTML behind a static-looking URL is still
            // dynamic content. Never persist it in cross-session CacheStorage.
            cache.put(request, res.clone());
          }
          return res;
        } catch {
          return cached || Response.error();
        }
      })
    );
    return;
  }

  // Any other same-origin GET: pass through to the network untouched.
});
