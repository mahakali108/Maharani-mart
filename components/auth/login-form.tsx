'use client';

import { useFormState } from 'react-dom';
import Link from 'next/link';
import { loginAction, type FormState } from '@/lib/auth/actions';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SubmitButton } from '@/components/ui/submit-button';

const initialState: FormState = null;

export function LoginForm({ redirectTo }: { redirectTo?: string }) {
  const [state, formAction] = useFormState(loginAction, initialState);

  return (
    <form action={formAction} className="space-y-5">
      {redirectTo ? <input type="hidden" name="redirect" value={redirectTo} /> : null}

      {state?.error ? (
        <div className="rounded-xl border border-primary-200 bg-primary-50 px-4 py-3 text-sm text-primary-700">
          {state.error}
        </div>
      ) : null}

      <div>
        <Label htmlFor="email">Email address</Label>
        <Input id="email" name="email" type="email" autoComplete="email" placeholder="you@business.com" required />
        {state?.fieldErrors?.email ? (
          <p className="mt-1 text-xs text-primary-600">{state.fieldErrors.email}</p>
        ) : null}
      </div>

      <div>
        <Label htmlFor="password">Password</Label>
        <Input id="password" name="password" type="password" autoComplete="current-password" placeholder="••••••••" required />
        {state?.fieldErrors?.password ? (
          <p className="mt-1 text-xs text-primary-600">{state.fieldErrors.password}</p>
        ) : null}
      </div>

      <SubmitButton pendingLabel="Signing in…">Sign in</SubmitButton>

      <p className="text-center text-sm text-ink-500">
        New retailer?{' '}
        <Link href="/register-retailer" className="font-medium text-primary-600 hover:text-primary-700">
          Register your shop
        </Link>
      </p>
    </form>
  );
}
