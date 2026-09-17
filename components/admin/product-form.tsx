'use client';

import { useFormState } from 'react-dom';
import { AlertTriangle } from 'lucide-react';
import type { ProductFormState } from '@/lib/admin/products-actions';
import { GST_RATE_LABEL, VALID_GST_RATES } from '@/lib/admin/catalog-validation';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { SubmitButton } from '@/components/ui/submit-button';

interface Option {
  id: string;
  name: string;
}

interface ProductDefaults {
  name: string;
  brand_id: string | null;
  category_id: string | null;
  unit: string;
  units_per_case: number;
  base_price: number;
  cost_price: number | null;
  gst_percent: number;
  case_price: number | null;
  hsn_code: string | null;
  barcode: string | null;
  lead_time_days: number;
  is_new_launch: boolean;
  moq: number | null;
}

const initialState: ProductFormState = null;

/** One labelled input with its own validation message underneath. */
function Field({
  id,
  label,
  error,
  hint,
  className,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? (
        <p className="mt-1 flex items-start gap-1 text-xs font-medium text-rose-600" role="alert">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {error}
        </p>
      ) : hint ? (
        <p className="mt-1 text-xs text-ink-400">{hint}</p>
      ) : null}
    </div>
  );
}

/**
 * Add / Edit product form.
 *
 * Validation runs server-side in `validateProductDraft` and comes back as
 * per-field messages, so this component never re-implements a rule — it only
 * renders what the server decided. Inputs are uncontrolled with `defaultValue`,
 * which is what preserves exactly what the operator typed across a failed
 * submit: React does not reset an uncontrolled input when the action returns.
 */
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
  const errors = state?.errors ?? {};

  return (
    <form action={formAction} className="space-y-5">
      {state?.error ? (
        <div
          className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"
          role="alert"
        >
          {state.error}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Field id="name" label="Product name" error={errors.name} className="sm:col-span-2">
          <Input
            id="name"
            name="name"
            defaultValue={defaults?.name}
            placeholder="e.g. Tata Tea Gold 1kg"
            required
            maxLength={160}
          />
        </Field>

        <Field id="brandId" label="Brand" error={errors.brandId}>
          <Select id="brandId" name="brandId" defaultValue={defaults?.brand_id ?? ''} required={!defaults}>
            <option value="">— Select brand —</option>
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field id="categoryId" label="Category" error={errors.categoryId}>
          <Select id="categoryId" name="categoryId" defaultValue={defaults?.category_id ?? ''} required={!defaults}>
            <option value="">— Select category —</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field id="unit" label="Unit" error={errors.unit}>
          <Input id="unit" name="unit" defaultValue={defaults?.unit} placeholder="carton, box, pcs" required maxLength={24} />
        </Field>

        <Field
          id="unitsPerCase"
          label="Units per case"
          error={errors.unitsPerCase}
          hint="Pieces in one full case. The per-piece selling price is derived from the case price."
        >
          <Input
            id="unitsPerCase"
            name="unitsPerCase"
            type="number"
            min={1}
            step={1}
            defaultValue={defaults?.units_per_case ?? 1}
          />
        </Field>

        <Field
          id="basePrice"
          label="MRP (₹) per piece"
          error={errors.mrp}
          hint="Printed retail price, per piece. Used for the retailer's discount display."
        >
          <Input
            id="basePrice"
            name="basePrice"
            type="number"
            min={0}
            step="0.01"
            defaultValue={defaults?.base_price}
            placeholder="e.g. 100"
            required
          />
        </Field>

        <Field
          id="costPrice"
          label="Cost / purchase price (₹) per piece — admin only, hidden from retailers"
          error={errors.costPrice}
        >
          <Input
            id="costPrice"
            name="costPrice"
            type="number"
            min={0}
            step="0.01"
            defaultValue={defaults?.cost_price ?? ''}
            placeholder="e.g. 70"
          />
        </Field>

        <Field
          id="casePrice"
          label="Case selling price (₹) — GST inclusive"
          error={errors.casePrice}
          className="sm:col-span-2"
          hint={`Fixed price of one full case (${defaults?.units_per_case ?? 1} piece${
            defaults?.units_per_case === 1 ? '' : 's'
          }). The per-piece selling price is derived automatically.`}
        >
          <Input
            id="casePrice"
            name="casePrice"
            type="number"
            min={0}
            step="0.01"
            defaultValue={defaults?.case_price ?? ''}
            placeholder="e.g. 900"
            required
          />
        </Field>

        {errors.margin ? (
          <div
            className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 sm:col-span-2"
            role="alert"
          >
            {errors.margin}
          </div>
        ) : null}

        <Field
          id="gstPercent"
          label="GST %"
          error={errors.gstPercent}
          hint={`Statutory slabs only: ${GST_RATE_LABEL}. Pricing is GST-inclusive, so GST is never added again at checkout.`}
        >
          <Select id="gstPercent" name="gstPercent" defaultValue={String(defaults?.gst_percent ?? 0)}>
            {VALID_GST_RATES.map((rate) => (
              <option key={rate} value={rate}>
                {rate}%
              </option>
            ))}
          </Select>
        </Field>

        <Field
          id="hsnCode"
          label="HSN code"
          error={errors.hsnCode}
          hint="2, 4, 6 or 8 digits. Printed on the tax invoice — leave blank only if you do not have one."
        >
          <Input
            id="hsnCode"
            name="hsnCode"
            inputMode="numeric"
            defaultValue={defaults?.hsn_code ?? ''}
            placeholder="e.g. 09023010"
            maxLength={8}
          />
        </Field>

        <Field id="barcode" label="Barcode (EAN/UPC)" error={errors.barcode} hint="8, 12, 13 or 14 digits, check digit verified.">
          <Input
            id="barcode"
            name="barcode"
            inputMode="numeric"
            defaultValue={defaults?.barcode ?? ''}
            placeholder="Optional"
            maxLength={14}
          />
        </Field>

        <Field
          id="moq"
          label="Minimum order quantity (pieces)"
          error={errors.moq}
          hint="Applied to this product's variants. A retailer cannot order fewer pieces than this."
        >
          <Input id="moq" name="moq" type="number" min={1} step={1} defaultValue={defaults?.moq ?? 1} />
        </Field>

        <Field
          id="leadTimeDays"
          label="Lead time (days)"
          error={errors.leadTimeDays}
          hint="Used by low-stock prediction once orders exist."
        >
          <Input
            id="leadTimeDays"
            name="leadTimeDays"
            type="number"
            min={0}
            step={1}
            defaultValue={defaults?.lead_time_days ?? 2}
          />
        </Field>

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

      {/*
        Double-submission guard: SubmitButton reads useFormStatus(), so it is
        disabled for the whole duration of the action — a second click or an
        impatient Enter cannot create the product twice. That is the real
        guard; this form adds no local flag that could drift out of sync.
      */}
      <SubmitButton pendingLabel="Saving…">{submitLabel}</SubmitButton>
    </form>
  );
}
