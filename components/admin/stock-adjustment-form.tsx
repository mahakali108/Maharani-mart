'use client';

import { useFormState } from 'react-dom';
import { createStockAdjustmentAction, type StockAdjustmentFormState } from '@/lib/admin/inventory-actions';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { SubmitButton } from '@/components/ui/submit-button';

interface Option {
  id: string;
  name: string;
}

const initialState: StockAdjustmentFormState = null;

export function StockAdjustmentForm({ products, warehouses }: { products: Option[]; warehouses: Option[] }) {
  const [state, formAction] = useFormState(createStockAdjustmentAction, initialState);

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
          <Label htmlFor="warehouseId">Warehouse</Label>
          <Select id="warehouseId" name="warehouseId" required defaultValue="">
            <option value="" disabled>
              {warehouses.length ? 'Select a warehouse' : 'No warehouses yet'}
            </option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="quantity">Quantity change</Label>
          <Input id="quantity" name="quantity" type="number" step={1} placeholder="e.g. 50 or -12" required />
          <p className="mt-1 text-xs text-ink-400">Positive to add stock, negative to remove (e.g. after a physical count).</p>
        </div>
        <div>
          <Label htmlFor="reason">Reason</Label>
          <Input id="reason" name="reason" placeholder="e.g. Physical count correction" required />
        </div>
      </div>

      <SubmitButton pendingLabel="Recording…">Record adjustment</SubmitButton>
    </form>
  );
}
