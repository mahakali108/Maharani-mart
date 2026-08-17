'use client';

import { Minus, Plus } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

export function QtyStepper({
  value,
  min = 1,
  disabled = false,
  onChange,
  compact = false,
  id,
  label,
}: {
  value: number;
  min?: number;
  disabled?: boolean;
  onChange: (next: number) => void;
  compact?: boolean;
  id?: string;
  label: string;
}) {
  return (
    <div className={cn('flex items-center overflow-hidden rounded-lg border border-slate-200 bg-white', compact ? 'h-8' : 'h-10')}>
      <button
        type="button"
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={disabled || value <= min}
        className={cn('flex items-center justify-center text-slate-500 hover:bg-slate-50 disabled:text-slate-300', compact ? 'h-full w-8' : 'h-full w-10')}
        aria-label={`Decrease ${label}`}
      >
        <Minus className="h-3.5 w-3.5" />
      </button>
      <input
        id={id}
        type="number"
        min={min}
        step={1}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Math.max(min, Number(event.target.value) || min))}
        className="h-full min-w-0 flex-1 border-x border-slate-200 text-center text-xs font-bold outline-none disabled:bg-slate-50"
        aria-label={label}
      />
      <button
        type="button"
        onClick={() => onChange(value + 1)}
        disabled={disabled}
        className={cn('flex items-center justify-center text-slate-500 hover:bg-slate-50 disabled:text-slate-300', compact ? 'h-full w-8' : 'h-full w-10')}
        aria-label={`Increase ${label}`}
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
