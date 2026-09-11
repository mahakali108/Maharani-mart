import Link from 'next/link';
import { ChevronLeft, ChevronRight, MapPin, MapPinPlus, Phone } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { AddressCardActions, AddressForm, addressLine, type SavedAddress } from '@/components/retailer/address-form';
import { AddressEditToggle } from '@/components/retailer/address-edit-toggle';

export const metadata = { title: 'Address book — Maharani Traders' };

export default async function AddressesPage() {
  const user = await requireUser();
  const supabase = createClient();

  const { data: rows } = await supabase
    .from('retailer_addresses')
    .select(
      'id, label, receiver_name, phone, line1, line2, landmark, city, district, state, pincode, is_default'
    )
    .eq('retailer_id', user.id)
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: true });

  const addresses = ((rows ?? []) as unknown as SavedAddress[]).filter((row) => row.id);

  return (
    <div className="mx-auto w-full max-w-2xl space-y-5">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-[10px] font-semibold text-slate-500 sm:text-xs">
        <Link href="/retailer/account" className="flex items-center gap-1 rounded px-1 py-0.5 hover:text-primary-600">
          <ChevronLeft className="h-3.5 w-3.5" /> Account
        </Link>
        <ChevronRight className="h-3 w-3" />
        <span className="truncate text-slate-800">Address book</span>
      </nav>

      <div>
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary-600">Delivery</p>
        <h1 className="mt-1 text-xl font-bold tracking-tight text-slate-950 sm:text-2xl">Address book</h1>
        <p className="mt-1 text-xs text-slate-500">
          Save shop, godown or site addresses once — pick them in one tap at checkout.
        </p>
      </div>

      {addresses.length === 0 ? (
        <section className="flex min-h-[160px] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-8 text-center">
          <MapPin className="h-7 w-7 text-slate-300" aria-hidden="true" />
          <h2 className="mt-3 text-sm font-bold text-slate-800">No saved addresses yet</h2>
          <p className="mt-1 max-w-xs text-[11px] text-slate-500">
            Add your first delivery address below. Your registered shop address is still used until then.
          </p>
        </section>
      ) : (
        <ul className="space-y-2.5">
          {addresses.map((address) => (
            <li key={address.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs font-bold text-slate-900">{address.label}</span>
                    {address.is_default ? (
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[9px] font-bold text-emerald-700">
                        Default
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 break-words text-[11px] leading-4 text-slate-600">
                    {address.receiver_name} · <Phone className="mb-0.5 inline h-3 w-3" aria-hidden="true" /> {address.phone}
                  </p>
                  <p className="mt-1 break-words text-[11px] leading-4 text-slate-500">{addressLine(address)}</p>
                </div>
                <AddressCardActions addressId={address.id} isDefault={address.is_default} />
              </div>
              <AddressEditToggle address={address} />
            </li>
          ))}
        </ul>
      )}

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
          <MapPinPlus className="h-4 w-4 text-primary-600" aria-hidden="true" /> Add a new address
        </h2>
        <div className="mt-4">
          <AddressForm />
        </div>
      </section>
    </div>
  );
}
