'use client';

import { Minus, Plus } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

/**
 * Shared quantity stepper. Presentation only — every caller keeps its own
 * business rules (MOQ, server validation) authoritative. The cart, product
 * card and pack selector all reuse this same component so touch targets,
 * disabled states and focus styles stay consistent everywhere.
 */
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
    <div
      className={cn(
        'flex shrink-0 items-center overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm',
        compact ? 'h-9' : 'h-11'
      )}
    >
      <button
        type="button"
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={disabled || value <= min}
        className={cn(
          'flex items-center justify-center text-slate-600 transition hover:bg-slate-50 active:bg-slate-100',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300',
          'disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent',
          compact ? 'h-full w-9' : 'h-full w-11'
        )}
        aria-label={`Decrease ${label}`}
        title={`Decrease ${label}`}
      >
        <Minus className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
      </button>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        autoComplete="off"
        min={min}
        step={1}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Math.max(min, Number(event.target.value) || min))}
        className={cn(
          'no-spinner h-full w-full border-x border-slate-200 bg-white text-center font-bold text-slate-900 outline-none',
          'focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-300',
          'disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400',
          compact ? 'min-w-[2.75rem] text-xs' : 'min-w-[3.25rem] text-sm'
        )}
        aria-label={label}
      />
      <button
        type="button"
        onClick={() => onChange(value + 1)}
        disabled={disabled}
        className={cn(
          'flex items-center justify-center text-slate-600 transition hover:bg-slate-50 active:bg-slate-100',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300',
          'disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent',
          compact ? 'h-full w-9' : 'h-full w-11'
        )}
        aria-label={`Increase ${label}`}
        title={`Increase ${label}`}
      >
        <Plus className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
      </button>
    </div>
  );
}
