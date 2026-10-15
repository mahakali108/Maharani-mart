import { Check } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

export function CommerceSteps({ current }: { current: 1 | 2 | 3 }) {
  return <ol aria-label="Order progress" className="grid grid-cols-3 gap-2 rounded-2xl border border-slate-200 bg-white p-3 sm:p-4">
    {['Review cart', 'Checkout', 'Order placed'].map((label, index) => <li key={label}
      aria-current={current === index + 1 ? 'step' : undefined}
      className={cn('flex min-w-0 items-center gap-1.5 text-[10px] font-medium sm:gap-2 sm:text-xs', current === index + 1 ? 'text-primary-700' : 'text-slate-500')}>
      <span className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-full sm:h-8 sm:w-8',
        current > index + 1 ? 'bg-mint-100 text-mint-700' : current === index + 1 ? 'bg-primary-600 text-white' : 'bg-slate-100')}>
        {current > index + 1 ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : index + 1}
      </span><span>{label}</span>
    </li>)}
  </ol>;
}
