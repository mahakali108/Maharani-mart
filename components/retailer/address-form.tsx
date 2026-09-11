'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Loader2, MapPinPlus, Star, Trash2 } from 'lucide-react';
import {
  deleteAddressAction,
  saveAddressAction,
  setDefaultAddressAction,
} from '@/lib/retailer/address-actions';

export interface SavedAddress {
  id: string;
  label: string;
  receiver_name: string;
  phone: string;
  line1: string;
  line2: string | null;
  landmark: string | null;
  city: string;
  district: string | null;
  state: string;
  pincode: string;
  is_default: boolean;
}

export function addressLine(address: Pick<SavedAddress, 'line1' | 'line2' | 'landmark' | 'city' | 'district' | 'state' | 'pincode'>): string {
  return [address.line1, address.line2, address.landmark, address.city, address.district, address.state, address.pincode]
    .map((part) => part?.trim())
    .filter((part): part is string => !!part)
    .join(', ');
}

const inputClass =
  'h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-primary-300 focus:ring-2 focus:ring-primary-100';
const labelClass = 'mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-500';

export function AddressForm({
  address,
  onDone,
}: {
  address?: SavedAddress;
  onDone?: () => void;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(formData: FormData) {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const result = await saveAddressAction(formData);
      if ('error' in result && result.error) {
        setError(result.error);
        return;
      }
      setSuccess(address ? 'Address updated.' : 'Address added.');
      router.refresh();
      onDone?.();
    });
  }

  return (
    <form action={handleSubmit} className="space-y-3.5">
      {address ? <input type="hidden" name="addressId" value={address.id} /> : null}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="addr-label" className={labelClass}>Label</label>
          <input id="addr-label" name="label" defaultValue={address?.label ?? 'Shop'} maxLength={40} required className={inputClass} placeholder="Shop, Godown…" />
        </div>
        <div>
          <label htmlFor="addr-receiver" className={labelClass}>Receiver name</label>
          <input id="addr-receiver" name="receiverName" defaultValue={address?.receiver_name ?? ''} maxLength={120} required className={inputClass} />
        </div>
        <div>
          <label htmlFor="addr-phone" className={labelClass}>Phone</label>
          <input id="addr-phone" name="phone" type="tel" inputMode="tel" defaultValue={address?.phone ?? ''} required className={inputClass} />
        </div>
        <div>
          <label htmlFor="addr-pincode" className={labelClass}>PIN code</label>
          <input id="addr-pincode" name="pincode" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} defaultValue={address?.pincode ?? ''} required className={inputClass} />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="addr-line1" className={labelClass}>Address (shop no., street)</label>
          <input id="addr-line1" name="line1" defaultValue={address?.line1 ?? ''} maxLength={200} required className={inputClass} />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="addr-line2" className={labelClass}>Area / locality (optional)</label>
          <input id="addr-line2" name="line2" defaultValue={address?.line2 ?? ''} maxLength={200} className={inputClass} />
        </div>
        <div>
          <label htmlFor="addr-landmark" className={labelClass}>Landmark (optional)</label>
          <input id="addr-landmark" name="landmark" defaultValue={address?.landmark ?? ''} maxLength={120} className={inputClass} />
        </div>
        <div>
          <label htmlFor="addr-city" className={labelClass}>City / town</label>
          <input id="addr-city" name="city" defaultValue={address?.city ?? ''} maxLength={120} required className={inputClass} />
        </div>
        <div>
          <label htmlFor="addr-district" className={labelClass}>District (optional)</label>
          <input id="addr-district" name="district" defaultValue={address?.district ?? ''} maxLength={120} className={inputClass} />
        </div>
        <div>
          <label htmlFor="addr-state" className={labelClass}>State</label>
          <input id="addr-state" name="state" defaultValue={address?.state ?? 'Bihar'} maxLength={120} className={inputClass} />
        </div>
      </div>
      <label className="flex items-center gap-2 text-xs font-semibold text-slate-700">
        <input type="checkbox" name="isDefault" defaultChecked={address?.is_default ?? false} className="h-4 w-4 rounded border-slate-300 text-primary-600 focus:ring-primary-300" />
        Use as default delivery address
      </label>

      {error ? (
        <p role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-[11px] font-semibold text-rose-700">{error}</p>
      ) : null}
      {success ? (
        <p role="status" className="flex items-center gap-1.5 rounded-xl bg-emerald-50 px-3 py-2 text-[11px] font-semibold text-emerald-700">
          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> {success}
        </p>
      ) : null}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={isPending}
          className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-primary-600 px-4 text-xs font-bold text-white transition hover:bg-primary-700 disabled:opacity-60"
        >
          {isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <MapPinPlus className="h-4 w-4" aria-hidden="true" />}
          {address ? 'Save changes' : 'Add address'}
        </button>
        {onDone ? (
          <button
            type="button"
            onClick={onDone}
            className="flex h-11 items-center justify-center rounded-xl border border-slate-200 px-4 text-xs font-bold text-slate-600 transition hover:bg-slate-50"
          >
            Cancel
          </button>
        ) : null}
      </div>
    </form>
  );
}

export function AddressCardActions({ addressId, isDefault }: { addressId: string; isDefault: boolean }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function run(fn: () => Promise<unknown>) {
    startTransition(async () => {
      const result = await fn();
      if (
        result &&
        typeof result === 'object' &&
        'error' in result &&
        typeof (result as { error?: unknown }).error === 'string'
      ) {
        setError((result as { error: string }).error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex shrink-0 items-center gap-1.5">
      {error ? (
        <span role="alert" className="max-w-[140px] truncate rounded-lg bg-rose-50 px-2 py-1 text-[9px] font-bold text-rose-700" title={error}>
          {error}
        </span>
      ) : null}
      {!isDefault ? (
        <button
          type="button"
          disabled={isPending}
          aria-label="Set as default address"
          title="Set as default"
          onClick={() => run(() => setDefaultAddressAction(addressId))}
          className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-400 transition hover:bg-amber-50 hover:text-amber-600 disabled:opacity-50"
        >
          <Star className="h-4 w-4" aria-hidden="true" />
        </button>
      ) : null}
      {confirming ? (
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={isPending}
            onClick={() => run(() => deleteAddressAction(addressId))}
            className="flex h-8 items-center rounded-lg bg-rose-600 px-2.5 text-[10px] font-bold text-white transition hover:bg-rose-700 disabled:opacity-50"
          >
            {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : 'Delete'}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="flex h-8 items-center rounded-lg border border-slate-200 px-2.5 text-[10px] font-bold text-slate-600"
          >
            No
          </button>
        </div>
      ) : (
        <button
          type="button"
          disabled={isPending}
          aria-label="Delete address"
          title="Delete address"
          onClick={() => setConfirming(true)}
          className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
