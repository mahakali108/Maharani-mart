'use client';

import { useFormState } from 'react-dom';
import Link from 'next/link';
import { registerRetailerAction, type FormState } from '@/lib/auth/actions';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { SubmitButton } from '@/components/ui/submit-button';

const initialState: FormState = null;

type Area = { id: string; name: string };

export function RegisterRetailerForm({ areas }: { areas: Area[] }) {
  const [state, formAction] = useFormState(registerRetailerAction, initialState);

  return (
    <form action={formAction} className="space-y-5">
      {state?.error ? (
        <div className="rounded-xl border border-primary-200 bg-primary-50 px-4 py-3 text-sm text-primary-700">
          {state.error}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div>
          <Label htmlFor="fullName">Owner full name</Label>
          <Input id="fullName" name="fullName" placeholder="Ramesh Kumar" required />
          {state?.fieldErrors?.fullName ? (
            <p className="mt-1 text-xs text-primary-600">{state.fieldErrors.fullName}</p>
          ) : null}
        </div>

        <div>
          <Label htmlFor="shopName">Shop / firm name</Label>
          <Input id="shopName" name="shopName" placeholder="Kumar General Store" required />
          {state?.fieldErrors?.shopName ? (
            <p className="mt-1 text-xs text-primary-600">{state.fieldErrors.shopName}</p>
          ) : null}
        </div>

        <div>
          <Label htmlFor="phone">Mobile number</Label>
          <Input id="phone" name="phone" type="tel" inputMode="numeric" maxLength={10} placeholder="98xxxxxxxx" required />
          {state?.fieldErrors?.phone ? (
            <p className="mt-1 text-xs text-primary-600">{state.fieldErrors.phone}</p>
          ) : null}
        </div>

        <div>
          <Label htmlFor="email">Email address</Label>
          <Input id="email" name="email" type="email" placeholder="you@business.com" required />
          {state?.fieldErrors?.email ? (
            <p className="mt-1 text-xs text-primary-600">{state.fieldErrors.email}</p>
          ) : null}
        </div>

        <div>
          <Label htmlFor="areaId">Area</Label>
          <Select id="areaId" name="areaId" required defaultValue="">
            <option value="" disabled>
              {areas.length ? 'Select your area' : 'No areas configured yet'}
            </option>
            {areas.map((area) => (
              <option key={area.id} value={area.id}>
                {area.name}
              </option>
            ))}
          </Select>
          {state?.fieldErrors?.areaId ? (
            <p className="mt-1 text-xs text-primary-600">{state.fieldErrors.areaId}</p>
          ) : null}
          {areas.length === 0 ? (
            <p className="mt-1 text-xs text-ink-500">
              Areas haven&apos;t been set up yet — contact the distributor to have your area added before registering.
            </p>
          ) : null}
        </div>

        <div>
          <Label htmlFor="password">Password</Label>
          <Input id="password" name="password" type="password" minLength={8} placeholder="At least 8 characters" required />
          {state?.fieldErrors?.password ? (
            <p className="mt-1 text-xs text-primary-600">{state.fieldErrors.password}</p>
          ) : null}
        </div>
      </div>

      <div>
        <Label htmlFor="address">Shop address</Label>
        <Input id="address" name="address" placeholder="Full shop address with landmark" required />
        {state?.fieldErrors?.address ? (
          <p className="mt-1 text-xs text-primary-600">{state.fieldErrors.address}</p>
        ) : null}
      </div>

      <SubmitButton pendingLabel="Creating account…" className="mt-2">
        Register shop
      </SubmitButton>

      <p className="text-center text-sm text-ink-500">
        Already registered?{' '}
        <Link href="/login" className="font-medium text-primary-600 hover:text-primary-700">
          Sign in
        </Link>
      </p>
    </form>
  );
}
