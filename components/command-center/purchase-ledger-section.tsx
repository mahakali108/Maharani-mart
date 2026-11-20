import Link from 'next/link';
import { Factory, PackagePlus } from 'lucide-react';
import type { SupplierIntel } from '@/lib/admin/command-center/types';
import { Card } from '@/components/ui/card';
import { DataTable, dateOnly, inr, inrExact, LinkPill, pct, Section, SectionEmptyState, Td } from './shared';

/**
 * Purchase & GRN Intelligence — built on the EXISTING GRN module
 * (grns + grn_items).
 *
 * NOT a supplier marketplace. Maharani Traders has no supplier accounts, no
 * supplier portal and no supplier ordering: purchasing is an internal
 * warehouse workflow, and the vendor name on a goods-received note is
 * historical purchase provenance (`grns.supplier_reference`). There is no
 * supplier master table in the schema, so the names shown here are exactly the
 * free-text references recorded on GRNs — no identity, GSTIN, payable or
 * settlement is invented.
 */
export function PurchaseLedgerSection({ intel }: { intel: SupplierIntel }) {
  return (
    <Section
      title="Purchase & GRN intelligence"
      subtitle="Internal goods-receipt workflow — 90-day window. Cost changes compare successive confirmed receipts per product."
      icon={Factory}
      status={intel.status}
      actions={
        <div className="flex flex-wrap gap-2">
          <LinkPill href="/admin/inventory/grn">GRNs</LinkPill>
          <LinkPill href="/admin/inventory/grn/new">New GRN</LinkPill>
        </div>
      }
    >
      {!intel.hasGrnData ? (
        <SectionEmptyState
          title="No purchase activity yet"
          body="Purchase intelligence activates when GRNs (goods receipt notes) are created through the existing inventory workflow. Vendor references, purchase value and cost changes will appear here."
        />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Card className="p-4">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-400">Pending GRNs (draft)</p>
              <p className="mt-1.5 text-lg font-bold text-ink-950">{intel.pendingGrns.length}</p>
              <p className="text-[10px] text-ink-400">awaiting confirmation</p>
            </Card>
            <Card className="p-4">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-400">Confirmed value (30d)</p>
              <p className="mt-1.5 text-lg font-bold text-ink-950">{inr(intel.confirmed30dValue)}</p>
              <p className="text-[10px] text-ink-400">{intel.confirmed30dCount} GRN(s)</p>
            </Card>
            <Card className="p-4">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-400">Vendors on GRNs (90d)</p>
              <p className="mt-1.5 text-lg font-bold text-ink-950">{intel.suppliers.length}</p>
              <p className="text-[10px] text-ink-400">distinct GRN vendor references</p>
            </Card>
            <Card className="p-4">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-400">Purchase cost changes</p>
              <p className="mt-1.5 text-lg font-bold text-ink-950">{intel.costChanges.length}</p>
              <p className="text-[10px] text-ink-400">≥0.5% shift between receipts</p>
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <Card className="p-4">
              <p className="mb-2 text-xs font-semibold text-ink-700">Pending purchase orders (draft GRNs)</p>
              {intel.pendingGrns.length === 0 ? (
                <p className="py-4 text-center text-xs text-ink-400">No draft GRNs pending confirmation.</p>
              ) : (
                <DataTable headers={['GRN', 'Vendor ref', 'Warehouse', 'Created', 'Value']} caption="Pending GRNs">
                  {intel.pendingGrns.map((grn) => (
                    <tr key={grn.id}>
                      <Td className="font-medium text-ink-900">{grn.number}</Td>
                      <Td>{grn.supplier}</Td>
                      <Td>{grn.warehouse}</Td>
                      <Td>{dateOnly(grn.createdAt)}</Td>
                      <Td>{inrExact(grn.value)}</Td>
                    </tr>
                  ))}
                </DataTable>
              )}
              <p className="mt-2 text-[10px] text-ink-400">
                Delayed-delivery tracking is not shown — the platform has no purchase-order due dates yet.
              </p>
            </Card>

            <Card className="p-4">
              <p className="mb-2 text-xs font-semibold text-ink-700">Vendor-wise purchasing (90d)</p>
              {intel.suppliers.length === 0 ? (
                <p className="py-4 text-center text-xs text-ink-400">No purchase activity.</p>
              ) : (
                <DataTable headers={['Vendor ref', 'GRNs', 'Value']} caption="Vendor summary">
                  {intel.suppliers.map((s) => (
                    <tr key={s.name}>
                      <Td className="font-medium text-ink-900">{s.name}</Td>
                      <Td>{s.grns90d}</Td>
                      <Td>{inr(s.value90d)}</Td>
                    </tr>
                  ))}
                </DataTable>
              )}
            </Card>

            <Card className="p-4">
              <p className="mb-2 text-xs font-semibold text-ink-700">Purchase cost changes (per product, confirmed receipts)</p>
              {intel.costChanges.length === 0 ? (
                <p className="py-4 text-center text-xs text-ink-400">No material cost changes between recorded receipts yet.</p>
              ) : (
                <DataTable headers={['Product', 'Previous cost', 'Latest cost', 'Change']} caption="Purchase cost changes">
                  {intel.costChanges.map((c) => (
                    <tr key={c.productId}>
                      <Td className="font-medium text-ink-900">{c.productName}</Td>
                      <Td>{inrExact(c.previousCost)}</Td>
                      <Td>{inrExact(c.latestCost)}</Td>
                      <Td>
                        <span className={c.changePct > 0 ? 'font-semibold text-error-600' : 'font-semibold text-mint-600'}>{pct(c.changePct)}</span>
                      </Td>
                    </tr>
                  ))}
                </DataTable>
              )}
            </Card>

            <Card className="p-4">
              <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-ink-700">
                <PackagePlus className="h-3.5 w-3.5" /> Products requiring purchase (forecast reorder signals)
              </div>
              {intel.productsRequiringPurchase.length === 0 ? (
                <p className="py-4 text-center text-xs text-ink-400">No purchase required right now per the forecast engine.</p>
              ) : (
                <ul className="divide-y divide-ink-50">
                  {intel.productsRequiringPurchase.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-3 py-2">
                      <div className="min-w-0">
                        <Link href={`/admin/inventory/forecast?risk=reorder&product=${p.id}`} className="text-xs font-medium text-ink-900 hover:text-primary-700">
                          {p.name}
                        </Link>
                        <p className="truncate text-[10px] text-ink-400">{p.reason}</p>
                      </div>
                      <span className="shrink-0 text-xs font-bold text-ink-900">{p.quantity ?? '—'} units</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-2 text-[10px] text-ink-400">Purchase execution happens through the existing GRN workflow only.</p>
            </Card>
          </div>
        </div>
      )}
    </Section>
  );
}
