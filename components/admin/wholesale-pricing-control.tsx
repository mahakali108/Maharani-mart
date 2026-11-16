'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ShieldCheck, Trash2 } from 'lucide-react';
import {
  deleteProductWholesaleLimitAction,
  deleteSellerPricingPermissionAction,
  updateGlobalWholesaleRulesAction,
  upsertProductWholesaleLimitAction,
  upsertSellerPricingPermissionAction,
} from '@/lib/admin/wholesale-pricing-actions';
import type { WholesalePricingOverview } from '@/lib/admin/wholesale-pricing-query';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { StatusBadge } from '@/components/admin/status-badge';

export function WholesalePricingControl({ overview }: { overview: WholesalePricingOverview }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const runAction = (fn: () => Promise<{ ok: true; message: string } | { ok: false; error: string }>) => {
    setFeedback(null);
    startTransition(async () => {
      const res = await fn();
      if (res.ok) {
        setFeedback({ kind: 'ok', text: res.message });
        router.refresh();
      } else {
        setFeedback({ kind: 'error', text: res.error });
      }
    });
  };

  return (
    <div className="space-y-6">
      {feedback ? (
        <div
          role={feedback.kind === 'error' ? 'alert' : 'status'}
          className={`rounded-xl border px-4 py-3 text-sm ${
            feedback.kind === 'error'
              ? 'border-error-200 bg-error-50 text-error-700'
              : 'border-mint-200 bg-mint-50 text-mint-700'
          }`}
        >
          {feedback.text}
        </div>
      ) : null}

      {/* 1. Global Wholesale Rules */}
      <Card className="p-5">
        <div className="flex items-start gap-2">
          <ShieldCheck className="mt-0.5 h-5 w-5 text-primary-700" aria-hidden />
          <div>
            <h2 className="text-base font-semibold text-ink-900">Global wholesale guardrails</h2>
            <p className="mt-0.5 text-xs text-ink-500">
              Enforced server-side by PostgreSQL triggers on seller offers, seller quantity slabs, and catalog pricing tiers. Sellers cannot bypass these caps.
            </p>
          </div>
        </div>

        <form
          className="mt-4 grid gap-4 sm:grid-cols-3"
          action={(formData) => runAction(() => updateGlobalWholesaleRulesAction(formData))}
        >
          <div>
            <Label htmlFor="defaultMinOrderQty">Default Minimum Order Qty (pcs)</Label>
            <Input
              id="defaultMinOrderQty"
              name="defaultMinOrderQty"
              type="number"
              min={1}
              max={100000}
              defaultValue={overview.globalRules.default_min_order_qty}
              required
            />
          </div>
          <div>
            <Label htmlFor="maxDiscountPercent">Global Max Discount Cap (%)</Label>
            <Input
              id="maxDiscountPercent"
              name="maxDiscountPercent"
              type="number"
              min={0}
              max={80}
              step="0.5"
              defaultValue={overview.globalRules.max_discount_percent}
              required
            />
          </div>
          <div>
            <Label htmlFor="minOrderValueRupees">Minimum Wholesale Order Value (₹)</Label>
            <Input
              id="minOrderValueRupees"
              name="minOrderValueRupees"
              type="number"
              min={0}
              step="1"
              defaultValue={Math.round(overview.globalRules.min_order_value_paise / 100)}
              required
            />
          </div>

          <div className="sm:col-span-3 flex flex-wrap gap-6 pt-1 text-sm text-ink-700">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                name="allowSellerCustomSlabs"
                defaultChecked={overview.globalRules.allow_seller_custom_slabs}
                className="h-4 w-4 rounded border-ink-300"
              />
              Allow seller quantity-based slabs
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                name="enforcePackFloor"
                defaultChecked={overview.globalRules.enforce_pack_floor}
                className="h-4 w-4 rounded border-ink-300"
              />
              Enforce pack price floor
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                name="allowSellerPriceOverride"
                defaultChecked={overview.globalRules.allow_seller_price_override}
                className="h-4 w-4 rounded border-ink-300"
              />
              Allow seller price overrides (subject to max discount cap)
            </label>
          </div>

          <div className="sm:col-span-3">
            <Label htmlFor="globalNotes">Policy notes</Label>
            <Input
              id="globalNotes"
              name="notes"
              maxLength={1000}
              defaultValue={overview.globalRules.notes ?? ''}
              placeholder="Document wholesale margin policy or seasonal rule changes…"
            />
          </div>

          <div className="sm:col-span-3">
            <Button type="submit" disabled={isPending}>
              Save global wholesale rules
            </Button>
          </div>
        </form>
      </Card>

      {/* 2. Seller-Specific Pricing Permissions */}
      <Card className="p-5">
        <h2 className="text-base font-semibold text-ink-900">Seller-specific pricing permissions</h2>
        <p className="mt-0.5 text-xs text-ink-500">
          Tighten discount caps, disable custom slabs, or enforce a higher MOQ for individual sellers. Cannot exceed the global discount cap ({overview.globalRules.max_discount_percent}%).
        </p>

        <form
          className="mt-4 grid gap-4 sm:grid-cols-4"
          action={(formData) => runAction(() => upsertSellerPricingPermissionAction(formData))}
        >
          <div className="sm:col-span-2">
            <Label htmlFor="sellerId">Seller</Label>
            <Select id="sellerId" name="sellerId" required defaultValue="">
              <option value="">— Select seller —</option>
              {overview.sellers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.business_name} ({s.status})
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="sellerMaxDiscount">Max Discount (%)</Label>
            <Input
              id="sellerMaxDiscount"
              name="maxDiscountPercent"
              type="number"
              min={0}
              max={overview.globalRules.max_discount_percent}
              step="0.5"
              defaultValue={Math.min(15, overview.globalRules.max_discount_percent)}
              required
            />
          </div>
          <div>
            <Label htmlFor="minMoqOverride">Min MOQ Override (opt.)</Label>
            <Input id="minMoqOverride" name="minMoqOverride" type="number" min={1} max={100000} placeholder="Global" />
          </div>
          <div className="sm:col-span-2 flex flex-wrap items-center gap-5 text-sm text-ink-700">
            <label className="flex items-center gap-2">
              <input type="checkbox" name="canSetCustomSlabs" defaultChecked className="h-4 w-4 rounded border-ink-300" />
              Can set custom slabs
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="canApplyDiscounts" defaultChecked className="h-4 w-4 rounded border-ink-300" />
              Can apply discounts
            </label>
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="sellerPermNotes">Notes</Label>
            <Input id="sellerPermNotes" name="notes" maxLength={500} placeholder="Optional governance reason" />
          </div>
          <div className="sm:col-span-4">
            <Button type="submit" size="sm" disabled={isPending || overview.sellers.length === 0}>
              Save seller pricing permission
            </Button>
          </div>
        </form>

        <div className="mt-5 border-t border-ink-100 pt-4">
          {overview.sellerPermissions.length === 0 ? (
            <p className="text-sm text-ink-500">
              No seller-specific overrides configured yet. All sellers currently inherit the global wholesale rules.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-ink-100 text-ink-500">
                    <th className="py-2 pr-3">Seller</th>
                    <th className="py-2 pr-3">Max Discount</th>
                    <th className="py-2 pr-3">Min MOQ</th>
                    <th className="py-2 pr-3">Slabs / Discounts</th>
                    <th className="py-2 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {overview.sellerPermissions.map((perm) => (
                    <tr key={perm.seller_id}>
                      <td className="py-2.5 pr-3 font-medium text-ink-900">
                        {perm.business_name}{' '}
                        <StatusBadge status={perm.seller_status} />
                      </td>
                      <td className="py-2.5 pr-3">{perm.max_discount_percent}%</td>
                      <td className="py-2.5 pr-3">{perm.min_moq_override ?? 'Global'}</td>
                      <td className="py-2.5 pr-3">
                        Slabs: {perm.can_set_custom_slabs ? 'Yes' : 'No'} · Discounts:{' '}
                        {perm.can_apply_discounts ? 'Yes' : 'No'}
                      </td>
                      <td className="py-2.5 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={isPending}
                          onClick={() => runAction(() => deleteSellerPricingPermissionAction(perm.seller_id))}
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden /> Reset
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Card>

      {/* 3. Product / Pack-Specific Wholesale Limits */}
      <Card className="p-5">
        <h2 className="text-base font-semibold text-ink-900">Product-specific wholesale limits</h2>
        <p className="mt-0.5 text-xs text-ink-500">
          Set stricter MOQ floors, discount ceilings, or slab restrictions for individual sellable packs.
        </p>

        <form
          className="mt-4 grid gap-4 sm:grid-cols-4"
          action={(formData) => runAction(() => upsertProductWholesaleLimitAction(formData))}
        >
          <div className="sm:col-span-2">
            <Label htmlFor="packId">Product Pack</Label>
            <Select id="packId" name="packId" required defaultValue="">
              <option value="">— Select pack —</option>
              {overview.packs.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label} (Base ₹{p.base_price.toFixed(2)})
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="packMinOrderQty">Min Order Qty (pcs)</Label>
            <Input id="packMinOrderQty" name="minOrderQty" type="number" min={1} max={100000} defaultValue={1} required />
          </div>
          <div>
            <Label htmlFor="packMaxDiscount">Max Discount (%)</Label>
            <Input
              id="packMaxDiscount"
              name="maxDiscountPercent"
              type="number"
              min={0}
              max={overview.globalRules.max_discount_percent}
              step="0.5"
              defaultValue={Math.min(15, overview.globalRules.max_discount_percent)}
              required
            />
          </div>
          <div className="sm:col-span-2 flex items-center gap-2 text-sm text-ink-700">
            <input type="checkbox" id="allowSellerSlabs" name="allowSellerSlabs" defaultChecked className="h-4 w-4 rounded border-ink-300" />
            <label htmlFor="allowSellerSlabs">Allow seller quantity slabs on this pack</label>
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="packLimitNotes">Notes</Label>
            <Input id="packLimitNotes" name="notes" maxLength={500} placeholder="Optional brand/margin policy note" />
          </div>
          <div className="sm:col-span-4">
            <Button type="submit" size="sm" disabled={isPending || overview.packs.length === 0}>
              Save product wholesale limit
            </Button>
          </div>
        </form>

        <div className="mt-5 border-t border-ink-100 pt-4">
          {overview.productLimits.length === 0 ? (
            <p className="text-sm text-ink-500">No product-specific wholesale limits configured yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-ink-100 text-ink-500">
                    <th className="py-2 pr-3">Product · Pack</th>
                    <th className="py-2 pr-3">Min MOQ</th>
                    <th className="py-2 pr-3">Max Discount</th>
                    <th className="py-2 pr-3">Seller Slabs</th>
                    <th className="py-2 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {overview.productLimits.map((lim) => (
                    <tr key={lim.pack_id}>
                      <td className="py-2.5 pr-3 font-medium text-ink-900">
                        {lim.product_name} · {lim.pack_name}
                      </td>
                      <td className="py-2.5 pr-3">{lim.min_order_qty} pcs</td>
                      <td className="py-2.5 pr-3">{lim.max_discount_percent}%</td>
                      <td className="py-2.5 pr-3">{lim.allow_seller_slabs ? 'Allowed' : 'Blocked'}</td>
                      <td className="py-2.5 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={isPending}
                          onClick={() => runAction(() => deleteProductWholesaleLimitAction(lim.pack_id))}
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden /> Reset
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
