import { ArrowLeftRight } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/admin/guard';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { AdminEmptyState } from '@/components/admin/empty-state';
import { InventoryNav } from '@/components/admin/inventory-nav';
import { TransferForm, type BatchOption } from '@/components/admin/transfer-form';
import { TransferActionButtons } from '@/components/admin/transfer-action-buttons';
import { StatusBadge } from '@/components/admin/status-badge';
import type { StockTransferRow } from '@/types/inventory.types';

interface TransferListRow extends StockTransferRow {
  source: { name: string } | null;
  destination: { name: string } | null;
  stock_transfer_items: { id: string; quantity: number; inventory_batches: { batch_number: string; products: { name: string } | null } | null }[];
}

export default async function TransfersPage() {
  await requirePermission('inventory.view');
  const supabase = createClient();

  const [{ data: transferData }, { data: warehouseData }, { data: batchData }] = await Promise.all([
    supabase
      .from('stock_transfers')
      .select(
        '*, source:warehouses!stock_transfers_source_warehouse_id_fkey ( name ), destination:warehouses!stock_transfers_destination_warehouse_id_fkey ( name ), stock_transfer_items ( id, quantity, inventory_batches ( batch_number, products ( name ) ) )'
      )
      .order('created_at', { ascending: false })
      .limit(50),
    supabase.from('warehouses').select('id, name').eq('is_active', true).order('name'),
    supabase
      .from('inventory_batches')
      .select('id, batch_number, warehouse_id, expiry_date, current_quantity, reserved_quantity, products ( name )')
      .gt('current_quantity', 0)
      .order('batch_number'),
  ]);

  const transfers = (transferData ?? []) as unknown as TransferListRow[];
  const warehouses = (warehouseData ?? []) as { id: string; name: string }[];
  const batches = ((batchData ?? []) as unknown as {
    id: string;
    batch_number: string;
    warehouse_id: string;
    expiry_date: string | null;
    current_quantity: number;
    reserved_quantity: number;
    products: { name: string } | null;
  }[]).map<BatchOption>((b) => ({
    id: b.id,
    batch_number: b.batch_number,
    product_name: b.products?.name ?? 'Unknown product',
    warehouse_id: b.warehouse_id,
    available: b.current_quantity - b.reserved_quantity,
    expiry_date: b.expiry_date,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-950">Warehouse Transfers</h1>
        <p className="mt-1 text-sm text-ink-500">
          Move batches between warehouses. Executing a transfer books paired TRANSFER_OUT / TRANSFER_IN movements
          under one reference and can never move more than available (non-reserved) stock.
        </p>
      </div>

      <InventoryNav />

      <Card>
        <CardHeader>
          <CardTitle>New transfer</CardTitle>
        </CardHeader>
        <TransferForm warehouses={warehouses} batches={batches} />
      </Card>

      {transfers.length === 0 ? (
        <AdminEmptyState
          icon={ArrowLeftRight}
          title="No transfers yet"
          body="Create a transfer above to move stock between warehouses."
        />
      ) : (
        <div className="space-y-4">
          {transfers.map((t) => (
            <Card key={t.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-mono font-medium text-ink-900">{t.transfer_number}</p>
                  <p className="mt-0.5 text-sm text-ink-600">
                    {t.source?.name ?? '—'} → {t.destination?.name ?? '—'} ·{' '}
                    {new Date(t.created_at).toLocaleString('en-IN')}
                  </p>
                  <ul className="mt-2 space-y-1 text-sm text-ink-600">
                    {t.stock_transfer_items.map((item) => (
                      <li key={item.id}>
                        <span className="font-mono text-xs text-ink-400">{item.inventory_batches?.batch_number}</span>{' '}
                        {item.inventory_batches?.products?.name ?? '—'} × {item.quantity}
                      </li>
                    ))}
                  </ul>
                  {t.notes ? <p className="mt-2 text-xs text-ink-400">{t.notes}</p> : null}
                </div>
                <div className="flex flex-col items-end gap-2">
                  <StatusBadge status={t.status} />
                  {t.status === 'pending' ? <TransferActionButtons transferId={t.id} /> : null}
                  {t.status === 'completed' && t.completed_at ? (
                    <p className="text-xs text-ink-400">Executed {new Date(t.completed_at).toLocaleString('en-IN')}</p>
                  ) : null}
                  {t.status === 'cancelled' && t.cancellation_reason ? (
                    <p className="text-xs text-ink-400">{t.cancellation_reason}</p>
                  ) : null}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
