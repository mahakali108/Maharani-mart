'use client';

import { useTransition } from 'react';
import { Loader2 } from 'lucide-react';
import { deactivateStaffTargetAction } from '@/lib/admin/targets-actions';

/** Soft-off switch for a target — history is preserved (never deleted). */
export function TargetRowActions({ targetId }: { targetId: string }) {
  const [isPending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() => {
        if (!window.confirm('Deactivate this target? Progress history is kept.')) return;
        startTransition(async () => {
          await deactivateStaffTargetAction(targetId);
        });
      }}
      className="inline-flex items-center gap-1.5 rounded-lg bg-primary-50 px-2.5 py-1 text-xs font-medium text-primary-700 transition-colors hover:bg-primary-100 disabled:opacity-50"
    >
      {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
      Deactivate
    </button>
  );
}
