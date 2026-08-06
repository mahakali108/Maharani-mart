'use client';

import { useTransition } from 'react';
import { Trash2 } from 'lucide-react';
import { toggleProductActiveAction, deleteProductAction } from '@/lib/admin/products-actions';
import { ToggleActiveButton } from '@/components/admin/toggle-active-button';

export function ProductRowActions({
  id,
  isActive,
  canDelete,
}: {
  id: string;
  isActive: boolean;
  canDelete: boolean;
}) {
  const [isPending, startTransition] = useTransition();

  return (
    <div className="flex items-center gap-2">
      <ToggleActiveButton isActive={isActive} onToggle={() => toggleProductActiveAction(id, !isActive)} />
      {canDelete ? (
        <button
          type="button"
          disabled={isPending}
          onClick={() => {
            if (confirm('Delete this product permanently? This cannot be undone.')) {
              startTransition(() => deleteProductAction(id));
            }
          }}
          className="rounded-lg p-1.5 text-ink-400 hover:bg-primary-50 hover:text-primary-600 disabled:opacity-50"
          aria-label="Delete product"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  );
}
