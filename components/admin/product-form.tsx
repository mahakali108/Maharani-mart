'use client';

import { useFormState } from 'react-dom';
import type { ProductFormState } from '@/lib/admin/products-actions';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { SubmitButton } from '@/components/ui/submit-button';

interface Option {
  id: string;
  name: string;
}

interface ProductDefaults {
  sku_code: string;
  name: string;
  brand_id: string | null;
  category_id: string | null;
  unit: string;
  units_per_case: number;
  base_price: number;
  cost_price: number | null;
  gst_percent: number;
  hsn_code: string | null;
  barcode: string | null;
  lead_time_days: number;
  is_new_launch: boolean;
}

const initialState: ProductFormState = null;

export function ProductForm({
  action,
  brands,
  categories,
  defaults,
  submitLabel,
}: {
  action: (prevState: ProductFormState, formData: FormData) => Promise<ProductFormState>;
  brands: Option[];
  categories: Option[];
  defaults?: ProductDefaults;
  submitLabel: string;
}) {
  const [state, formAction] = useFormState(action, initialState);

  return (
    <form action={formAction} className="space-y-5">
      {state?.error ? (
        <div className="rounded-xl border border-primary-200 bg-primary-50 px-4 py-3 text-sm text-primary-700">
          {state.error}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div>
          <Label htmlFor="skuCode">SKU code</Label>
          <Input id="skuCode" name="skuCode" defaultValue={defaults?.sku_code} placeholder="e.g. MK-BEV-001" required />
        </div>
        <div>
          <Label htmlFor="name">Product name</Label>
          <Input id="name" name="name" defaultValue={defaults?.name} placeholder="e.g. Tata Tea Gold 1kg" required />
        </div>

        <div>
          <Label htmlFor="brandId">Brand</Label>
          <Select id="brandId" name="brandId" defaultValue={defaults?.brand_id ?? ''}>
            <option value="">— None —</option>
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="categoryId">Category</Label>
          <Select id="categoryId" name="categoryId" defaultValue={defaults?.category_id ?? ''}>
            <option value="">— None —</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <Label htmlFor="unit">Unit</Label>
          <Input id="unit" name="unit" defaultValue={defaults?.unit} placeholder="carton, box, pcs" required />
        </div>
        <div>
          <Label htmlFor="unitsPerCase">Units per case</Label>
          <Input
            id="unitsPerCase"
            name="unitsPerCase"
            type="number"
            min={1}
            step={1}
            defaultValue={defaults?.units_per_case ?? 1}
          />
        </div>

        <div>
          <Label htmlFor="basePrice">Base price (₹)</Label>
          <Input
            id="basePrice"
            name="basePrice"
            type="number"
            min={0}
            step="0.01"
            defaultValue={defaults?.base_price}
            required
          />
        </div>
        <div>
          <Label htmlFor="costPrice">Cost price (₹) — admin only, hidden from retailers</Label>
          <Input id="costPrice" name="costPrice" type="number" min={0} step="0.01" defaultValue={defaults?.cost_price ?? ''} />
        </div>

        <div>
          <Label htmlFor="gstPercent">GST %</Label>
          <Input
            id="gstPercent"
            name="gstPercent"
            type="number"
            min={0}
            max={100}
            step="0.01"
            defaultValue={defaults?.gst_percent ?? 0}
          />
        </div>
        <div>
          <Label htmlFor="hsnCode">HSN code</Label>
          <Input id="hsnCode" name="hsnCode" defaultValue={defaults?.hsn_code ?? ''} placeholder="Optional" />
        </div>

        <div>
          <Label htmlFor="barcode">Barcode (EAN/UPC)</Label>
          <Input id="barcode" name="barcode" defaultValue={defaults?.barcode ?? ''} placeholder="Optional" />
        </div>
        <div>
          <Label htmlFor="leadTimeDays">Lead time (days)</Label>
          <Input
            id="leadTimeDays"
            name="leadTimeDays"
            type="number"
            min={0}
            step={1}
            defaultValue={defaults?.lead_time_days ?? 2}
          />
          <p className="mt-1 text-xs text-ink-400">Used by low-stock prediction once orders exist.</p>
        </div>
        <div className="flex items-center gap-2 pt-6">
          <input
            id="isNewLaunch"
            name="isNewLaunch"
            type="checkbox"
            defaultChecked={defaults?.is_new_launch}
            className="h-4 w-4 rounded border-ink-300 text-primary-600 focus:ring-primary-600"
          />
          <Label htmlFor="isNewLaunch" className="mb-0">
            Mark as new launch
          </Label>
        </div>
      </div>

      <SubmitButton pendingLabel="Saving…">{submitLabel}</SubmitButton>
    </form>
  );
}
