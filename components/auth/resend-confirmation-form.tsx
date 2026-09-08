'use client';

import { useFormState } from 'react-dom';
import { resendConfirmationAction, type FormState } from '@/lib/auth/actions';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SubmitButton } from '@/components/ui/submit-button';

const initialState: FormState = null;

/**
 * Recovery box shown when login fails with `email_not_confirmed` (the
 * Supabase project has "Confirm email" enabled and the user hasn't
 * clicked the link yet). Re-sends the Supabase signup confirmation
 * email. Also usable from the registration success state.
 */
export function ResendConfirmationForm({ defaultEmail = '' }: { defaultEmail?: string }) {
  const [state, formAction] = useFormState(resendConfirmationAction, initialState);

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-4">
      <p className="text-sm font-medium text-amber-800">Didn&apos;t get the confirmation email?</p>
      <p className="mt-0.5 text-xs text-amber-700">
        Enter your account email below and we&apos;ll send a fresh confirmation link.
      </p>
      <form action={formAction} className="mt-3 space-y-3">
        {state?.error ? (
          <div className="rounded-lg border border-primary-200 bg-primary-50 px-3 py-2 text-xs text-primary-700">
            {state.error}
          </div>
        ) : null}
        {state?.success ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
            {state.success}
          </div>
        ) : null}
        <div>
          <Label htmlFor="resend-email">Account email</Label>
          <Input
            id="resend-email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@business.com"
            defaultValue={defaultEmail}
            required
          />
          {state?.fieldErrors?.email ? (
            <p className="mt-1 text-xs text-primary-600">{state.fieldErrors.email}</p>
          ) : null}
        </div>
        <SubmitButton pendingLabel="Sending…">Resend confirmation email</SubmitButton>
      </form>
    </div>
  );
}
