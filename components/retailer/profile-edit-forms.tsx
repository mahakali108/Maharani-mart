'use client';

import { useFormState } from 'react-dom';
import { CheckCircle2, UserRound, Store } from 'lucide-react';
import {
  updateContactDetailsAction,
  updateShopProfileAction,
  type ProfileActionResult,
} from '@/lib/retailer/profile-actions';
import { SubmitButton } from '@/components/ui/submit-button';

const initialState: ProfileActionResult = {};

const inputClass =
  'h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-primary-300 focus:ring-2 focus:ring-primary-100';
const labelClass = 'mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-500';

function FormMessage({ error, success }: { error?: string; success?: string }) {
  if (!error && !success) return null;
  return (
    <p
      role="status"
      className={
        error
          ? 'rounded-xl bg-rose-50 px-3 py-2 text-[11px] font-semibold text-rose-700'
          : 'flex items-center gap-1.5 rounded-xl bg-emerald-50 px-3 py-2 text-[11px] font-semibold text-emerald-700'
      }
    >
      {success ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : null}
      {error ?? success}
    </p>
  );
}

export function ContactDetailsForm({ fullName, phone }: { fullName: string; phone: string }) {
  const [state, formAction] = useFormState(updateContactDetailsAction, initialState);
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-3.5">
        <UserRound className="h-4 w-4 text-primary-600" aria-hidden="true" />
        <h2 className="text-sm font-bold text-slate-900">Owner contact details</h2>
      </div>
      <form action={formAction} className="space-y-4 p-4">
        <div>
          <label htmlFor="fullName" className={labelClass}>Full name</label>
          <input id="fullName" name="fullName" defaultValue={fullName} required maxLength={120} className={inputClass} />
        </div>
        <div>
          <label htmlFor="phone" className={labelClass}>Phone number</label>
          <input
            id="phone"
            name="phone"
            type="tel"
            inputMode="tel"
            defaultValue={phone}
            required
            className={inputClass}
          />
        </div>
        <FormMessage error={state.error} success={state.successMessage} />
        <SubmitButton pendingLabel="Saving…">Save contact details</SubmitButton>
      </form>
    </section>
  );
}

export function ShopProfileForm({ shopName, address, editable }: { shopName: string; address: string | null; editable: boolean }) {
  const [state, formAction] = useFormState(updateShopProfileAction, initialState);
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-3.5">
        <Store className="h-4 w-4 text-primary-600" aria-hidden="true" />
        <h2 className="text-sm font-bold text-slate-900">Business profile</h2>
      </div>
      <form action={formAction} className="space-y-4 p-4">
        <div>
          <label htmlFor="shopName" className={labelClass}>Shop / firm name</label>
          <input id="shopName" name="shopName" defaultValue={shopName} required maxLength={120} className={inputClass} />
        </div>
        <div>
          <label htmlFor="address" className={labelClass}>Shop address</label>
          <textarea
            id="address"
            name="address"
            rows={3}
            defaultValue={address ?? ''}
            maxLength={500}
            placeholder="Shop no., street, market, town"
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-primary-300 focus:ring-2 focus:ring-primary-100"
          />
          <p className="mt-1 text-[10px] text-slate-400">
            This is your registered shop address. Add separate delivery addresses from the Address book.
          </p>
        </div>
        {!editable ? (
          <p className="rounded-xl bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-800">
            GSTIN and service area are verified by the distributor and cannot be self-edited. Contact support for corrections.
          </p>
        ) : null}
        <FormMessage error={state.error} success={state.successMessage} />
        <SubmitButton pendingLabel="Saving…">Save business profile</SubmitButton>
      </form>
    </section>
  );
}
