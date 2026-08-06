'use client';

import { useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function SegmentError({
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
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="w-full max-w-sm rounded-2xl border border-ink-100 bg-white p-8 text-center shadow-card">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary-50">
          <AlertTriangle className="h-6 w-6 text-primary-600" />
        </div>
        <h2 className="text-base font-semibold text-ink-950">Couldn&apos;t load this page</h2>
        <p className="mt-1.5 text-sm text-ink-500">Something went wrong loading this section.</p>
        <Button onClick={reset} size="sm" className="mt-5 w-full">
          Retry
        </Button>
      </div>
    </div>
  );
}
