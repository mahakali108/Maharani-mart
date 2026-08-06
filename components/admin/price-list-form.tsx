'use client';

import { useFormState } from 'react-dom';
import { useState } from 'react';
import { createPriceListAction, type PriceListFormState } from '@/lib/admin/pricing-actions';
import { Input } from '@/components/ui/input';
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

const initialState: PriceListFormState = null;

export function PriceListForm({
  products,
  areas,
  retailers,
}: {
  products: Option[];
  areas: Option[];
  retailers: RetailerOption[];
}) {
  const [state, formAction] = useFormState(createPriceListAction, initialState);
  const [scope, setScope] = useState<'base' | 'area' | 'retailer'>('base');

  return (
    <form action={formAction} className="space-y-4">
      {state?.error ? (
        <div className="rounded-xl border border-primary-200 bg-primary-50 px-4 py-3 text-sm text-primary-700">
          {state.error}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="productId">Product</Label>
          <Select id="productId" name="productId" required defaultValue="">
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
          <Label htmlFor="scope">Price scope</Label>
          <Select id="scope" name="scope" value={scope} onChange={(e) => setScope(e.target.value as typeof scope)}>
            <option value="base">Base (applies to everyone by default)</option>
            <option value="area">Area-specific</option>
            <option value="retailer">Retailer-specific</option>
          </Select>
        </div>

        {scope === 'area' ? (
          <div>
            <Label htmlFor="areaId">Area</Label>
            <Select id="areaId" name="areaId" required defaultValue="">
              <option value="" disabled>
                {areas.length ? 'Select an area' : 'No areas yet'}
              </option>
              {areas.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </div>
        ) : null}

        {scope === 'retailer' ? (
          <div>
            <Label htmlFor="retailerId">Retailer</Label>
            <Select id="retailerId" name="retailerId" required defaultValue="">
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
        ) : null}

        <div>
          <Label htmlFor="price">Price (₹)</Label>
          <Input id="price" name="price" type="number" min={0} step="0.01" required />
        </div>
        <div>
          <Label htmlFor="priority">Priority</Label>
          <Input id="priority" name="priority" type="number" step={1} defaultValue={0} />
          <p className="mt-1 text-xs text-ink-400">Higher priority wins when multiple prices of the same scope match.</p>
        </div>
      </div>

      <SubmitButton pendingLabel="Saving…">Add price</SubmitButton>
    </form>
  );
}
