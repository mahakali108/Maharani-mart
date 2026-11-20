'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

// Opt in only from read-only landing pages. Never interrupt an order, edit or payment.
const safePages = new Set(['/retailer/home', '/about']);

export default function ServiceWorkerRegister() {
  const path = usePathname();
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [guidance, setGuidance] = useState('');
  useEffect(() => {
    if (!window.isSecureContext || !('serviceWorker' in navigator) || 'Capacitor' in window) return;
    const events = new AbortController();
    const options = { signal: events.signal };
    navigator.serviceWorker.addEventListener?.('message', (event: MessageEvent) => {
      if (event.data?.type !== 'UPDATE_PENDING') return;
      setGuidance('Finish any checkout first. Close all Maha Bazar tabs and app windows, then reopen to use the update.');
    }, options);
    const register = async () => {
      try {
        const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
        if (events.signal.aborted) return;
        const check = () => setWaiting(reg.waiting || null);
        const observe = () => {
          reg.installing?.addEventListener('statechange', check, options);
          check();
        };
        observe();
        reg.addEventListener?.('updatefound', observe, options);
        window.addEventListener('focus', () => { void reg.update().catch(() => {}); }, options);
      } catch (err) {
        console.error('[PWA] Service worker registration failed:', err);
      }
    };
    if (document.readyState === 'complete') void register();
    else window.addEventListener('load', register, options);
    return () => events.abort();
  }, []);
  useEffect(() => {
    if (!waiting) return;
    const changed = () => setWaiting(null);
    navigator.serviceWorker.addEventListener('controllerchange', changed);
    return () => navigator.serviceWorker.removeEventListener('controllerchange', changed);
  }, [waiting]);
  const available = !!waiting && safePages.has(path);
  function apply() {
    if (!safePages.has(window.location.pathname)) return;
    setGuidance('Finish checkout in any other tab, then close all Maha Bazar windows and reopen.');
    waiting?.postMessage('CHECK_UPDATE_READINESS');
  }
  // Keep the live region mounted, and do not steal focus or overlay a checkout.
  return <div className="min-w-0">
    <p role="status" aria-live="polite" aria-atomic="true" className={available ? 'break-words bg-shopping-950 px-4 py-2 text-sm text-white' : 'sr-only'}>
      {available ? guidance || 'Maha Bazar update available.' : ''}
    </p>
    {available && <button type="button" onClick={apply} className="min-h-11 rounded-lg bg-amber-300 px-4 font-bold text-slate-950 focus-visible:outline focus-visible:outline-2">Update now</button>}
  </div>;
}
