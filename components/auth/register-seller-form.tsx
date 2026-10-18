'use client';

import { useFormState } from 'react-dom';
import Link from 'next/link';
import { registerSellerAction, type FormState } from '@/lib/auth/actions';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SubmitButton } from '@/components/ui/submit-button';
import { ResendConfirmationForm } from '@/components/auth/resend-confirmation-form';

const initialState: FormState = null;

export function RegisterSellerForm() {
  const [state, formAction] = useFormState(registerSellerAction, initialState);

  return (
    <form action={formAction} className="space-y-5">
      {state?.error ? (
        <div className="rounded-xl border border-primary-200 bg-primary-50 px-4 py-3 text-sm text-primary-700">
          {state.error}
        </div>
      ) : null}
      {state?.success ? (
        <>
          <div className="rounded-xl border border-mint-200 bg-mint-50 px-4 py-3 text-sm text-mint-700">
            {state.success}
          </div>
          <ResendConfirmationForm />
        </>
      ) : null}

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div>
          <Label htmlFor="businessName">Business / firm name</Label>
          <Input id="businessName" name="businessName" placeholder="Bazaar Wholesale Co." required />
          {state?.fieldErrors?.businessName ? (
            <p className="mt-1 text-xs text-primary-600">{state.fieldErrors.businessName}</p>
          ) : null}
        </div>

        <div>
          <Label htmlFor="fullName">Contact person full name</Label>
          <Input id="fullName" name="fullName" placeholder="Ramesh Kumar" required />
          {state?.fieldErrors?.fullName ? (
            <p className="mt-1 text-xs text-primary-600">{state.fieldErrors.fullName}</p>
          ) : null}
        </div>

        <div>
          <Label htmlFor="phone">Mobile number</Label>
          <Input id="phone" name="phone" type="tel" inputMode="numeric" placeholder="+91 98765 43210" required />
          <p className="mt-1 text-xs text-ink-400">10 digits — +91 and spaces allowed.</p>
          {state?.fieldErrors?.phone ? (
            <p className="mt-1 text-xs text-primary-600">{state.fieldErrors.phone}</p>
          ) : null}
        </div>

        <div>
          <Label htmlFor="email">Email address</Label>
          <Input id="email" name="email" type="email" placeholder="seller@business.com" required />
          {state?.fieldErrors?.email ? (
            <p className="mt-1 text-xs text-primary-600">{state.fieldErrors.email}</p>
          ) : null}
        </div>

        <div>
          <Label htmlFor="gstin">GSTIN (optional)</Label>
          <Input id="gstin" name="gstin" placeholder="10AABCU9603R1ZM" maxLength={20} />
          {state?.fieldErrors?.gstin ? (
            <p className="mt-1 text-xs text-primary-600">{state.fieldErrors.gstin}</p>
          ) : null}
        </div>

        <div>
          <Label htmlFor="pan">PAN (optional)</Label>
          <Input id="pan" name="pan" placeholder="AABCU9603R" maxLength={12} />
          {state?.fieldErrors?.pan ? (
            <p className="mt-1 text-xs text-primary-600">{state.fieldErrors.pan}</p>
          ) : null}
        </div>

        <div className="sm:col-span-2">
          <Label htmlFor="address">Business address (optional)</Label>
          <Input id="address" name="address" placeholder="Full dispatch/office address" maxLength={300} />
          {state?.fieldErrors?.address ? (
            <p className="mt-1 text-xs text-primary-600">{state.fieldErrors.address}</p>
          ) : null}
        </div>

        <div className="sm:col-span-2">
          <Label htmlFor="password">Password</Label>
          <Input id="password" name="password" type="password" minLength={8} placeholder="At least 8 characters" required />
          {state?.fieldErrors?.password ? (
            <p className="mt-1 text-xs text-primary-600">{state.fieldErrors.password}</p>
          ) : null}
        </div>
      </div>

      <SubmitButton pendingLabel="Creating seller account…" className="mt-2">
        Register as marketplace seller
      </SubmitButton>

      <p className="text-center text-sm text-ink-500">
        Already registered?{' '}
        <Link href="/login" className="font-medium text-primary-600 hover:text-primary-700">
          Sign in
        </Link>
        {' · '}
        <Link href="/register-retailer" className="font-medium text-primary-600 hover:text-primary-700">
          Register a retail shop
        </Link>
      </p>
    </form>
  );
}
