import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '@/lib/utils/cn';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => {
    return (
      <input
        ref={ref}
        className={cn(
          'h-11 w-full rounded-xl border border-ink-200 bg-white px-3.5 text-sm text-ink-900',
          'placeholder:text-ink-400',
          'focus:outline-none focus:ring-2 focus:ring-primary-600 focus:border-transparent',
          'disabled:bg-ink-50 disabled:text-ink-400',
          className
        )}
        {...props}
      />
    );
  }
);
Input.displayName = 'Input';
