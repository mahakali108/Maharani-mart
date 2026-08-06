'use client';

import { useFormState } from 'react-dom';
import { useTransition } from 'react';
import { Trash2, ChevronUp, ChevronDown } from 'lucide-react';
import {
  addProductPackAction,
  togglePackActiveAction,
  deleteProductPackAction,
  movePackAction,
  type PackFormState,
} from '@/lib/admin/products-actions';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SubmitButton } from '@/components/ui/submit-button';
import { ToggleActiveButton } from '@/components/admin/toggle-active-button';

interface Pack {
  id: string;
  pack_name: string;
  pack_sku_code: string;
  units_per_case: number;
  base_price: number;
  mrp: number | null;
  ptr: number | null;
  wholesale_price: number | null;
  barcode: string | null;
  is_active: boolean;
}

const initialState: PackFormState = null;

function money(v: number | null) {
  return v === null ? '—' : `₹${v.toFixed(2)}`;
}

export function ProductPackManager({ productId, packs }: { productId: string; packs: Pack[] }) {
  const boundAction = addProductPackAction.bind(null, productId);
  const [state, formAction] = useFormState(boundAction, initialState);
  const [isPending, startTransition] = useTransition();

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-500">
        Add every sellable size/pack for this product — e.g. <strong>1 Kg</strong>, <strong>5 Kg</strong>,{' '}
        <strong>10 Kg</strong>, <strong>25 Kg</strong>, <strong>50 Kg</strong>, or a case pack like{' '}
        <strong>6-pack</strong>. Each pack has its own SKU, barcode, and pricing tiers.
      </p>

      {packs.length === 0 ? (
        <p className="text-sm text-ink-500">No pack sizes yet — add the first one below.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-ink-100">
          <table className="w-full text-sm">
            <thead className="border-b border-ink-100 bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th className="whitespace-nowrap px-4 py-2.5 font-medium">Pack</th>
                <th className="whitespace-nowrap px-4 py-2.5 font-medium">SKU</th>
                <th className="whitespace-nowrap px-4 py-2.5 font-medium">Barcode</th>
                <th className="whitespace-nowrap px-4 py-2.5 font-medium">Units/case</th>
                <th className="whitespace-nowrap px-4 py-2.5 font-medium">Base Price</th>
                <th className="whitespace-nowrap px-4 py-2.5 font-medium">MRP</th>
                <th className="whitespace-nowrap px-4 py-2.5 font-medium">PTR</th>
                <th className="whitespace-nowrap px-4 py-2.5 font-medium">Wholesale</th>
                <th className="whitespace-nowrap px-4 py-2.5 font-medium">Status</th>
                <th className="whitespace-nowrap px-4 py-2.5 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {packs.map((pack, index) => (
                <tr key={pack.id}>
                  <td className="whitespace-nowrap px-4 py-2.5 font-medium text-ink-900">{pack.pack_name}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-ink-500">{pack.pack_sku_code}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-ink-500">{pack.barcode ?? '—'}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-ink-600">{pack.units_per_case}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-ink-600">{money(pack.base_price)}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-ink-600">{money(pack.mrp)}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-ink-600">{money(pack.ptr)}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-ink-600">{money(pack.wholesale_price)}</td>
                  <td className="whitespace-nowrap px-4 py-2.5">
                    <ToggleActiveButton
                      isActive={pack.is_active}
                      onToggle={() => togglePackActiveAction(pack.id, productId, !pack.is_active)}
                    />
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        disabled={isPending || index === 0}
                        onClick={() => startTransition(() => movePackAction(productId, pack.id, 'up'))}
                        className="rounded-lg p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700 disabled:opacity-30"
                        aria-label="Move pack up"
                      >
                        <ChevronUp className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={isPending || index === packs.length - 1}
                        onClick={() => startTransition(() => movePackAction(productId, pack.id, 'down'))}
                        className="rounded-lg p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700 disabled:opacity-30"
                        aria-label="Move pack down"
                      >
                        <ChevronDown className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() => {
                          if (confirm('Delete this pack? This cannot be undone.')) {
                            startTransition(() => deleteProductPackAction(pack.id, productId));
                          }
                        }}
                        className="rounded-lg p-1 text-ink-400 hover:bg-primary-50 hover:text-primary-600 disabled:opacity-30"
                        aria-label="Delete pack"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <form action={formAction} className="grid grid-cols-1 gap-3 rounded-xl border border-dashed border-ink-200 p-4 sm:grid-cols-4">
        {state?.error ? (
          <div className="sm:col-span-4 rounded-lg border border-primary-200 bg-primary-50 px-3 py-2 text-xs text-primary-700">
            {state.error}
          </div>
        ) : null}
        <div>
          <Label htmlFor="packName">Pack name</Label>
          <Input id="packName" name="packName" placeholder="5 Kg" required />
        </div>
        <div>
          <Label htmlFor="packSkuCode">Pack SKU</Label>
          <Input id="packSkuCode" name="packSkuCode" placeholder="MK-BEV-001-5KG" required />
        </div>
        <div>
          <Label htmlFor="barcode">Barcode</Label>
          <Input id="barcode" name="barcode" placeholder="Optional" />
        </div>
        <div>
          <Label htmlFor="unitsPerCase">Units/case</Label>
          <Input id="unitsPerCase" name="unitsPerCase" type="number" min={1} step={1} defaultValue={1} />
        </div>
        <div>
          <Label htmlFor="basePrice">Base price (₹)</Label>
          <Input id="basePrice" name="basePrice" type="number" min={0} step="0.01" required />
        </div>
        <div>
          <Label htmlFor="mrp">MRP (₹)</Label>
          <Input id="mrp" name="mrp" type="number" min={0} step="0.01" placeholder="Optional" />
        </div>
        <div>
          <Label htmlFor="ptr">PTR (₹)</Label>
          <Input id="ptr" name="ptr" type="number" min={0} step="0.01" placeholder="Optional" />
        </div>
        <div>
          <Label htmlFor="wholesalePrice">Wholesale price (₹)</Label>
          <Input id="wholesalePrice" name="wholesalePrice" type="number" min={0} step="0.01" placeholder="Optional" />
        </div>
        <div className="sm:col-span-4">
          <SubmitButton pendingLabel="Adding…">Add pack</SubmitButton>
        </div>
      </form>
    </div>
  );
}
