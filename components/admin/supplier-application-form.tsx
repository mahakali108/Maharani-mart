'use client';

import { useRef, useState, useTransition } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { submitSupplierApplicationAction } from '@/lib/admin/supplier-actions';
import type { SupplierApplicationErrors } from '@/lib/admin/supplier-application';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';

const FIELDS: {
  name: string;
  label: string;
  required?: boolean;
  hint?: string;
  type?: string;
  span?: boolean;
}[] = [
  { name: 'businessName', label: 'Business / firm name', required: true },
  { name: 'legalName', label: 'Registered legal name (if different)' },
  { name: 'contactName', label: 'Contact person', required: true },
  { name: 'phone', label: 'Mobile number', required: true, type: 'tel', hint: '10-digit Indian mobile. Used only to contact you about this application.' },
  { name: 'email', label: 'Email (optional)', type: 'email' },
  { name: 'gstin', label: 'GSTIN (optional)', hint: 'Only if GST-registered. We verify documents later — entering it here does not mark it verified.' },
  { name: 'addressLine', label: 'Business address', span: true },
  { name: 'city', label: 'City' },
  { name: 'state', label: 'State' },
  { name: 'pincode', label: 'PIN code' },
  { name: 'productCategories', label: 'What do you supply? (categories / brands)', span: true },
];

export function SupplierApplicationForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [errors, setErrors] = useState<SupplierApplicationErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [isPending, startTransition] = useTransition();

  if (done) {
    return (
      <div className="rounded-2xl border border-mint-200 bg-mint-50 p-5 text-center" role="status">
        <CheckCircle2 className="mx-auto h-8 w-8 text-mint-600" aria-hidden />
        <h2 className="mt-2 text-base font-semibold text-ink-900">Application received</h2>
        <p className="mt-1 text-sm text-ink-600">
          Thank you. Our team will review your application and contact you on the mobile number provided.
          Applying does not create a supplier account or login.
        </p>
      </div>
    );
  }

  return (
    <form
      ref={formRef}
      className="space-y-5"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        const formData = new FormData(e.currentTarget);
        startTransition(async () => {
          const result = await submitSupplierApplicationAction(formData);
          if (result.ok) {
            setDone(true);
          } else {
            setErrors(result.errors);
            setError(result.error ?? null);
          }
        });
      }}
    >
      {error ? (
        <div role="alert" className="rounded-xl border border-primary-200 bg-primary-50 px-4 py-3 text-sm text-primary-700">
          {error}
        </div>
      ) : null}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        {FIELDS.map((f) => (
          <div key={f.name} className={f.span ? 'sm:col-span-2' : undefined}>
            <Label htmlFor={f.name}>
              {f.label}
              {f.required ? ' *' : ''}
            </Label>
            <Input id={f.name} name={f.name} type={f.type ?? 'text'} required={f.required} aria-describedby={errors[f.name as keyof SupplierApplicationErrors] ? `${f.name}-error` : undefined} />
            {f.hint ? <p className="mt-1 text-xs text-ink-400">{f.hint}</p> : null}
            {errors[f.name as keyof SupplierApplicationErrors] ? (
              <p id={`${f.name}-error`} role="alert" className="mt-1 text-xs text-primary-600">
                {errors[f.name as keyof SupplierApplicationErrors]}
              </p>
            ) : null}
          </div>
        ))}
      </div>
      {/* Honeypot: hidden from people, attractive to bots. */}
      <div className="hidden" aria-hidden="true">
        <label>
          Website <input name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <Button type="submit" disabled={isPending} className="w-full sm:w-auto">
        {isPending ? 'Submitting…' : 'Submit application'}
      </Button>
      <p className="text-xs text-ink-400">
        Your details are visible only to Maharani Traders admin staff reviewing supplier applications.
        No login is created and no document upload is requested on this form.
      </p>
    </form>
  );
}
