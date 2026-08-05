'use client';

import { useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Root error boundary. Catches any unhandled render/runtime error in
 * the app and shows a safe, on-brand fallback instead of a blank
 * screen or a raw stack trace.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Hook point for real error reporting (Sentry, etc.) in a later phase.
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-50 px-4">
      <div className="w-full max-w-md rounded-2xl border border-ink-100 bg-white p-8 text-center shadow-premium">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-primary-50">
          <AlertTriangle className="h-7 w-7 text-primary-600" />
        </div>
        <h1 className="text-xl font-semibold text-ink-950">Something went wrong</h1>
        <p className="mt-2 text-sm text-ink-500">
          An unexpected error occurred. You can try again, or contact support if this keeps
          happening.
        </p>
        {error.digest ? (
          <p className="mt-3 text-xs text-ink-300">Reference: {error.digest}</p>
        ) : null}
        <Button onClick={reset} className="mt-6 w-full">
          Try again
        </Button>
      </div>
    </div>
  );
}
