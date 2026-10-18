'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { UserPlus } from 'lucide-react';
import { createSellerAction } from '@/lib/admin/seller-actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/** Admin-created seller onboarding (V1 has no seller self-registration). */
export function CreateSellerForm() {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const submit = (formData: FormData) => {
    startTransition(async () => {
      const result = await createSellerAction(formData);
      if (result.ok) {
        setMessage('Invitation sent. The seller account is pending Super Admin review until approval.');
        formRef.current?.reset();
        router.refresh();
      } else {
        setMessage(result.error);
      }
    });
  };

  return (
    <form ref={formRef} action={submit} className="grid gap-3 sm:grid-cols-2">
      <Input name="businessName" placeholder="Business name *" required maxLength={160} />
      <Input name="contactName" placeholder="Contact name *" required maxLength={120} />
      <Input name="phone" placeholder="Phone (10-digit mobile) *" required inputMode="numeric" maxLength={20} />
      <Input name="email" placeholder="Email *" required type="email" maxLength={160} />
      <Input name="gstin" placeholder="GSTIN" maxLength={20} />
      <Input name="pan" placeholder="PAN" maxLength={12} />
      <Input name="addressLine" placeholder="Address" maxLength={300} className="sm:col-span-2" />
      <div className="sm:col-span-2">
        <Button type="submit" disabled={isPending}>
          <UserPlus className="h-4 w-4" aria-hidden /> Create seller
        </Button>
        {message ? (
          <p role="status" className="mt-2 text-sm text-ink-600">
            {message}
          </p>
        ) : null}
      </div>
    </form>
  );
}
