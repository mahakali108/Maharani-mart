'use client';

import { useState } from 'react';
import { useFormState } from 'react-dom';
import Link from 'next/link';
import { Eye, EyeOff } from 'lucide-react';
import { updatePasswordAction, type FormState } from '@/lib/auth/actions';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SubmitButton } from '@/components/ui/submit-button';

const initialState: FormState = null;

export function ResetPasswordForm() {
  const [state, formAction] = useFormState(updatePasswordAction, initialState);
  const [show, setShow] = useState(false);
  const [show2, setShow2] = useState(false);

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
        <Label htmlFor="password">New password</Label>
        <div className="relative mt-1.5">
          <Input
            id="password"
            name="password"
            type={show ? 'text' : 'password'}
            autoComplete="new-password"
            placeholder="At least 8 characters"
            className="pr-10"
            required
            minLength={8}
          />
          <button
            type="button"
            onClick={() => setShow((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-600"
            tabIndex={-1}
            aria-label={show ? 'Hide password' : 'Show password'}
          >
            {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        {state?.fieldErrors?.password ? (
          <p className="mt-1 text-xs text-primary-600">{state.fieldErrors.password}</p>
        ) : null}
      </div>

      <div>
        <Label htmlFor="confirmPassword">Confirm new password</Label>
        <div className="relative mt-1.5">
          <Input
            id="confirmPassword"
            name="confirmPassword"
            type={show2 ? 'text' : 'password'}
            autoComplete="new-password"
            placeholder="••••••••"
            className="pr-10"
            required
          />
          <button
            type="button"
            onClick={() => setShow2((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-600"
            tabIndex={-1}
            aria-label={show2 ? 'Hide password' : 'Show password'}
          >
            {show2 ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        {state?.fieldErrors?.confirmPassword ? (
          <p className="mt-1 text-xs text-primary-600">{state.fieldErrors.confirmPassword}</p>
        ) : null}
      </div>

      <SubmitButton pendingLabel="Updating…">Update password</SubmitButton>

      <p className="text-center text-sm text-ink-500">
        <Link href="/login" className="font-medium text-primary-600 hover:text-primary-700">
          Back to sign in
        </Link>
      </p>
    </form>
  );
}
