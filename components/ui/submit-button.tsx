'use client';

import { useFormStatus } from 'react-dom';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils/cn';

export function SubmitButton({
  children,
  pendingLabel,
  className,
  disabled = false,
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  className?: string;
  /** Set when the surrounding form cannot be submitted (e.g. configuration error). */
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending || disabled} className={cn('w-full', className)}>
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
