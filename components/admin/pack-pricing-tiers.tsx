'use client';

import { useFormState } from 'react-dom';
import { useState, useTransition } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import {
  addPricingTierAction,
  updatePricingTierAction,
  deletePricingTierAction,
  type TierFormState,
} from '@/lib/admin/products-actions';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SubmitButton } from '@/components/ui/submit-button';

export interface PackTier {
  id: string;
  min_quantity: number;
  max_quantity: number | null;
  price_per_piece: number;
  rule_type: 'default' | 'case' | 'bulk';
  label: string | null;
}

const initialState: TierFormState = null;

const RULE_LABELS: Record<string, string> = {
  default: 'Default',
  case: 'Case price',
  bulk: 'Bulk discount',
};

function money(v: number) {
  return `₹${v.toFixed(2)}`;
}

function TierEditForm({
  tierId,
  productId,
  tier,
  onDone,
}: {
  tierId: string;
  productId: string;
  tier: PackTier;
  onDone: () => void;
}) {
  const bound = updatePricingTierAction.bind(null, tierId, productId);
  const [state, formAction] = useFormState(bound, initialState);

  return (
    <form action={formAction} className="grid grid-cols-1 gap-2 rounded-lg border border-ink-100 bg-ink-50/60 p-3 sm:grid-cols-4">
      <div>
        <Label htmlFor={`min-${tierId}`}>Min pieces</Label>
        <Input id={`min-${tierId}`} name="minQuantity" type="number" min={1} step={1} defaultValue={tier.min_quantity} />
      </div>
      <div>
        <Label htmlFor={`max-${tierId}`}>Max pieces</Label>
        <Input id={`max-${tierId}`} name="maxQuantity" type="number" min={1} step={1} defaultValue={tier.max_quantity ?? ''} placeholder="No limit" />
      </div>
      <div>
        <Label htmlFor={`price-${tierId}`}>Price / piece (₹)</Label>
        <Input id={`price-${tierId}`} name="pricePerPiece" type="number" min={0} step="0.01" defaultValue={tier.price_per_piece} />
      </div>
      <div>
        <Label htmlFor={`label-${tierId}`}>Label</Label>
        <Input id={`label-${tierId}`} name="label" defaultValue={tier.label ?? RULE_LABELS[tier.rule_type] ?? 'Bulk discount'} />
      </div>
      {state?.error ? (
        <p role="alert" className="sm:col-span-3 text-xs font-medium text-primary-700">
          {state.error}
        </p>
      ) : null}
      <div className="flex items-end justify-end gap-2 sm:col-span-1">
        <button
          type="button"
          onClick={onDone}
          className="h-9 rounded-lg border border-ink-200 px-3 text-xs font-semibold text-ink-600 hover:bg-ink-100"
        >
          Cancel
        </button>
        <SubmitButton pendingLabel="Saving…">Save</SubmitButton>
      </div>
    </form>
  );
}

export function PackPricingTiers({
  packId,
  productId,
  tiers,
}: {
  packId: string;
  productId: string;
  tiers: PackTier[];
}) {
  const [editingTierId, setEditingTierId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const boundAdd = addPricingTierAction.bind(null, packId, productId);
  const [addState, addFormAction] = useFormState(boundAdd, initialState);

  const sorted = [...tiers].sort((a, b) => a.min_quantity - b.min_quantity);

  return (
    <div className="mt-3 space-y-3 rounded-xl border border-dashed border-primary-200 bg-primary-50/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-bold uppercase tracking-wide text-primary-700">Bulk pricing rules</p>
        <span className="text-[9px] text-ink-400">GST-inclusive · evaluated on total pieces</span>
      </div>

      {sorted.length === 0 ? (
        <p className="text-xs text-ink-500">No pricing rules yet — a derived default piece price will apply.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-ink-100 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-ink-100 bg-ink-50 text-left text-[10px] uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-3 py-2 font-medium">Min pieces</th>
                <th className="px-3 py-2 font-medium">Max pieces</th>
                <th className="px-3 py-2 font-medium">Rule</th>
                <th className="px-3 py-2 font-medium">Price / piece</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {sorted.map((tier) =>
                editingTierId === tier.id ? (
                  <tr key={tier.id}>
                    <td colSpan={5} className="px-2 py-2">
                      <TierEditForm tierId={tier.id} productId={productId} tier={tier} onDone={() => setEditingTierId(null)} />
                    </td>
                  </tr>
                ) : (
                  <tr key={tier.id} className="text-xs text-ink-700">
                    <td className="px-3 py-2">{tier.min_quantity}</td>
                    <td className="px-3 py-2">{tier.max_quantity ?? 'No limit'}</td>
                    <td className="px-3 py-2">
                      <span className="rounded-full bg-ink-100 px-2 py-0.5 text-[10px] font-semibold text-ink-600">
                        {tier.label ?? RULE_LABELS[tier.rule_type] ?? 'Bulk discount'}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-semibold text-ink-900">{money(tier.price_per_piece)}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          disabled={isPending}
                          onClick={() => setEditingTierId(tier.id)}
                          className="rounded-lg p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700 disabled:opacity-30"
                          aria-label="Edit pricing rule"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={isPending}
                          onClick={() => {
                            if (confirm('Delete this pricing rule?')) {
                              startTransition(() => deletePricingTierAction(tier.id, productId));
                            }
                          }}
                          className="rounded-lg p-1.5 text-ink-400 hover:bg-primary-50 hover:text-primary-600 disabled:opacity-30"
                          aria-label="Delete pricing rule"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              )}
            </tbody>
          </table>
        </div>
      )}

      <form action={addFormAction} className="grid grid-cols-2 items-end gap-2 sm:grid-cols-5">
        <div>
          <Label htmlFor={`add-min-${packId}`}>Min pieces</Label>
          <Input id={`add-min-${packId}`} name="minQuantity" type="number" min={1} step={1} required />
        </div>
        <div>
          <Label htmlFor={`add-max-${packId}`}>Max pieces</Label>
          <Input id={`add-max-${packId}`} name="maxQuantity" type="number" min={1} step={1} placeholder="No limit" />
        </div>
        <div>
          <Label htmlFor={`add-price-${packId}`}>Price / piece (₹)</Label>
          <Input id={`add-price-${packId}`} name="pricePerPiece" type="number" min={0} step="0.01" required />
        </div>
        <div>
          <Label htmlFor={`add-label-${packId}`}>Label</Label>
          <Input id={`add-label-${packId}`} name="label" placeholder="Bulk discount" />
        </div>
        {addState?.error ? (
          <p role="alert" className="col-span-2 text-xs font-medium text-primary-700 sm:col-span-3">
            {addState.error}
          </p>
        ) : null}
        <div className="sm:col-span-1">
          <SubmitButton pendingLabel="Adding…">
            <Plus className="mr-1 h-3.5 w-3.5" /> Add rule
          </SubmitButton>
        </div>
      </form>
    </div>
  );
}
