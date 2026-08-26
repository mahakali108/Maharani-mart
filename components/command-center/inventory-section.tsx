import Link from 'next/link';
import { Boxes, CalendarClock, PackageX, TrendingDown, TrendingUp, Warehouse } from 'lucide-react';
import type { InventoryIntel } from '@/lib/admin/command-center/types';
import { Card } from '@/components/ui/card';
import { TopBars } from './charts';
import { dateOnly, DataTable, inr, inrExact, LinkPill, Section, SectionEmptyState, TagPill, Td } from './shared';

function riskTone(risk: string): 'bad' | 'warn' | 'default' {
  if (risk === 'critical' || risk === 'out_of_stock') return 'bad';
  if (risk === 'high' || risk === 'medium' || risk === 'warning' || risk === 'low_stock') return 'warn';
  return 'default';
}

/**
 * Inventory Intelligence — reads the existing authorized inventory views
 * (inventory_product_totals, inventory_expiry_report) and the existing
 * demand-forecast pipeline. No inventory rules are reimplemented here.
 */
export function InventorySection({ intel }: { intel: InventoryIntel }) {
  const hasStock = intel.onHandProducts > 0;
  return (
    <Section
      title="Inventory intelligence"
      subtitle="Existing inventory views + the demand-forecast engine. Estimation rows are labelled as estimates."
      icon={Warehouse}
      status={intel.status}
      actions={
        <div className="flex flex-wrap gap-2">
          <LinkPill href="/admin/inventory/forecast">Forecast dashboard</LinkPill>
          <LinkPill href="/admin/inventory/low-stock">Low stock</LinkPill>
          <LinkPill href="/admin/inventory/expiry">Expiry report</LinkPill>
          <LinkPill href="/admin/inventory/grn/new">New GRN</LinkPill>
        </div>
      }
    >
      {!hasStock ? (
        <SectionEmptyState
          title="No stock recorded yet"
          body="Inventory intelligence activates once stock exists — add products, create a GRN or record an inward movement through the existing inventory workflows."
        />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Card className="p-4">
              <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink-400">
                <Boxes className="h-3.5 w-3.5" /> Inventory value
              </div>
              <p className="mt-1.5 text-base font-bold text-ink-950">{inr(intel.inventoryValue)}</p>
              <p className="text-[10px] text-ink-400">{intel.onHandProducts} product(s) on hand · batch-cost basis where recorded</p>
            </Card>
            <Card className="p-4">
              <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink-400">
                <PackageX className="h-3.5 w-3.5" /> Low / out of stock
              </div>
              <p className="mt-1.5 text-base font-bold text-ink-950">{intel.lowStock.length}</p>
              <p className="text-[10px] text-ink-400">at or below configured reorder level</p>
            </Card>
            <Card className="p-4">
              <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink-400">
                <CalendarClock className="h-3.5 w-3.5" /> Expiry at risk
              </div>
              <p className="mt-1.5 text-base font-bold text-ink-950">{intel.expiring.length}</p>
              <p className="text-[10px] text-ink-400">expired / critical / warning batches</p>
            </Card>
            <Card className="p-4">
              <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink-400">
                <TrendingDown className="h-3.5 w-3.5" /> Dead stock
              </div>
              <p className="mt-1.5 text-base font-bold text-ink-950">{inr(intel.deadStock.reduce((s, d) => s + d.value, 0))}</p>
              <p className="text-[10px] text-ink-400">{intel.deadStock.length} product(s) with no 30-day sales</p>
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {/* Stock-out prediction */}
            <Card className="p-4">
              <p className="mb-2 text-xs font-semibold text-ink-700">Stock-out prediction (forecast engine)</p>
              {intel.stockout.length === 0 ? (
                <p className="py-4 text-center text-xs text-ink-400">
                  {intel.forecastInsufficient ? 'Not enough order history for reliable predictions yet.' : 'No stock-out risk predicted in the current window.'}
                </p>
              ) : (
                <DataTable headers={['Product', 'Available', 'Risk', 'Days left']} caption="Stock-out predictions">
                  {intel.stockout.map((row) => (
                    <tr key={row.id}>
                      <Td>
                        <Link href={`/admin/inventory/forecast?risk=stockout&product=${row.id}`} className="font-medium text-ink-900 hover:text-primary-700">
                          {row.name}
                        </Link>
                      </Td>
                      <Td>{row.available ?? '—'}</Td>
                      <Td><TagPill label={row.risk} tone={riskTone(row.risk)} /></Td>
                      <Td>{row.days === null ? (row.date ? dateOnly(row.date) : '—') : `${row.days}d`}</Td>
                    </tr>
                  ))}
                </DataTable>
              )}
            </Card>

            {/* Recommended reorder */}
            <Card className="p-4">
              <p className="mb-2 text-xs font-semibold text-ink-700">Recommended reorder (forecast engine)</p>
              {intel.reorder.length === 0 ? (
                <p className="py-4 text-center text-xs text-ink-400">No reorder recommended right now.</p>
              ) : (
                <DataTable headers={['Product', 'Qty', 'Cover window', 'Method']} caption="Reorder recommendations">
                  {intel.reorder.map((row) => (
                    <tr key={row.id}>
                      <Td>
                        <Link href={`/admin/inventory/forecast?risk=reorder&product=${row.id}`} className="font-medium text-ink-900 hover:text-primary-700">
                          {row.name}
                        </Link>
                      </Td>
                      <Td>{row.quantity ?? '—'}</Td>
                      <Td>{row.windowDays ? `${row.windowDays} days` : '—'}</Td>
                      <Td className="text-[10px] text-ink-400">{row.method}</Td>
                    </tr>
                  ))}
                </DataTable>
              )}
              <p className="mt-2 text-[10px] text-ink-400">
                Execution happens through the existing GRN workflow — this section only recommends.{' '}
                <Link href="/admin/inventory/grn/new" className="font-semibold text-primary-700 hover:underline">Create a GRN</Link>
              </p>
            </Card>

            {/* Low stock */}
            <Card className="p-4">
              <p className="mb-2 text-xs font-semibold text-ink-700">Low / out of stock (threshold view)</p>
              {intel.lowStock.length === 0 ? (
                <p className="py-4 text-center text-xs text-ink-400">All stocked products are above their reorder levels.</p>
              ) : (
                <DataTable headers={['Product', 'SKU', 'Available', 'Reorder level']} caption="Low stock products">
                  {intel.lowStock.map((row) => (
                    <tr key={row.id}>
                      <Td className="font-medium text-ink-900">{row.name}</Td>
                      <Td className="text-ink-500">{row.sku}</Td>
                      <Td><TagPill label={row.available <= 0 ? 'Out of stock' : `${row.available} available`} tone={row.available <= 0 ? 'bad' : 'warn'} /></Td>
                      <Td>{row.reorderLevel > 0 ? String(row.reorderLevel) : 'not set'}</Td>
                    </tr>
                  ))}
                </DataTable>
              )}
            </Card>

            {/* Expiry */}
            <Card className="p-4">
              <p className="mb-2 text-xs font-semibold text-ink-700">Expiring batches (FEFO view)</p>
              {intel.expiring.length === 0 ? (
                <p className="py-4 text-center text-xs text-ink-400">No expired, critical or warning batches.</p>
              ) : (
                <DataTable headers={['Batch', 'Product', 'Expiry', 'Qty', 'Value']} caption="Expiring batches">
                  {intel.expiring.map((row) => (
                    <tr key={row.id}>
                      <Td>
                        <TagPill label={row.status} tone={row.status === 'expired' || row.status === 'critical' ? 'bad' : 'warn'} />
                      </Td>
                      <Td>
                        <span className="font-medium text-ink-900">{row.name}</span>
                        <span className="block text-[10px] text-ink-400">{row.batch}</span>
                      </Td>
                      <Td>{row.expiry ? dateOnly(row.expiry) : '—'}<span className="block text-[10px] text-ink-400">{row.days !== null ? `${row.days} days` : ''}</span></Td>
                      <Td>{row.qty}</Td>
                      <Td>{inrExact(row.value)}</Td>
                    </tr>
                  ))}
                </DataTable>
              )}
            </Card>

            {/* Fast / slow movers */}
            <Card className="p-4">
              <div className="mb-3 flex items-center gap-1.5 text-xs font-semibold text-ink-700">
                <TrendingUp className="h-3.5 w-3.5 text-emerald-600" /> Fast movers (units sold, 30d)
              </div>
              {intel.fastMoving.length === 0 ? (
                <p className="py-4 text-center text-xs text-ink-400">No sales recorded in the last 30 days.</p>
              ) : (
                <TopBars rows={intel.fastMoving.map((r) => ({ name: r.name, value: r.units30d }))} formatValue={(v) => `${Math.round(v)} units`} />
              )}
            </Card>
            <Card className="p-4">
              <div className="mb-3 flex items-center gap-1.5 text-xs font-semibold text-ink-700">
                <TrendingDown className="h-3.5 w-3.5 text-amber-600" /> Slow movers (units sold, 30d)
              </div>
              {intel.slowMoving.length === 0 ? (
                <p className="py-4 text-center text-xs text-ink-400">No sales recorded in the last 30 days.</p>
              ) : (
                <TopBars rows={intel.slowMoving.map((r) => ({ name: r.name, value: r.units30d, secondary: `${r.available} in stock` }))} formatValue={(v) => `${Math.round(v)} units`} />
              )}
            </Card>
          </div>
        </div>
      )}
    </Section>
  );
}
