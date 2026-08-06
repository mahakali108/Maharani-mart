'use client';

import { useTransition } from 'react';
import { Power, PowerOff } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

export function ToggleActiveButton({
  isActive,
  onToggle,
}: {
  isActive: boolean;
  onToggle: () => Promise<void>;
}) {
  const [isPending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() => startTransition(onToggle)}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50',
        isActive ? 'bg-primary-50 text-primary-700 hover:bg-primary-100' : 'bg-ink-100 text-ink-500 hover:bg-ink-200'
      )}
    >
      {isActive ? <Power className="h-3.5 w-3.5" /> : <PowerOff className="h-3.5 w-3.5" />}
      {isActive ? 'Active' : 'Inactive'}
    </button>
  );
}
