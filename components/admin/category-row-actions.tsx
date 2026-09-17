'use client';

import Link from 'next/link';
import { useTransition } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { toggleCategoryActiveAction, deleteCategoryAction } from '@/lib/admin/master-data-actions';
import { ToggleActiveButton } from '@/components/admin/toggle-active-button';

export function CategoryRowActions({
  id,
  name,
  isActive,
  canDelete,
}: {
  id: string;
  name: string;
  isActive: boolean;
  /** Mirrors RLS: category DELETE is admin/super-admin only (0005). */
  canDelete: boolean;
}) {
  const [isPending, startTransition] = useTransition();

  return (
    <div className="flex items-center gap-2">
      <ToggleActiveButton isActive={isActive} onToggle={() => toggleCategoryActiveAction(id, !isActive)} />
      <Link
        href={`/admin/catalog/categories/${id}`}
        className="rounded-lg p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700"
        aria-label={`Edit category ${name}`}
      >
        <Pencil className="h-3.5 w-3.5" />
      </Link>
      {canDelete ? (
        <button
          type="button"
          disabled={isPending}
          onClick={() => {
            if (confirm(`Delete category “${name}”? This cannot be undone.`)) {
              startTransition(() =>
                deleteCategoryAction(id).catch((err) => alert(err instanceof Error ? err.message : 'Failed to delete.'))
              );
            }
          }}
          className="rounded-lg p-1.5 text-ink-400 hover:bg-primary-50 hover:text-primary-600 disabled:opacity-50"
          aria-label={`Delete category ${name}`}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  );
}
