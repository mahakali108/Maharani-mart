'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { BRAND } from '@/lib/brand';

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

/**
 * True when the page is already running as an installed app (Android Chrome,
 * desktop Chromium, iOS home-screen web app). Exported for unit tests.
 */
export function isRunningStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return true;
  } catch {
    /* matchMedia unavailable */
  }
  return (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
}
/** True when "Not now" (or a completed install) was remembered in this browser. */
function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

function rememberDismissed(): void {
  try {
    window.localStorage.setItem(DISMISS_KEY, '1');
  } catch {
    /* ignore */
  }
}

const AUTH_PATHS = ['/login', '/register-retailer', '/forgot-password', '/reset-password'];

export default function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    // Already running as an installed app: never offer to install it again.
    if (isRunningStandalone()) return;

    const handler = (e: Event) => {
      // Prevent the browser's default mini-infobar so we can show our own.
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setDismissed(readDismissed());
    };
    // A dismissal made in another tab of this browser applies here too.
    const stored = (e: StorageEvent) => {
      if (e.key === DISMISS_KEY) setDismissed(readDismissed());
    };
    // Once installed, drop the prompt and remember it, so it never reappears.
    const installed = () => {
      setDeferred(null);
      setDismissed(true);
      rememberDismissed();
    };
    window.addEventListener('beforeinstallprompt', handler as EventListener);
    window.addEventListener('appinstalled', installed);
    window.addEventListener('storage', stored);
    return () => {
      window.removeEventListener('storage', stored);
      window.removeEventListener('beforeinstallprompt', handler as EventListener);
      window.removeEventListener('appinstalled', installed);
    };
  }, []);

  // Derived, not stored: shown only while a genuine install event is held, the
  // user has not dismissed it, and the current screen is not an auth screen.
  const onAuth = AUTH_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'));
  const visible = deferred !== null && !dismissed && !onAuth;

  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice;
    setDeferred(null);
  };

  const dismiss = () => {
    setDismissed(true);
    rememberDismissed();
  };

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-label={`Install ${BRAND.name}`}
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
        background: 'var(--color-surface-card)',
        color: 'var(--color-text-primary)',
        borderTop: '1px solid var(--color-surface-border)',
        boxShadow: '0 -4px 16px rgba(0,0,0,0.08)',
        fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
      }}
    >
      <div style={{ flex: '1 1 180px', minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>{BRAND.name}</div>
        <div style={{ fontSize: 12.5, color: 'var(--color-text-secondary)', lineHeight: 1.4 }}>
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
          background: 'var(--color-action-primary)',
          color: 'var(--color-action-on-primary)',
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
          color: 'var(--color-text-secondary)',
          fontWeight: 600,
          fontSize: 14,
          padding: '10px 12px',
          minHeight: 44,
          minWidth: 44,
          borderRadius: 10,
        }}
      >
        Not now
      </button>
    </div>
  );
}
