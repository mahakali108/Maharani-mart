'use client';

import Link from 'next/link';
import { useTransition } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { toggleAreaActiveAction, deleteAreaAction } from '@/lib/admin/master-data-actions';
import { ToggleActiveButton } from '@/components/admin/toggle-active-button';

export function AreaRowActions({ id, isActive }: { id: string; isActive: boolean }) {
  const [isPending, startTransition] = useTransition();

  return (
    <div className="flex items-center gap-2">
      <ToggleActiveButton isActive={isActive} onToggle={() => toggleAreaActiveAction(id, !isActive)} />
      <Link href={`/admin/areas/${id}`} className="rounded-lg p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700" aria-label="Edit area">
        <Pencil className="h-3.5 w-3.5" />
      </Link>
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          if (confirm('Delete this area? This cannot be undone.')) {
            startTransition(() =>
              deleteAreaAction(id).catch((err) => alert(err instanceof Error ? err.message : 'Failed to delete.'))
            );
          }
        }}
        className="rounded-lg p-1.5 text-ink-400 hover:bg-primary-50 hover:text-primary-600 disabled:opacity-50"
        aria-label="Delete area"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
