'use client';

import { useState, useTransition } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import {
  createCouponAction,
  updateCouponAction,
  type CouponActionResult,
  type CouponFormInput,
} from '@/lib/admin/coupons-actions';

export interface Option {
  id: string;
  label: string;
}

export interface CouponInitial {
  id?: string;
  code: string;
  title: string;
  description: string;
  discountType: 'percentage' | 'fixed';
  discountValue: string;
  minimumOrderValue: string;
  maximumDiscount: string;
  usageLimit: string;
  perRetailerLimit: string;
  startsAt: string;
  expiresAt: string;
  isActive: boolean;
  firstOrderOnly: boolean;
  retailerId: string;
  categoryId: string;
  brandId: string;
  productId: string;
}

/**
 * Create or edit a coupon (0051). The form only collects intent; every value
 * is re-validated server-side in lib/admin/coupons-actions.ts before the row
 * is written, and the discount a retailer will actually receive is computed
 * exclusively by the coupon validator at cart/checkout time.
 */
export function CouponForm({
  initial,
  retailers,
  categories,
  brands,
  products,
}: {
  initial?: CouponInitial;
  retailers: Option[];
  categories: Option[];
  brands: Option[];
  products: Option[];
}) {
  const isEdit = Boolean(initial?.id);
  const [code, setCode] = useState(initial?.code ?? '');
  const [title, setTitle] = useState(initial?.title ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [discountType, setDiscountType] = useState<'percentage' | 'fixed'>(initial?.discountType ?? 'percentage');
  const [discountValue, setDiscountValue] = useState(initial?.discountValue ?? '');
  const [minimumOrderValue, setMinimumOrderValue] = useState(initial?.minimumOrderValue ?? '0');
  const [maximumDiscount, setMaximumDiscount] = useState(initial?.maximumDiscount ?? '');
  const [usageLimit, setUsageLimit] = useState(initial?.usageLimit ?? '');
  const [perRetailerLimit, setPerRetailerLimit] = useState(initial?.perRetailerLimit ?? '1');
  const [startsAt, setStartsAt] = useState(initial?.startsAt ?? '');
  const [expiresAt, setExpiresAt] = useState(initial?.expiresAt ?? '');
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);
  const [firstOrderOnly, setFirstOrderOnly] = useState(initial?.firstOrderOnly ?? false);
  const [retailerId, setRetailerId] = useState(initial?.retailerId ?? '');
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? '');
  const [brandId, setBrandId] = useState(initial?.brandId ?? '');
  const [productId, setProductId] = useState(initial?.productId ?? '');
  const [result, setResult] = useState<CouponActionResult | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit() {
    setResult(null);
    const payload: CouponFormInput = {
      code: code.trim().toUpperCase(),
      title,
      description: description || undefined,
      discountType,
      discountValue: Number(discountValue),
      minimumOrderValue: Number(minimumOrderValue || '0'),
      maximumDiscount: maximumDiscount === '' ? null : Number(maximumDiscount),
      usageLimit: usageLimit === '' ? null : Number(usageLimit),
      perRetailerLimit: Number(perRetailerLimit || '1'),
      startsAt,
      expiresAt,
      isActive,
      firstOrderOnly,
      retailerId,
      categoryId,
      brandId,
      productId,
    };
    startTransition(async () => {
      const outcome = isEdit && initial?.id ? await updateCouponAction(initial.id, payload) : await createCouponAction(payload);
      setResult(outcome);
      if ('success' in outcome && !isEdit) {
        setCode('');
        setTitle('');
        setDescription('');
        setDiscountType('percentage');
        setDiscountValue('');
        setMinimumOrderValue('0');
        setMaximumDiscount('');
        setUsageLimit('');
        setPerRetailerLimit('1');
        setStartsAt('');
        setExpiresAt('');
        setIsActive(true);
        setFirstOrderOnly(false);
        setRetailerId('');
        setCategoryId('');
        setBrandId('');
        setProductId('');
      }
    });
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="space-y-5"
    >
      {result && 'error' in result && result.error ? (
        <div className="rounded-xl border border-primary-200 bg-primary-50 px-4 py-3 text-sm text-primary-700">{result.error}</div>
      ) : null}
      {result && 'success' in result ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {isEdit ? 'Coupon updated.' : 'Coupon created — it is live the moment the start time is reached.'}
        </div>
      ) : null}

      <fieldset className="space-y-4 rounded-xl border border-ink-100 p-4">
        <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-ink-500">Code</legend>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <Label htmlFor="coupon-code">Code</Label>
            <Input
              id="coupon-code"
              type="text"
              maxLength={40}
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              disabled={isPending}
              placeholder="DIWALI10"
              required
            />
            <p className="mt-1 text-xs text-ink-400">Uppercase letters, numbers and hyphens. Retailers can enter any case.</p>
          </div>
          <div>
            <Label htmlFor="coupon-title">Internal name</Label>
            <Input id="coupon-title" type="text" maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} disabled={isPending} required />
          </div>
          <div>
            <Label htmlFor="coupon-description">Note (optional)</Label>
            <Input id="coupon-description" type="text" maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} disabled={isPending} />
          </div>
        </div>
      </fieldset>

      <fieldset className="space-y-4 rounded-xl border border-ink-100 p-4">
        <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-ink-500">Discount</legend>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <Label htmlFor="coupon-type">Type</Label>
            <Select id="coupon-type" value={discountType} onChange={(e) => setDiscountType(e.target.value as 'percentage' | 'fixed')} disabled={isPending}>
              <option value="percentage">Percentage (%)</option>
              <option value="fixed">Fixed amount (₹)</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="coupon-value">{discountType === 'percentage' ? 'Percent off' : 'Amount off (₹)'}</Label>
            <Input
              id="coupon-value"
              type="number"
              min="0"
              step="0.01"
              value={discountValue}
              onChange={(e) => setDiscountValue(e.target.value)}
              disabled={isPending}
              required
            />
          </div>
          {discountType === 'percentage' ? (
            <div>
              <Label htmlFor="coupon-max">Max discount cap (₹, optional)</Label>
              <Input
                id="coupon-max"
                type="number"
                min="0"
                step="0.01"
                value={maximumDiscount}
                onChange={(e) => setMaximumDiscount(e.target.value)}
                disabled={isPending}
                placeholder="e.g. 500"
              />
              <p className="mt-1 text-xs text-ink-400">Caps the percentage so big carts do not over-discount.</p>
            </div>
          ) : (
            <div className="hidden sm:block" aria-hidden="true" />
          )}
          <div>
            <Label htmlFor="coupon-min-order">Minimum order value (₹)</Label>
            <Input
              id="coupon-min-order"
              type="number"
              min="0"
              step="0.01"
              value={minimumOrderValue}
              onChange={(e) => setMinimumOrderValue(e.target.value)}
              disabled={isPending}
            />
            <p className="mt-1 text-xs text-ink-400">Checked against the pre-GST cart subtotal.</p>
          </div>
        </div>
      </fieldset>

      <fieldset className="space-y-4 rounded-xl border border-ink-100 p-4">
        <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-ink-500">Limits</legend>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <Label htmlFor="coupon-usage-limit">Total uses (blank = unlimited)</Label>
            <Input id="coupon-usage-limit" type="number" min="1" step="1" value={usageLimit} onChange={(e) => setUsageLimit(e.target.value)} disabled={isPending} />
          </div>
          <div>
            <Label htmlFor="coupon-retailer-limit">Uses per retailer</Label>
            <Input id="coupon-retailer-limit" type="number" min="1" step="1" value={perRetailerLimit} onChange={(e) => setPerRetailerLimit(e.target.value)} disabled={isPending} required />
          </div>
          <div>
            <Label htmlFor="coupon-first-order">First order only</Label>
            <label className="flex h-10 items-center gap-2 text-sm text-ink-700">
              <input
                id="coupon-first-order"
                type="checkbox"
                checked={firstOrderOnly}
                onChange={(e) => setFirstOrderOnly(e.target.checked)}
                disabled={isPending}
                className="h-4 w-4 rounded border-ink-300 text-primary-600 focus:ring-primary-600"
              />
              Valid on the retailer&rsquo;s first order
            </label>
          </div>
        </div>
      </fieldset>

      <fieldset className="space-y-4 rounded-xl border border-ink-100 p-4">
        <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-ink-500">Availability</legend>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <Label htmlFor="coupon-starts">Starts at</Label>
            <Input id="coupon-starts" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} disabled={isPending} required />
          </div>
          <div>
            <Label htmlFor="coupon-expires">Expires at</Label>
            <Input id="coupon-expires" type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} disabled={isPending} required />
          </div>
          <div>
            <Label htmlFor="coupon-active">Status</Label>
            <label className="flex h-10 items-center gap-2 text-sm text-ink-700">
              <input
                id="coupon-active"
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                disabled={isPending}
                className="h-4 w-4 rounded border-ink-300 text-primary-600 focus:ring-primary-600"
              />
              Active
            </label>
          </div>
        </div>
      </fieldset>

      <fieldset className="space-y-4 rounded-xl border border-ink-100 p-4">
        <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-ink-500">
          Eligibility (leave blank to apply to the whole cart)
        </legend>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="coupon-retailer">Specific retailer</Label>
            <Select id="coupon-retailer" value={retailerId} onChange={(e) => setRetailerId(e.target.value)} disabled={isPending}>
              <option value="">All retailers</option>
              {retailers.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="coupon-category">Category</Label>
            <Select id="coupon-category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} disabled={isPending}>
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="coupon-brand">Brand</Label>
            <Select id="coupon-brand" value={brandId} onChange={(e) => setBrandId(e.target.value)} disabled={isPending}>
              <option value="">All brands</option>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="coupon-product">Product</Label>
            <Select id="coupon-product" value={productId} onChange={(e) => setProductId(e.target.value)} disabled={isPending}>
              <option value="">All products</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </Select>
            <p className="mt-1 text-xs text-ink-400">Scopes combine: a brand + product coupon applies only to that product.</p>
          </div>
        </div>
      </fieldset>

      <Button type="submit" disabled={isPending}>
        {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        {isEdit ? 'Save changes' : 'Create coupon'}
      </Button>
    </form>
  );
}
