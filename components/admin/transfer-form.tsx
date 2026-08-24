'use client';

import { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { createTransferAction, type TransferActionResult } from '@/lib/admin/transfer-actions';
import { useFormState } from 'react-dom';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { SubmitButton } from '@/components/ui/submit-button';

interface WarehouseOption {
  id: string;
  name: string;
}

export interface BatchOption {
  id: string;
  batch_number: string;
  product_name: string;
  warehouse_id: string;
  available: number;
  expiry_date: string | null;
}

interface TransferLine {
  key: number;
  batchId: string;
  quantity: string;
}

const initialState: TransferActionResult = null;

let lineKey = 0;
function newLine(): TransferLine {
  lineKey += 1;
  return { key: lineKey, batchId: '', quantity: '' };
}

/**
 * Inter-warehouse transfer builder. Only batches in the selected SOURCE
 * warehouse are offered; the execute_stock_transfer RPC re-validates
 * availability atomically at execution time, so a transfer can never move
 * more than is actually available (or touch reserved stock).
 */
export function TransferForm({ warehouses, batches }: { warehouses: WarehouseOption[]; batches: BatchOption[] }) {
  const [state, formAction] = useFormState(createTransferAction, initialState);
  const [sourceId, setSourceId] = useState('');
  const [destinationId, setDestinationId] = useState('');
  const [lines, setLines] = useState<TransferLine[]>([newLine()]);

  const sourceBatches = useMemo(
    () => batches.filter((b) => b.warehouse_id === sourceId && b.available > 0),
    [batches, sourceId]
  );

  function updateLine(key: number, patch: Partial<TransferLine>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  const serialized = JSON.stringify(
    lines.filter((l) => l.batchId).map((l) => ({ batchId: l.batchId, quantity: l.quantity }))
  );

  return (
    <form action={formAction} className="space-y-5">
      {state?.error ? (
        <div className="rounded-xl border border-primary-200 bg-primary-50 px-4 py-3 text-sm text-primary-700">{state.error}</div>
      ) : null}
      {state?.success && state.transferId ? (
        <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
          Transfer created as PENDING — execute it from the transfers list when the stock physically moves.
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <Label htmlFor="sourceWarehouseId">From warehouse</Label>
          <Select
            id="sourceWarehouseId"
            name="sourceWarehouseId"
            required
            value={sourceId}
            onChange={(e) => {
              setSourceId(e.target.value);
              setLines([newLine()]);
            }}
          >
            <option value="" disabled>Select source</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="destinationWarehouseId">To warehouse</Label>
          <Select
            id="destinationWarehouseId"
            name="destinationWarehouseId"
            required
            value={destinationId}
            onChange={(e) => setDestinationId(e.target.value)}
          >
            <option value="" disabled>Select destination</option>
            {warehouses
              .filter((w) => w.id !== sourceId)
              .map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="notes">Notes (optional)</Label>
          <Input id="notes" name="notes" placeholder="Reason for transfer…" />
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-ink-800">Batch lines</h3>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!sourceId}
            onClick={() => setLines((prev) => [...prev, newLine()])}
          >
            <Plus className="h-4 w-4" /> Add line
          </Button>
        </div>

        {!sourceId ? (
          <p className="text-sm text-ink-400">Choose the source warehouse to pick batches.</p>
        ) : sourceBatches.length === 0 ? (
          <p className="text-sm text-ink-400">No batches with available stock in this warehouse.</p>
        ) : (
          <div className="space-y-3">
            {lines.map((line, idx) => (
              <div key={line.key} className="grid grid-cols-1 gap-3 rounded-xl border border-ink-100 bg-ink-50/40 p-4 sm:grid-cols-[1fr_160px_40px]">
                <div>
                  <Label>Batch</Label>
                  <Select required value={line.batchId} onChange={(e) => updateLine(line.key, { batchId: e.target.value })}>
                    <option value="" disabled>Select batch</option>
                    {sourceBatches.map((b) => (
                      <option key={b.id} value={b.id} disabled={lines.some((l) => l.key !== line.key && l.batchId === b.id)}>
                        {b.product_name} · {b.batch_number} · {b.available} available
                        {b.expiry_date ? ` · exp ${b.expiry_date}` : ''}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label>Quantity</Label>
                  <Input
                    required
                    type="number"
                    min={1}
                    step={1}
                    value={line.quantity}
                    onChange={(e) => updateLine(line.key, { quantity: e.target.value })}
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
            ))}
          </div>
        )}
      </div>

      <input type="hidden" name="lines" value={serialized} />

      <div className="flex items-center gap-3">
        <SubmitButton className="w-auto">Create transfer</SubmitButton>
        <p className="text-xs text-ink-400">
          Stock moves only when the transfer is executed. Both TRANSFER_OUT and TRANSFER_IN are recorded with one
          shared reference.
        </p>
      </div>
    </form>
  );
}
