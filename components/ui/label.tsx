import type { LabelHTMLAttributes } from 'react';
import { cn } from '@/lib/utils/cn';

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn('mb-1.5 block text-sm font-medium text-ink-800', className)} {...props} />;
}
