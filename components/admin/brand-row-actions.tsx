'use client';

import Link from 'next/link';
import { useTransition } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { toggleBrandActiveAction, deleteBrandAction } from '@/lib/admin/master-data-actions';
import { ToggleActiveButton } from '@/components/admin/toggle-active-button';

export function BrandRowActions({ id, isActive }: { id: string; isActive: boolean }) {
  const [isPending, startTransition] = useTransition();

  return (
    <div className="flex items-center gap-2">
      <ToggleActiveButton isActive={isActive} onToggle={() => toggleBrandActiveAction(id, !isActive)} />
      <Link href={`/admin/catalog/brands/${id}`} className="rounded-lg p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700" aria-label="Edit brand">
        <Pencil className="h-3.5 w-3.5" />
      </Link>
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          if (confirm('Delete this brand? This cannot be undone.')) {
            startTransition(() =>
              deleteBrandAction(id).catch((err) => alert(err instanceof Error ? err.message : 'Failed to delete.'))
            );
          }
        }}
        className="rounded-lg p-1.5 text-ink-400 hover:bg-primary-50 hover:text-primary-600 disabled:opacity-50"
        aria-label="Delete brand"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
