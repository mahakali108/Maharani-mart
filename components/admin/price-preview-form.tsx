'use client';

import { useFormState } from 'react-dom';
import { previewEffectivePriceAction, type PricePreviewState } from '@/lib/admin/pricing-actions';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { SubmitButton } from '@/components/ui/submit-button';

interface Option {
  id: string;
  name: string;
}

interface RetailerOption {
  id: string;
  shop_name: string;
}

const initialState: PricePreviewState = null;

export function PricePreviewForm({ products, retailers }: { products: Option[]; retailers: RetailerOption[] }) {
  const [state, formAction] = useFormState(previewEffectivePriceAction, initialState);

  return (
    <form action={formAction} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="previewProductId">Product</Label>
          <Select id="previewProductId" name="productId" required defaultValue="">
            <option value="" disabled>
              {products.length ? 'Select a product' : 'No products yet'}
            </option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="previewRetailerId">Retailer</Label>
          <Select id="previewRetailerId" name="retailerId" required defaultValue="">
            <option value="" disabled>
              {retailers.length ? 'Select a retailer' : 'No active retailers yet'}
            </option>
            {retailers.map((r) => (
              <option key={r.id} value={r.id}>
                {r.shop_name}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <SubmitButton pendingLabel="Calculating…">Preview effective price</SubmitButton>

      {state?.error ? (
        <div className="rounded-xl border border-primary-200 bg-primary-50 px-4 py-3 text-sm text-primary-700">
          {state.error}
        </div>
      ) : null}
      {state?.price !== null && state?.price !== undefined ? (
        <div className="rounded-xl border border-green-100 bg-green-50 px-4 py-3 text-sm text-green-800">
          Effective price: <span className="text-lg font-semibold">₹{state.price.toFixed(2)}</span>
        </div>
      ) : null}
    </form>
  );
}
