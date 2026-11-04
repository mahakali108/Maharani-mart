import Link from 'next/link';
import { Factory, FileCheck2, Plus, Search, TriangleAlert } from 'lucide-react';
import { requirePagePermission } from '@/lib/admin/guard';
import { createClient } from '@/lib/supabase/server';
import { loadSupplierDirectory } from '@/lib/admin/suppliers-data';
import {
  SUPPLIER_STATUSES,
  parseSupplierQuery,
  supplierHref,
  totalPages,
} from '@/lib/admin/suppliers-query';
import { formatIndiaDateTime } from '@/lib/datetime/india';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { AdminEmptyState } from '@/components/admin/empty-state';
import { StatusBadge } from '@/components/admin/status-badge';

export const dynamic = 'force-dynamic';

const inr = (v: number) =>
  `₹${v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Supplier Directory & Purchase Ledger (/admin/suppliers).
 *
 * Authorization: middleware admits admin/super_admin to /admin/*, this page
 * additionally requires the `suppliers.view` permission server-side
 * (requirePagePermission → /unauthorized), and all reads go through the
 * caller's RLS-scoped Supabase client (grns/grn_items RLS, migration 0017).
 * No service-role key is used.
 *
 * Honesty contract: there is no supplier master table yet, so this page is a
 * directory of the supplier references actually recorded on GRNs — it does
 * not display invented supplier identities, GSTINs, payables or settlements.
 */
export default async function SuppliersPage({
  searchParams: searchParamsPromise,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const searchParams = await searchParamsPromise;
  await requirePagePermission('suppliers.view');
  const query = parseSupplierQuery(searchParams);
  const data = await loadSupplierDirectory((await createClient()), query);
  const pages = totalPages(data.total);
  const currentPage = Math.min(query.page, pages);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold text-ink-950">
            <Factory className="h-6 w-6" aria-hidden /> Suppliers
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-500">
            Supplier directory and purchase ledger derived from Goods Received Notes. Supplier names below are
            the references recorded on GRNs — Maharani Traders has no supplier master record yet, so contact,
            GSTIN, payable and settlement data are intentionally not shown.
          </p>
        </div>
        <Link href="/admin/suppliers/applications">
          <Button size="sm" variant="outline">Supplier applications</Button>
        </Link>
        <Link href="/admin/inventory/grn/new">
          <Button size="sm">
            <Plus className="h-4 w-4" aria-hidden /> New GRN
          </Button>
        </Link>
      </div>

      {data.status === 'unavailable' ? (
        <Card role="alert" className="flex items-start gap-3 border-error-200 bg-error-50">
          <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-error-600" aria-hidden />
          <div>
            <p className="text-sm font-semibold text-ink-900">Supplier data could not be loaded</p>
            <p className="mt-0.5 text-sm text-ink-600">
              The GRN records could not be read right now. No data was changed. Please retry, or open the GRN
              list directly.
            </p>
            <Link href="/admin/inventory/grn" className="mt-2 inline-block text-sm font-medium text-primary-700 underline">
              Open GRNs
            </Link>
          </div>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="GRN totals">
            {[
              { label: 'All GRNs', value: data.counts.all },
              { label: 'Draft — awaiting confirmation', value: data.counts.draft },
              { label: 'Confirmed (stock received)', value: data.counts.confirmed },
              { label: 'Cancelled', value: data.counts.cancelled },
            ].map((kpi) => (
              <Card key={kpi.label} className="p-4">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">{kpi.label}</p>
                <p className="mt-1 text-2xl font-bold text-ink-950">{kpi.value.toLocaleString('en-IN')}</p>
              </Card>
            ))}
          </div>

          <Card>
            <h2 className="text-sm font-semibold text-ink-900">Top supplier references</h2>
            <p className="mt-0.5 text-xs text-ink-500">
              Aggregated from the {data.summaryWindow} most recent non-cancelled GRNs
              {data.summaryTruncated ? ' (window limit reached — older GRNs are not included)' : ''}. Value =
              received quantity × recorded unit cost. Stock received through GRNs is Maharani-owned inventory;
              this page does not represent supplier-owned stock.
            </p>
            {data.summary.length === 0 ? (
              <p className="py-4 text-sm text-ink-400">No supplier activity recorded yet.</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <caption className="sr-only">Supplier references aggregated from recent GRNs</caption>
                  <thead className="border-b border-ink-100 text-left text-xs uppercase tracking-wide text-ink-500">
                    <tr>
                      <th className="py-2 pr-3 font-medium">Supplier reference</th>
                      <th className="py-2 pr-3 font-medium">GRNs</th>
                      <th className="py-2 pr-3 font-medium">Draft</th>
                      <th className="py-2 pr-3 font-medium">Lines</th>
                      <th className="py-2 pr-3 font-medium">Received value</th>
                      <th className="py-2 font-medium">Last activity</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-100">
                    {data.summary.slice(0, 10).map((s) => (
                      <tr key={s.name}>
                        <td className="py-2 pr-3 font-medium text-ink-900">
                          {s.reference ? (
                            <Link
                              className="hover:text-primary-700 hover:underline"
                              href={supplierHref(query, { supplier: s.reference, page: 1 })}
                            >
                              {s.name}
                            </Link>
                          ) : (
                            s.name
                          )}
                        </td>
                        <td className="py-2 pr-3 text-ink-600">{s.grns}</td>
                        <td className="py-2 pr-3 text-ink-600">{s.draft}</td>
                        <td className="py-2 pr-3 text-ink-600">{s.lines}</td>
                        <td className="py-2 pr-3 text-ink-600">{inr(s.value)}</td>
                        <td className="py-2 text-ink-500">
                          {s.lastActivityAt ? formatIndiaDateTime(s.lastActivityAt) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card className="p-4">
            <form method="get" className="flex flex-wrap items-end gap-2" role="search" aria-label="Search purchase ledger">
              <div className="min-w-[220px] flex-1">
                <label htmlFor="supplier-q" className="mb-1 block text-xs font-medium text-ink-600">
                  Search GRN, supplier or supplier invoice ref
                </label>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" aria-hidden />
                  <Input id="supplier-q" name="q" defaultValue={query.q} placeholder="e.g. GRN-2026…, Sharma Traders" className="pl-9" />
                </div>
              </div>
              <div>
                <label htmlFor="supplier-status" className="mb-1 block text-xs font-medium text-ink-600">Status</label>
                <Select id="supplier-status" name="status" defaultValue={query.status}>
                  {SUPPLIER_STATUSES.map((s) => (
                    <option key={s} value={s}>{s === 'all' ? 'All statuses' : s}</option>
                  ))}
                </Select>
              </div>
              {query.supplier ? <input type="hidden" name="supplier" value={query.supplier} /> : null}
              <Button type="submit" size="sm">Search</Button>
              {(query.q || query.status !== 'all' || query.supplier) ? (
                <Link href="/admin/suppliers" className="text-sm font-medium text-primary-700 underline">
                  Clear filters{query.supplier ? ` (supplier: ${query.supplier})` : ''}
                </Link>
              ) : null}
            </form>
          </Card>

          {data.ledger.length === 0 ? (
            <AdminEmptyState
              icon={FileCheck2}
              title="No GRNs match"
              body="No Goods Received Notes match the current search. Create a GRN when stock arrives from a supplier; it will appear here with its supplier reference."
            />
          ) : (
            <>
              <Card className="overflow-x-auto p-0">
                <table className="w-full min-w-[860px] text-sm">
                  <caption className="sr-only">Purchase ledger — Goods Received Notes, page {currentPage} of {pages}</caption>
                  <thead className="border-b border-ink-100 bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
                    <tr>
                      <th className="px-5 py-3 font-medium">GRN</th>
                      <th className="px-5 py-3 font-medium">Supplier reference</th>
                      <th className="px-5 py-3 font-medium">Supplier invoice ref</th>
                      <th className="px-5 py-3 font-medium">Warehouse</th>
                      <th className="px-5 py-3 text-right font-medium">Lines</th>
                      <th className="px-5 py-3 text-right font-medium">Received value</th>
                      <th className="px-5 py-3 font-medium">Status</th>
                      <th className="px-5 py-3 font-medium">Created</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-100">
                    {data.ledger.map((g) => (
                      <tr key={g.id}>
                        <td className="px-5 py-3">
                          <Link href={`/admin/inventory/grn/${g.id}`} className="font-mono font-medium text-ink-900 hover:text-primary-600">
                            {g.grn_number}
                          </Link>
                        </td>
                        <td className="px-5 py-3 text-ink-600">{g.supplier_reference ?? '—'}</td>
                        <td className="px-5 py-3 text-ink-600">{g.invoice_reference ?? '—'}</td>
                        <td className="px-5 py-3 text-ink-600">{g.warehouse_name ?? '—'}</td>
                        <td className="px-5 py-3 text-right text-ink-600">{g.lines}</td>
                        <td className="px-5 py-3 text-right text-ink-600">{inr(g.value)}</td>
                        <td className="px-5 py-3"><StatusBadge status={g.status} /></td>
                        <td className="px-5 py-3 text-ink-500">{formatIndiaDateTime(g.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
              <nav className="flex items-center justify-between text-sm" aria-label="Purchase ledger pages">
                <p className="text-ink-500">
                  {data.total.toLocaleString('en-IN')} GRN(s) · Page {currentPage} of {pages}
                </p>
                <div className="flex gap-2">
                  {currentPage > 1 ? (
                    <Link href={supplierHref(query, { page: currentPage - 1 })}><Button size="sm" variant="outline">Previous</Button></Link>
                  ) : null}
                  {currentPage < pages ? (
                    <Link href={supplierHref(query, { page: currentPage + 1 })}><Button size="sm" variant="outline">Next</Button></Link>
                  ) : null}
                </div>
              </nav>
            </>
          )}
        </>
      )}
    </div>
  );
}
