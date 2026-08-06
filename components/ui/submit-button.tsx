'use client';

import { useFormStatus } from 'react-dom';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils/cn';

export function SubmitButton({
  children,
  pendingLabel,
  className,
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  className?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending} className={cn('w-full', className)}>
      {pending ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" />
          {pendingLabel ?? 'Please wait…'}
        </>
      ) : (
        children
      )}
    </Button>
  );
}
