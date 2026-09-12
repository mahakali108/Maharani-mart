'use client';

import { useState, useTransition } from 'react';
import { Loader2, Pencil, Power, PowerOff } from 'lucide-react';
import { toggleSchemeAction } from '@/lib/admin/schemes-actions';
import { SchemeForm, type SchemeInitial } from '@/components/admin/scheme-form';

/**
 * Row actions for a scheme: toggle active/inactive and an expandable edit
 * form (same fields as creation, prefilled).
 */
export function SchemeRowActions({ scheme }: { scheme: SchemeInitial & { id: string } }) {
  const [isActive, setIsActive] = useState(true);
  const [showEdit, setShowEdit] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function toggle() {
    setError(null);
    const next = !isActive;
    startTransition(async () => {
      const result = await toggleSchemeAction(scheme.id, next);
      if ('error' in result && result.error) setError(result.error);
      else setIsActive(next);
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-1.5">
        <button
          type="button"
          disabled={isPending}
          onClick={() => setShowEdit((s) => !s)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-ink-100 px-2.5 py-1 text-xs font-medium text-ink-600 transition-colors hover:bg-ink-200 disabled:opacity-50"
        >
          <Pencil className="h-3.5 w-3.5" />
          Edit
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={toggle}
          className={
            isActive
              ? 'inline-flex items-center gap-1.5 rounded-lg bg-primary-50 px-2.5 py-1 text-xs font-medium text-primary-700 transition-colors hover:bg-primary-100 disabled:opacity-50'
              : 'inline-flex items-center gap-1.5 rounded-lg bg-ink-100 px-2.5 py-1 text-xs font-medium text-ink-500 transition-colors hover:bg-ink-200 disabled:opacity-50'
          }
        >
          {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : isActive ? <Power className="h-3.5 w-3.5" /> : <PowerOff className="h-3.5 w-3.5" />}
          {isActive ? 'Active' : 'Inactive'}
        </button>
      </div>
      {error ? <p className="text-xs text-primary-600">{error}</p> : null}
      {showEdit ? (
        <div className="mt-2 w-full max-w-xl rounded-xl border border-ink-200 bg-ink-50/50 p-4 text-left">
          <SchemeForm initial={scheme} />
        </div>
      ) : null}
    </div>
  );
}
