import { CalendarClock } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { AdminEmptyState } from '@/components/admin/empty-state';
import { InventoryNav } from '@/components/admin/inventory-nav';
import { InventorySettingsForm } from '@/components/admin/inventory-settings-form';
import { BatchLossForm } from '@/components/admin/batch-loss-form';
import type { ExpiryReportViewRow, InventorySettingsRow } from '@/types/inventory.types';

const BUCKETS: { key: 'expired' | 'critical' | 'warning' | 'healthy'; label: string; dot: string; card: string }[] = [
  { key: 'expired', label: 'Expired', dot: '🔴', card: 'border-primary-200 bg-primary-50/40' },
  { key: 'critical', label: 'Expiring soon', dot: '🟠', card: 'border-orange-200 bg-orange-50/40' },
  { key: 'warning', label: 'Expiring', dot: '🟡', card: 'border-amber-200 bg-amber-50/40' },
  { key: 'healthy', label: 'Healthy', dot: '🟢', card: '' },
];

export default async function InventoryExpiryPage({
  searchParams,
}: {
  searchParams: { bucket?: string; warehouse?: string };
}) {
  const supabase = createClient();

  const [{ data: expiryData }, { data: settingsData }, { data: warehouseData }] = await Promise.all([
    supabase.from('inventory_expiry_report').select('*').order('expiry_date', { ascending: true, nullsFirst: false }),
    supabase.from('inventory_settings').select('*').maybeSingle(),
    supabase.from('warehouses').select('id, name').eq('is_active', true).order('name'),
  ]);

  const settings = (settingsData ?? { expiry_critical_days: 7, expiry_warning_days: 30, low_stock_alert_cooldown_hours: 24 }) as unknown as InventorySettingsRow;
  const warehouses = (warehouseData ?? []) as { id: string; name: string }[];
  let rows = (expiryData ?? []) as unknown as ExpiryReportViewRow[];

  const bucketFilter = searchParams.bucket ?? '';
  const warehouseFilter = searchParams.warehouse ?? '';
  if (bucketFilter) rows = rows.filter((r) => r.expiry_status === bucketFilter);
  if (warehouseFilter) rows = rows.filter((r) => r.warehouse_id === warehouseFilter);

  const all = (expiryData ?? []) as unknown as ExpiryReportViewRow[];
  const counts = {
    expired: all.filter((r) => r.expiry_status === 'expired').length,
    critical: all.filter((r) => r.expiry_status === 'critical').length,
    warning: all.filter((r) => r.expiry_status === 'warning').length,
    healthy: all.filter((r) => r.expiry_status === 'healthy').length,
  };
  const atRiskValue = all
    .filter((r) => r.expiry_status === 'expired' || r.expiry_status === 'critical' || r.expiry_status === 'warning')
    .reduce((sum, r) => sum + Number(r.estimated_value ?? 0), 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-950">Expiry Management</h1>
        <p className="mt-1 text-sm text-ink-500">
          Expired batches are never allocated by FEFO. Critical window ≤ {settings.expiry_critical_days} days,
          warning window ≤ {settings.expiry_warning_days} days. Stock at risk: ₹
          {atRiskValue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}.
        </p>
      </div>

      <InventoryNav />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {BUCKETS.map((b) => (
          <a key={b.key} href={`/admin/inventory/expiry?bucket=${b.key}&warehouse=${warehouseFilter}`}>
            <Card className={`h-full ${b.card}`}>
              <p className="text-sm text-ink-500">{b.dot} {b.label}</p>
              <p className="mt-1 text-2xl font-semibold text-ink-950">{counts[b.key]}</p>
            </Card>
          </a>
        ))}
      </div>

      <Card>
        <form method="get" className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="bucket" value={bucketFilter} />
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-500">Warehouse</label>
            <select name="warehouse" defaultValue={warehouseFilter} className="h-11 w-48 rounded-xl border border-ink-200 bg-white px-3 text-sm">
              <option value="">All warehouses</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          </div>
          <button type="submit" className="h-11 rounded-xl border border-ink-200 bg-white px-4 text-sm font-medium text-ink-900 hover:bg-ink-50">
            Filter
          </button>
          <a href="/admin/inventory/expiry" className="h-11 rounded-xl px-3 py-2.5 text-sm text-ink-500 hover:bg-ink-50">
            Reset
          </a>
        </form>
      </Card>

      {rows.length === 0 ? (
        <AdminEmptyState
          icon={CalendarClock}
          title="No batches in this view"
          body="Batches with stock appear here bucketed by expiry urgency."
        />
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[1000px] text-sm">
            <thead className="border-b border-ink-100 bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-5 py-3 font-medium">Product</th>
                <th className="px-5 py-3 font-medium">Batch</th>
                <th className="px-5 py-3 font-medium">Warehouse</th>
                <th className="px-5 py-3 text-right font-medium">Qty</th>
                <th className="px-5 py-3 font-medium">Expiry</th>
                <th className="px-5 py-3 text-right font-medium">Days left</th>
                <th className="px-5 py-3 text-right font-medium">Est. value</th>
                <th className="px-5 py-3 font-medium">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {rows.map((r) => {
                const bucket = BUCKETS.find((b) => b.key === r.expiry_status)!;
                const available = r.available_quantity;
                return (
                  <tr key={r.batch_id}>
                    <td className="px-5 py-3 font-medium text-ink-900">{r.product_name}</td>
                    <td className="px-5 py-3 font-mono text-xs text-ink-500">{r.batch_number}</td>
                    <td className="px-5 py-3 text-ink-600">{r.warehouse_name}</td>
                    <td className="px-5 py-3 text-right font-medium text-ink-900">{r.current_quantity}</td>
                    <td className="px-5 py-3 text-ink-600">{r.expiry_date ?? 'No expiry'}</td>
                    <td className="px-5 py-3 text-right">
                      {r.days_remaining === null ? (
                        <span className="text-ink-400">—</span>
                      ) : (
                        <span className={r.days_remaining < 0 ? 'font-semibold text-primary-600' : r.days_remaining <= settings.expiry_critical_days ? 'font-semibold text-orange-600' : 'text-ink-600'}>
                          {r.days_remaining < 0 ? `${-r.days_remaining}d overdue` : `${r.days_remaining}d`}
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right text-ink-600">
                      ₹{Number(r.estimated_value).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                    </td>
                    <td className="px-5 py-3">
                      {available > 0 && r.expiry_status !== 'healthy' ? (
                        <BatchLossForm batchId={r.batch_id} lossType="expiry" maxQuantity={available} />
                      ) : (
                        <span className="text-xs text-ink-400">{bucket.dot} {bucket.label}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Expiry windows & alert settings</CardTitle>
        </CardHeader>
        <p className="mb-3 text-xs text-ink-400">Admins only. The cooldown limits how often low-stock notifications repeat for the same product.</p>
        <InventorySettingsForm
          expiryCriticalDays={settings.expiry_critical_days}
          expiryWarningDays={settings.expiry_warning_days}
          cooldownHours={settings.low_stock_alert_cooldown_hours}
        />
      </Card>
    </div>
  );
}
