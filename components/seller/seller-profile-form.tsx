'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { updateSellerProfileAction } from '@/lib/seller/actions';
import type { SellerTenant } from '@/lib/seller/guard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function SellerProfileForm({ seller }: { seller: SellerTenant }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    setFieldErrors({});
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await updateSellerProfileAction(formData);
      if (!result.ok) {
        setError(result.error);
        setFieldErrors(result.fieldErrors ?? {});
        return;
      }
      setSuccess('Business profile updated.');
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error ? (
        <p role="alert" className="rounded-xl border border-primary-200 bg-primary-50 px-4 py-2.5 text-xs text-primary-700">
          {error}
        </p>
      ) : null}
      {success ? (
        <p className="rounded-xl border border-mint-200 bg-mint-50 px-4 py-2.5 text-xs text-mint-700">
          {success}
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="businessName">Business / firm name *</Label>
          <Input id="businessName" name="businessName" defaultValue={seller.business_name} required />
          {fieldErrors.businessName ? (
            <p className="mt-1 text-xs text-primary-600">{fieldErrors.businessName}</p>
          ) : null}
        </div>
        <div>
          <Label htmlFor="contactName">Contact person</Label>
          <Input id="contactName" name="contactName" defaultValue={seller.contact_name ?? ''} />
          {fieldErrors.contactName ? (
            <p className="mt-1 text-xs text-primary-600">{fieldErrors.contactName}</p>
          ) : null}
        </div>
        <div>
          <Label htmlFor="phone">Mobile number</Label>
          <Input id="phone" name="phone" defaultValue={seller.phone ?? ''} placeholder="10-digit Indian mobile" />
          {fieldErrors.phone ? <p className="mt-1 text-xs text-primary-600">{fieldErrors.phone}</p> : null}
        </div>
        <div>
          <Label htmlFor="email">Business email</Label>
          <Input id="email" name="email" type="email" defaultValue={seller.email ?? ''} />
          {fieldErrors.email ? <p className="mt-1 text-xs text-primary-600">{fieldErrors.email}</p> : null}
        </div>
        <div>
          <Label htmlFor="gstin">GSTIN</Label>
          <Input id="gstin" name="gstin" defaultValue={seller.gstin ?? ''} placeholder="15-character GSTIN" />
          {fieldErrors.gstin ? <p className="mt-1 text-xs text-primary-600">{fieldErrors.gstin}</p> : null}
        </div>
        <div>
          <Label htmlFor="pan">PAN</Label>
          <Input id="pan" name="pan" defaultValue={seller.pan ?? ''} placeholder="10-character PAN" />
          {fieldErrors.pan ? <p className="mt-1 text-xs text-primary-600">{fieldErrors.pan}</p> : null}
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="addressLine">Business / dispatch address</Label>
          <Input id="addressLine" name="addressLine" defaultValue={seller.address_line ?? ''} maxLength={300} />
          {fieldErrors.addressLine ? (
            <p className="mt-1 text-xs text-primary-600">{fieldErrors.addressLine}</p>
          ) : null}
        </div>
      </div>

      <Button type="submit" disabled={pending}>
        {pending ? 'Saving…' : 'Save business profile'}
      </Button>
    </form>
  );
}
