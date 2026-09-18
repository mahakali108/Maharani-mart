'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Error state for the catalog section (categories & brands).
 *
 * The reads can fail for reasons an operator can act on (a network blip, a
 * Supabase outage, a permission change), so this offers both a retry and a way
 * out — a dead end on the catalog screen blocks every admin task that starts
 * from it.
 */
export default function CatalogError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-950">Categories &amp; Brands</h1>
      </div>

      <div className="mx-auto w-full max-w-md rounded-2xl border border-rose-100 bg-white p-8 text-center shadow-card">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-rose-50">
          <AlertTriangle className="h-6 w-6 text-rose-600" />
        </div>
        <h2 className="text-base font-semibold text-ink-950">The catalog could not be loaded</h2>
        <p className="mt-1.5 text-sm text-ink-500">
          Nothing was changed. Try again — if it keeps happening, the connection to the catalog database may be down.
        </p>
        {error.digest ? (
          <p className="mt-2 font-mono text-[11px] text-ink-300">Reference: {error.digest}</p>
        ) : null}
        <div className="mt-5 flex flex-col gap-2">
          <Button onClick={reset} size="sm" className="w-full">
            Retry
          </Button>
          <Link href="/admin/dashboard">
            <Button variant="ghost" size="sm" className="w-full">
              Back to dashboard
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
