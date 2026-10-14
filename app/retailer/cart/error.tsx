'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { ShoppingCart } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Cart segment error boundary. Shows an honest failure state — never replaces
 * failed cart data with placeholder values.
 */
export default function CartError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[55vh] items-center justify-center">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-ivory-50 p-6 sm:p-10 text-center shadow-[0_8px_30px_rgba(15,23,42,0.08)]">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-peach-100">
          <ShoppingCart className="h-6 w-6 text-primary-600" />
        </div>
        <h1 className="text-base font-bold text-slate-950">Unable to load your cart.</h1>
        <p className="mt-1.5 text-xs leading-5 text-slate-500">Something went wrong while fetching your cart. Please try again.</p>
        <Button onClick={reset} size="sm" className="mt-5 w-full">
          Try Again
        </Button>
        <Link href="/retailer/home" className="mt-3 inline-flex min-h-11 items-center justify-center text-sm text-ink-600 underline underline-offset-4">Return to store</Link>
      </div>
    </div>
  );
}
