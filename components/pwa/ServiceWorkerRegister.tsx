'use client';

import { useEffect } from 'react';

/**
 * Registers the production service worker (public/sw.js) for the BROWSER PWA.
 *
 * Guards:
 *  - Only in a secure context (HTTPS) — required by browsers.
 *  - Skipped inside Capacitor: the Android WebView loads the same production
 *    origin and Capacitor already manages its own offline screen
 *    (www/offline.html via server.errorPath). Registering a SW there is
 *    unnecessary and could interfere with Capacitor's navigation, so we bail
 *    out when window.Capacitor is present.
 *  - Registration failures are swallowed so the app never breaks.
 */
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;
    if (!window.isSecureContext) return;

    // Capacitor-managed WebView: leave offline handling to Capacitor.
    const w = window as Window & { Capacitor?: unknown };
    if (w.Capacitor) return;

    const onLoad = () => {
      navigator.serviceWorker
        .register('/sw.js', { scope: '/' })
        .catch((err) => {
          // Never let SW issues affect the app.
          // eslint-disable-next-line no-console
          console.error('[PWA] Service worker registration failed:', err);
        });
    };

    window.addEventListener('load', onLoad);
    return () => window.removeEventListener('load', onLoad);
  }, []);

  return null;
}
