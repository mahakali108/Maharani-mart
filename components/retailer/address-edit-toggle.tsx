'use client';

import { useState } from 'react';
import { Pencil } from 'lucide-react';
import { AddressForm, type SavedAddress } from '@/components/retailer/address-form';

/**
 * Expandable per-address edit form — an inline disclosure keeps the address
 * book one clean list on phones instead of a nested routing maze.
 */
export function AddressEditToggle({ address }: { address: SavedAddress }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-3 border-t border-slate-100 pt-3">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex items-center gap-1.5 text-[11px] font-bold text-primary-600 transition hover:text-primary-700"
      >
        <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
        {open ? 'Close editor' : 'Edit this address'}
      </button>
      {open ? (
        <div className="mt-3">
          <AddressForm address={address} onDone={() => setOpen(false)} />
        </div>
      ) : null}
    </div>
  );
}
