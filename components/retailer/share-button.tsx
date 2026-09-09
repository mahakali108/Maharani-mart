'use client';

import { useState, type MouseEvent } from 'react';
import { Check, Share2 } from 'lucide-react';

/**
 * Real product share action for the product detail page.
 *
 * - Uses the native share sheet (`navigator.share`) where available — this
 *   includes the Capacitor Android WebView when the share feature is enabled.
 * - Falls back to copying the current product URL when no share sheet exists
 *   (desktop browsers), with a short inline confirmation.
 * - The only value shared is `window.location.href` (the real product URL).
 *   No price, stock or internal identifier is part of the payload, and
 *   nothing is invented when the platform support is missing.
 */
export function ShareButton({ title }: { title: string }) {
  const [status, setStatus] = useState<'idle' | 'pending' | 'copied' | 'error'>('idle');

  async function handleShare(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (status === 'pending') return;
    const url = window.location.href;
    const hasShareSheet = typeof navigator.share === 'function';
    setStatus('pending');
    try {
      if (hasShareSheet) {
        await navigator.share({ title, url });
        setStatus('idle');
        return;
      }
      await navigator.clipboard.writeText(url);
      setStatus('copied');
      window.setTimeout(() => setStatus('idle'), 2000);
    } catch {
      // A cancelled share sheet (AbortError) is not an error state; if the
      // clipboard fallback itself failed, surface a quiet retry hint.
      if (!hasShareSheet) {
        setStatus('error');
        window.setTimeout(() => setStatus('idle'), 2000);
      }
    }
  }

  const label =
    status === 'copied' ? 'Product link copied' : status === 'error' ? 'Could not copy link — try again' : 'Share this product';

  return (
    <button
      type="button"
      onClick={handleShare}
      aria-label={label}
      title={label}
      className={`flex h-10 w-10 items-center justify-center rounded-xl border shadow-sm backdrop-blur transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300 ${
        status === 'copied'
          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
          : status === 'error'
            ? 'border-primary-200 bg-primary-50 text-primary-700'
            : 'border-slate-200 bg-white/95 text-slate-500 hover:border-primary-300 hover:text-primary-600'
      }`}
    >
      {status === 'pending' ? (
        <Share2 className="h-4 w-4 animate-pulse" aria-hidden="true" />
      ) : status === 'copied' ? (
        <Check className="h-4 w-4" aria-hidden="true" />
      ) : (
        <Share2 className="h-4 w-4" aria-hidden="true" />
      )}
      {status !== 'idle' ? (
        <span role="status" className="sr-only">
          {status === 'copied' ? 'Product link copied to clipboard.' : 'Sharing is not available right now.'}
        </span>
      ) : null}
    </button>
  );
}
