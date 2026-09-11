'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check, MapPin, MapPinPlus, PencilLine } from 'lucide-react';
import { useCheckoutAddress } from '@/components/retailer/checkout-address-context';
import { AddressForm, addressLine, type SavedAddress } from '@/components/retailer/address-form';
import { DeliveryAddressCard } from '@/components/retailer/delivery-address-card';

/**
 * Checkout address picker: saved address-book entries, the registered shop
 * address as fallback, and an inline add-address form. The SELECTION is only
 * an id — the snapshot is resolved server-side in placeOrderAction, so a
 * tampered client can never inject an arbitrary delivery string.
 */
export function CheckoutAddressSelector({
  addresses,
  shop,
}: {
  addresses: SavedAddress[];
  shop: {
    shopName: string | null;
    contactName: string;
    addressText: string | null;
    area: string | null;
    phone: string | null;
  };
}) {
  const { selectedAddressId, setSelectedAddressId } = useCheckoutAddress();
  const [adding, setAdding] = useState(false);
  const router = useRouter();

  const selectedSaved = addresses.find((address) => address.id === selectedAddressId) ?? null;

  return (
    <div className="space-y-3">
      {/* Registered shop address fallback — always available. */}
      <button
        type="button"
        onClick={() => setSelectedAddressId(null)}
        aria-pressed={!selectedSaved}
        className={
          !selectedSaved
            ? 'flex w-full items-start gap-3 rounded-2xl border-2 border-primary-500 bg-primary-50/50 p-3.5 text-left transition'
            : 'flex w-full items-start gap-3 rounded-2xl border border-slate-200 bg-white p-3.5 text-left transition hover:border-slate-300'
        }
      >
        <span
          className={
            !selectedSaved
              ? 'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary-600 text-white'
              : 'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-slate-300 bg-white'
          }
        >
          {!selectedSaved ? <Check className="h-3 w-3" aria-hidden="true" /> : null}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 text-xs font-bold text-slate-900">
            <MapPin className="h-3.5 w-3.5 text-primary-600" aria-hidden="true" /> Registered shop address
          </span>
          <DeliveryAddressCard
            address={{
              shopName: shop.shopName,
              contactName: shop.contactName,
              address: shop.addressText,
              area: shop.area,
              phone: shop.phone,
            }}
          />
        </span>
      </button>

      {/* Saved address book entries. */}
      {addresses.map((address) => {
        const selected = selectedSaved?.id === address.id;
        return (
          <button
            key={address.id}
            type="button"
            onClick={() => setSelectedAddressId(address.id)}
            aria-pressed={selected}
            className={
              selected
                ? 'flex w-full items-start gap-3 rounded-2xl border-2 border-primary-500 bg-primary-50/50 p-3.5 text-left transition'
                : 'flex w-full items-start gap-3 rounded-2xl border border-slate-200 bg-white p-3.5 text-left transition hover:border-slate-300'
            }
          >
            <span
              className={
                selected
                  ? 'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary-600 text-white'
                  : 'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-slate-300 bg-white'
              }
            >
              {selected ? <Check className="h-3 w-3" aria-hidden="true" /> : null}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-1.5 text-xs font-bold text-slate-900">
                <MapPin className="h-3.5 w-3.5 text-primary-600" aria-hidden="true" />
                {address.label}
                {address.is_default ? (
                  <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[9px] font-bold text-emerald-700">Default</span>
                ) : null}
              </span>
              <span className="mt-1 block break-words text-[11px] leading-4 text-slate-600">
                {address.receiver_name} · {address.phone}
              </span>
              <span className="mt-0.5 block break-words text-[11px] leading-4 text-slate-500">{addressLine(address)}</span>
            </span>
          </button>
        );
      })}

      {adding ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <h3 className="mb-3 flex items-center gap-1.5 text-xs font-bold text-slate-900">
            <MapPinPlus className="h-4 w-4 text-primary-600" aria-hidden="true" /> Add a delivery address
          </h3>
          <AddressForm
            onDone={() => {
              setAdding(false);
              router.refresh();
            }}
          />
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 px-3 text-[11px] font-bold text-slate-700 transition hover:border-primary-200 hover:bg-primary-50 hover:text-primary-700"
          >
            <MapPinPlus className="h-3.5 w-3.5" aria-hidden="true" /> Add new address
          </button>
          <Link
            href="/retailer/account/addresses"
            className="flex h-9 items-center gap-1.5 rounded-xl px-2 text-[11px] font-bold text-primary-600 transition hover:text-primary-700"
          >
            <PencilLine className="h-3.5 w-3.5" aria-hidden="true" /> Manage address book
          </Link>
        </div>
      )}
    </div>
  );
}
