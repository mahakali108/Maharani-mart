'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useFormState } from 'react-dom';
import { Plus, Trash2 } from 'lucide-react';
import { createGrnAction, type GrnActionResult } from '@/lib/admin/grn-actions';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { SubmitButton } from '@/components/ui/submit-button';

interface Option {
  id: string;
  name: string;
}

interface ProductOption extends Option {
  sku_code: string;
}

interface GrnLine {
  key: number;
  productId: string;
  batchNumber: string;
  manufacturingDate: string;
  expiryDate: string;
  receivedQuantity: string;
  unitCost: string;
}

const initialState: GrnActionResult = null;

let lineKey = 0;
function newLine(): GrnLine {
  lineKey += 1;
  return { key: lineKey, productId: '', batchNumber: '', manufacturingDate: '', expiryDate: '', receivedQuantity: '', unitCost: '' };
}

/**
 * GRN builder. Lines are serialised to a hidden `lines` field and
 * re-validated entirely server-side (lib/admin/grn-actions.ts) —
 * the browser never decides quantities that reach the database
 * without passing the zod schema + confirm_grn RPC checks.
 */
export function GrnForm({ products, warehouses }: { products: ProductOption[]; warehouses: Option[] }) {
  const router = useRouter();
  const [state, formAction] = useFormState(createGrnAction, initialState);
  const [lines, setLines] = useState<GrnLine[]>([newLine()]);

  useEffect(() => {
    if (state?.success && state.grnId) {
      router.push(`/admin/inventory/grn/${state.grnId}`);
    }
  }, [state, router]);

  function updateLine(key: number, patch: Partial<GrnLine>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  const serialized = JSON.stringify(
    lines.map((l) => ({
      productId: l.productId,
      batchNumber: l.batchNumber,
      manufacturingDate: l.manufacturingDate,
      expiryDate: l.expiryDate,
      receivedQuantity: l.receivedQuantity,
      unitCost: l.unitCost === '' ? '' : Number(l.unitCost),
    }))
  );

  return (
    <form action={formAction} className="space-y-5">
      {state?.error ? (
        <div className="rounded-xl border border-primary-200 bg-primary-50 px-4 py-3 text-sm text-primary-700">{state.error}</div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="warehouseId">Receiving warehouse</Label>
          <Select id="warehouseId" name="warehouseId" required defaultValue="">
            <option value="" disabled>{warehouses.length ? 'Select warehouse' : 'No active warehouses'}</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="supplierReference">Supplier reference (optional)</Label>
          <Input id="supplierReference" name="supplierReference" placeholder="Supplier name / party" />
        </div>
        <div>
          <Label htmlFor="invoiceReference">Invoice reference (optional)</Label>
          <Input id="invoiceReference" name="invoiceReference" placeholder="Supplier invoice #" />
        </div>
        <div>
          <Label htmlFor="notes">Notes (optional)</Label>
          <Input id="notes" name="notes" placeholder="Vehicle, remarks…" />
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-ink-800">Product lines</h3>
          <Button type="button" size="sm" variant="outline" onClick={() => setLines((prev) => [...prev, newLine()])}>
            <Plus className="h-4 w-4" /> Add line
          </Button>
        </div>

        <div className="space-y-3">
          {lines.map((line, idx) => (
            <div key={line.key} className="rounded-xl border border-ink-100 bg-ink-50/40 p-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
                <div className="lg:col-span-2">
                  <Label>Product</Label>
                  <Select
                    required
                    value={line.productId}
                    onChange={(e) => updateLine(line.key, { productId: e.target.value })}
                  >
                    <option value="" disabled>Select product</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>{p.name} ({p.sku_code})</option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label>Batch number</Label>
                  <Input
                    required
                    value={line.batchNumber}
                    onChange={(e) => updateLine(line.key, { batchNumber: e.target.value })}
                    placeholder="e.g. B001"
                  />
                </div>
                <div>
                  <Label>Received qty</Label>
                  <Input
                    required
                    type="number"
                    min={1}
                    step={1}
                    value={line.receivedQuantity}
                    onChange={(e) => updateLine(line.key, { receivedQuantity: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Mfg. date</Label>
                  <Input
                    type="date"
                    value={line.manufacturingDate}
                    onChange={(e) => updateLine(line.key, { manufacturingDate: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Expiry date</Label>
                  <Input
                    type="date"
                    value={line.expiryDate}
                    onChange={(e) => updateLine(line.key, { expiryDate: e.target.value })}
                  />
                </div>
                <div className="lg:col-span-5">
                  <Label>Unit purchase cost (₹, optional)</Label>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={line.unitCost}
                    onChange={(e) => updateLine(line.key, { unitCost: e.target.value })}
                    placeholder="Used for stock valuation"
                  />
                </div>
                <div className="flex items-end">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={lines.length === 1}
                    onClick={() => setLines((prev) => prev.filter((l) => l.key !== line.key))}
                    aria-label={`Remove line ${idx + 1}`}
                  >
                    <Trash2 className="h-4 w-4 text-primary-600" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <input type="hidden" name="lines" value={serialized} />

      <div className="flex items-center gap-3">
        <SubmitButton className="w-auto">Save GRN draft</SubmitButton>
        <p className="text-xs text-ink-400">
          Stock is added only when the GRN is confirmed — review the lines on the next screen.
        </p>
      </div>
    </form>
  );
}
