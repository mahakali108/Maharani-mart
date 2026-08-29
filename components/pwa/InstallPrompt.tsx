'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

/**
 * Lightweight, non-intrusive install prompt.
 *
 * Behavior:
 *  - Only appears when the browser fires a genuine `beforeinstallprompt`
 *    (i.e. the PWA is actually installable). No fake install buttons.
 *  - Remembers a "Not now" dismissal in localStorage so we never nag.
 *  - Hidden on auth screens (login / register / password reset) so it can't
 *    interfere with signing in.
 *  - Installation is strictly optional — dismissing keeps full functionality.
 */

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

const DISMISS_KEY = 'mt-pwa-install-dismissed';
const AUTH_PATHS = ['/login', '/register-retailer', '/forgot-password', '/reset-password'];

export default function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    const handler = (e: Event) => {
      // Prevent the browser's default mini-infobar so we can show our own.
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler as EventListener);
    return () =>
      window.removeEventListener('beforeinstallprompt', handler as EventListener);
  }, []);

  useEffect(() => {
    if (!deferred) return;
    let dismissed = false;
    try {
      dismissed = window.localStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      dismissed = false;
    }
    const onAuth = AUTH_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'));
    setVisible(!dismissed && !onAuth);
  }, [deferred, pathname]);

  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice;
    setDeferred(null);
    setVisible(false);
  };

  const dismiss = () => {
    setVisible(false);
    try {
      window.localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* ignore */
    }
  };

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-label="Install Maharani Traders app"
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexWrap: 'wrap',
        padding: '12px 16px',
        background: '#ffffff',
        color: '#1a1a1a',
        borderTop: '1px solid #ececec',
        boxShadow: '0 -4px 16px rgba(0,0,0,0.08)',
        fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
      }}
    >
      <div style={{ flex: '1 1 180px', minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>Maharani Traders</div>
        <div style={{ fontSize: 12.5, color: '#6d6d6d', lineHeight: 1.4 }}>
          Install the app for a faster, app-like experience.
        </div>
      </div>
      <button
        type="button"
        onClick={install}
        style={{
          appearance: 'none',
          border: 0,
          cursor: 'pointer',
          background: '#c8102e',
          color: '#fff',
          fontWeight: 600,
          fontSize: 14,
          padding: '10px 18px',
          borderRadius: 10,
        }}
      >
        Install
      </button>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Not now"
        style={{
          appearance: 'none',
          border: 0,
          cursor: 'pointer',
          background: 'transparent',
          color: '#6d6d6d',
          fontWeight: 600,
          fontSize: 14,
          padding: '10px 12px',
          borderRadius: 10,
        }}
      >
        Not now
      </button>
    </div>
  );
}
