'use client';

import Link from 'next/link';
import { useTransition } from 'react';
import { ChevronUp, ChevronDown, Pencil, Trash2 } from 'lucide-react';
import { reorderBannerAction, toggleBannerActiveAction, deleteBannerAction } from '@/lib/admin/banners-actions';
import { ToggleActiveButton } from '@/components/admin/toggle-active-button';

export function BannerRowActions({
  bannerId,
  isActive,
  isFirst,
  isLast,
}: {
  bannerId: string;
  isActive: boolean;
  isFirst: boolean;
  isLast: boolean;
}) {
  const [isPending, startTransition] = useTransition();

  return (
    <div className="flex items-center justify-end gap-2">
      <button
        type="button"
        disabled={isPending || isFirst}
        onClick={() => startTransition(() => reorderBannerAction(bannerId, 'up'))}
        className="rounded-lg p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700 disabled:opacity-30"
        aria-label="Move banner earlier"
      >
        <ChevronUp className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        disabled={isPending || isLast}
        onClick={() => startTransition(() => reorderBannerAction(bannerId, 'down'))}
        className="rounded-lg p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700 disabled:opacity-30"
        aria-label="Move banner later"
      >
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
      <ToggleActiveButton isActive={isActive} onToggle={() => toggleBannerActiveAction(bannerId, !isActive)} />
      <Link
        href={`/admin/banners/${bannerId}`}
        className="rounded-lg p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700"
        aria-label="Edit banner"
      >
        <Pencil className="h-3.5 w-3.5" />
      </Link>
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          if (confirm('Delete this banner? This cannot be undone.')) {
            startTransition(() =>
              deleteBannerAction(bannerId).catch((err) => alert(err instanceof Error ? err.message : 'Failed to delete.'))
            );
          }
        }}
        className="rounded-lg p-1.5 text-ink-400 hover:bg-primary-50 hover:text-primary-600 disabled:opacity-50"
        aria-label="Delete banner"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
