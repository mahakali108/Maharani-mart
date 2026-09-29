'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Loader2, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { setProductPackStockAction } from '@/lib/admin/products-actions';

export interface ProductPackStockRow {
  id: string;
  packName: string;
  skuCode: string;
  active: boolean;
  casePrice: number;
  mrp: number | null;
  unitsPerCase: number;
  quantity: number | null;
}

function statusFor(quantity: number | null) {
  if (quantity === null) return null;
  return quantity > 0
    ? { label: 'In Stock', classes: 'bg-emerald-50 text-emerald-700' }
    : { label: 'Out of Stock', classes: 'bg-rose-50 text-rose-700' };
}

export function ProductPackStockEditor({
  packs,
  unit,
}: {
  packs: ProductPackStockRow[];
  unit: string;
}) {
  const router = useRouter();
  const [quantities, setQuantities] = useState<Record<string, string>>(() =>
    Object.fromEntries(packs.map((pack) => [pack.id, pack.quantity === null ? '' : String(pack.quantity)]))
  );
  const [savingId, setSavingId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ packId: string; text: string; error: boolean } | null>(null);
  const [pending, startTransition] = useTransition();
  const normalizedUnit = unit.trim().toUpperCase() || 'PCS';

  function save(pack: ProductPackStockRow) {
    const raw = quantities[pack.id] ?? '';
    const value = Number(raw);
    if (raw.trim() === '' || !Number.isSafeInteger(value) || value < 0 || value > 2_000_000_000) {
      setMessage({ packId: pack.id, text: 'Enter a whole quantity from 0 to 2,000,000,000.', error: true });
      return;
    }

    setMessage(null);
    setSavingId(pack.id);
    startTransition(async () => {
      const result = await setProductPackStockAction(pack.id, value);
      if ('error' in result) {
        setMessage({ packId: pack.id, text: result.error, error: true });
      } else {
        setQuantities((current) => ({ ...current, [pack.id]: String(result.quantity) }));
        setMessage({ packId: pack.id, text: `Stock saved: ${result.quantity} ${normalizedUnit}.`, error: false });
        router.refresh();
      }
      setSavingId(null);
    });
  }

  if (packs.length === 0) {
    return <p className="rounded-xl border border-dashed border-ink-200 p-4 text-sm text-ink-500">Add a pack size before setting stock.</p>;
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-ink-500">
        Counts are tracked per sellable pack in {normalizedUnit}. Only Admins can change stock; checkout deducts it automatically.
      </p>
      <ul className="divide-y divide-ink-100 rounded-xl border border-ink-100 bg-white">
        {packs.map((pack) => {
          const status = statusFor(pack.quantity);
          const rowMessage = message?.packId === pack.id ? message : null;
          const isSaving = pending && savingId === pack.id;
          return (
            <li key={pack.id} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold text-ink-900">{pack.packName}</p>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${pack.active ? 'bg-emerald-50 text-emerald-700' : 'bg-ink-100 text-ink-500'}`}>
                    {pack.active ? 'Active' : 'Inactive'}
                  </span>
                  {status ? (
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${status.classes}`}>
                      {status.label}
                    </span>
                  ) : null}
                </div>
                <p className="mt-0.5 truncate font-mono text-[11px] text-ink-400">SKU {pack.skuCode}</p>
                <p className="mt-1 text-xs text-ink-500">
                  Case price ₹{pack.casePrice.toFixed(2)} · {pack.unitsPerCase} pcs/case
                  {pack.mrp !== null ? ` · MRP ₹${pack.mrp.toFixed(2)}/pc` : ''}
                </p>
                <p className="mt-1 text-xs text-ink-500">
                  Current: {pack.quantity === null ? '—' : `${pack.quantity} ${normalizedUnit}`}
                </p>
                {rowMessage ? (
                  <p role={rowMessage.error ? 'alert' : 'status'} className={`mt-1 text-xs ${rowMessage.error ? 'text-rose-700' : 'text-emerald-700'}`}>
                    {rowMessage.text}
                  </p>
                ) : null}
              </div>
              <div className="flex items-center gap-2 sm:w-[14rem] sm:shrink-0">
                <label className="sr-only" htmlFor={`pack-stock-${pack.id}`}>Stock quantity for {pack.packName} in {normalizedUnit}</label>
                <Input
                  id={`pack-stock-${pack.id}`}
                  type="number"
                  min={0}
                  max={2_000_000_000}
                  step={1}
                  inputMode="numeric"
                  value={quantities[pack.id] ?? ''}
                  onChange={(event) => setQuantities((current) => ({ ...current, [pack.id]: event.target.value }))}
                  className="h-10 min-w-0"
                  disabled={pending}
                />
                <Button type="button" size="sm" disabled={pending} onClick={() => save(pack)}>
                  {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : rowMessage && !rowMessage.error ? <CheckCircle2 className="h-4 w-4" /> : <Save className="h-4 w-4" />}
                  Save
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
