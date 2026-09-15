'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';

export function HomeRefreshButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return <button type="button" onClick={() => startTransition(() => router.refresh())} disabled={pending}
    className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold text-action-700 hover:bg-action-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action-500 disabled:opacity-60">
    <RefreshCw className={`h-3.5 w-3.5 ${pending ? 'animate-spin' : ''}`} aria-hidden="true" />{pending ? 'Refreshing…' : 'Try again'}
  </button>;
}
