'use client';

import { useFormState } from 'react-dom';
import { BellRing, CheckCircle2 } from 'lucide-react';
import { saveNotificationPrefsAction, type ProfileActionResult } from '@/lib/retailer/profile-actions';
import { SubmitButton } from '@/components/ui/submit-button';

const initialState: ProfileActionResult = {};

export interface NotificationPrefsValues {
  orderUpdates: boolean;
  paymentUpdates: boolean;
  walletUpdates: boolean;
  offerUpdates: boolean;
}

const OPTIONS: { name: keyof NotificationPrefsValues; title: string; body: string }[] = [
  { name: 'orderUpdates', title: 'Order updates', body: 'Confirmations, packing, dispatch and delivery' },
  { name: 'paymentUpdates', title: 'Payment updates', body: 'Payments received and refunds' },
  { name: 'walletUpdates', title: 'Wallet & credit', body: 'Ledger activity, limit changes and reversals' },
  { name: 'offerUpdates', title: 'Offers & schemes', body: 'Festival schemes, new launches and promotions' },
];

export function NotificationPrefsForm({ initial }: { initial: NotificationPrefsValues }) {
  const [state, formAction] = useFormState(saveNotificationPrefsAction, initialState);

  return (
    <form action={formAction} className="space-y-2.5">
      {OPTIONS.map((option) => (
        <label
          key={option.name}
          className="flex cursor-pointer items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-primary-200"
        >
          <span className="min-w-0">
            <span className="block text-xs font-bold text-slate-900">{option.title}</span>
            <span className="mt-0.5 block text-[10px] text-slate-500">{option.body}</span>
          </span>
          <input
            type="checkbox"
            name={option.name}
            defaultChecked={initial[option.name]}
            className="h-5 w-5 shrink-0 rounded border-slate-300 text-primary-600 focus:ring-primary-300"
          />
        </label>
      ))}

      {state.error ? (
        <p role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-[11px] font-semibold text-rose-700">{state.error}</p>
      ) : null}
      {state.successMessage ? (
        <p role="status" className="flex items-center gap-1.5 rounded-xl bg-emerald-50 px-3 py-2 text-[11px] font-semibold text-emerald-700">
          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> {state.successMessage}
        </p>
      ) : null}

      <SubmitButton pendingLabel="Saving…" className="mt-1">
        <BellRing className="mr-1.5 inline h-4 w-4" aria-hidden="true" /> Save preferences
      </SubmitButton>
      <p className="text-[10px] leading-4 text-slate-400">
        Critical account notices (approval, suspension) are always delivered and cannot be turned off.
      </p>
    </form>
  );
}
