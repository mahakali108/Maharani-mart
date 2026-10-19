'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { useState, useTransition } from 'react';
import { saveDeliveryPinAction, setDeliveryPinActiveAction, type DeliveryPinFormState } from '@/lib/admin/delivery-actions';
import { SERVICE_DISTRICT, SERVICE_STATE } from '@/lib/config/service-area';

export interface DeliveryPinRow {
  id: string;
  district: string;
  state: string;
  pincode: string;
  is_active: boolean;
  minimum_order_paise: number;
  delivery_fee_paise: number;
}

const input = 'min-h-11 w-full rounded-xl border border-ink-200 bg-white px-3 text-sm text-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500';

function SaveButton({ edit }: { edit: boolean }) {
  const { pending } = useFormStatus();
  return <button disabled={pending} type="submit" className="min-h-11 rounded-xl bg-primary-600 px-5 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50">{pending ? 'Saving…' : edit ? 'Save terms' : 'Add PIN'}</button>;
}

export function DeliveryPinForm({ row }: { row?: DeliveryPinRow }) {
  const [state, action] = useFormState(saveDeliveryPinAction, null as DeliveryPinFormState);
  return (
    <form action={action} className="grid gap-3 rounded-2xl border border-ink-100 bg-ink-50 p-4 sm:grid-cols-2 lg:grid-cols-4">
      {row ? <input type="hidden" name="id" value={row.id} /> : null}
      <label className="text-xs font-medium text-ink-700">District
        <input className={`${input} mt-1`} name="district" defaultValue={row?.district ?? SERVICE_DISTRICT} maxLength={120} required />
      </label>
      <label className="text-xs font-medium text-ink-700">State
        <input className={`${input} mt-1`} name="state" defaultValue={row?.state ?? SERVICE_STATE} maxLength={120} required />
      </label>
      <label className="text-xs font-medium text-ink-700">Exact delivery PIN
        <input className={`${input} mt-1`} name="pincode" defaultValue={row?.pincode ?? ''} inputMode="numeric" autoComplete="postal-code" pattern="[0-9]{6}" maxLength={6} required />
      </label>
      <label className="text-xs font-medium text-ink-700">Minimum order (₹)
        <input className={`${input} mt-1`} name="minimumOrder" defaultValue={((row?.minimum_order_paise ?? 0) / 100).toFixed(2)} inputMode="decimal" required />
      </label>
      <label className="text-xs font-medium text-ink-700">Delivery fee (₹)
        <input className={`${input} mt-1`} name="deliveryFee" defaultValue={((row?.delivery_fee_paise ?? 0) / 100).toFixed(2)} inputMode="decimal" required />
      </label>
      <label className="flex min-h-11 items-center gap-2 self-end text-xs font-medium text-ink-700">
        <input type="checkbox" name="isActive" defaultChecked={row?.is_active ?? false} className="h-5 w-5" />
        Verified for online delivery
      </label>
      <div className="self-end"><SaveButton edit={Boolean(row)} /></div>
      {state?.error ? <p role="alert" className="text-sm text-amber-800 sm:col-span-2 lg:col-span-4">{state.error}</p> : null}
      {state?.success ? <p role="status" className="text-sm text-mint-700 sm:col-span-2 lg:col-span-4">{state.success}</p> : null}
    </form>
  );
}

export function DeliveryPinActions({ row }: { row: DeliveryPinRow }) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<DeliveryPinFormState>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setOpen(!open)} className="min-h-11 rounded-xl border border-ink-200 px-4 text-sm font-medium hover:bg-ink-50">{open ? 'Close edit' : 'Edit terms'}</button>
        <button type="button" disabled={pending} onClick={() => startTransition(async () => {
          setMessage(await setDeliveryPinActiveAction(row.id, !row.is_active));
        })} className="min-h-11 rounded-xl border border-ink-200 px-4 text-sm font-medium hover:bg-ink-50 disabled:opacity-50">
          {pending ? 'Updating…' : row.is_active ? 'Deactivate' : 'Activate'}
        </button>
      </div>
      {message?.error ? <p role="alert" className="text-xs text-amber-800">{message.error}</p> : null}
      {message?.success ? <p role="status" className="text-xs text-mint-700">{message.success}</p> : null}
      {open ? <DeliveryPinForm row={row} /> : null}
    </div>
  );
}
