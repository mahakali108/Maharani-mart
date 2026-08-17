'use client';

import { useFormState } from 'react-dom';
import Link from 'next/link';
import { requestPasswordResetAction, type FormState } from '@/lib/auth/actions';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SubmitButton } from '@/components/ui/submit-button';

const initialState: FormState = null;

export function ForgotPasswordForm() {
  const [state, formAction] = useFormState(requestPasswordResetAction, initialState);

  return (
    <form action={formAction} className="space-y-5">
      {state?.error ? (
        <div className="rounded-xl border border-primary-200 bg-primary-50 px-4 py-3 text-sm text-primary-700">
          {state.error}
        </div>
      ) : null}
      {state?.success ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {state.success}
        </div>
      ) : null}

      <div>
        <Label htmlFor="email">Email address</Label>
        <Input id="email" name="email" type="email" autoComplete="email" placeholder="you@business.com" required />
        {state?.fieldErrors?.email ? (
          <p className="mt-1 text-xs text-primary-600">{state.fieldErrors.email}</p>
        ) : null}
        <p className="mt-1.5 text-xs text-ink-400">
          We&apos;ll send a recovery link to your email. Mobile-number recovery is email-based — SMS OTP requires an external provider and is not configured.
        </p>
      </div>

      <SubmitButton pendingLabel="Sending link…">Send reset link</SubmitButton>

      <p className="text-center text-sm text-ink-500">
        Remembered your password?{' '}
        <Link href="/login" className="font-medium text-primary-600 hover:text-primary-700">
          Back to sign in
        </Link>
      </p>
    </form>
  );
}
