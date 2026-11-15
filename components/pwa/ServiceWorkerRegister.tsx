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

    const register = () => {
      navigator.serviceWorker
        .register('/sw.js', { scope: '/' })
        .catch((err) => {
          // Never let SW issues affect the app.
           
          console.error('[PWA] Service worker registration failed:', err);
        });
    };

    // The Next.js app-router scripts are async and hydrate AFTER the window
    // `load` event in practice. Waiting only for `load` therefore meant the
    // service worker was never registered, which in turn stopped the offline
    // page and the browser's install prompt. If the document has already
    // finished loading, register now.
    if (document.readyState === 'complete') {
      register();
      return;
    }
    window.addEventListener('load', register);
    return () => window.removeEventListener('load', register);
  }, []);

  return null;
}
