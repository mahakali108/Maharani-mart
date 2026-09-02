import Link from 'next/link';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Info,
  ReceiptText,
  Scale,
  WalletCards,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { CreditSummary } from '@/components/retailer/credit-summary';
import { formatInr } from '@/lib/retailer/format';
import { parseCatalogPage } from '@/lib/retailer/catalog-params';
import {
  LEDGER_PAGE_SIZE,
  LEDGER_PAYMENT_GAP_NOTICE,
  loadRetailerLedger,
} from '@/lib/retailer/ledger';

/**
 * Retailer financial view.
 *
 * Every figure on this page comes from a real row the retailer is already
 * allowed to read: their own `retailers` record (authoritative credit limit and
 * outstanding balance) and their own `orders` (real charges with real dates).
 * Nothing is estimated, projected or back-filled — and because the schema
 * records no payments or adjustments, no running balance is shown. The notice
 * below the summary says so explicitly instead of implying completeness.
 *
 * See lib/retailer/ledger.ts for the full audit of what the schema supports and
 * docs/retailer-enterprise-upgrade.md §4 for the safest path to a complete
 * statement.
 */

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending confirmation',
  confirmed: 'Confirmed',
  processing: 'Processing',
  packed: 'Packed',
  dispatched: 'On the way',
  delivered: 'Delivered',
  returned: 'Returned',
};

function ledgerHref(page: number): string {
  return page > 1 ? `/retailer/account/ledger?page=${page}` : '/retailer/account/ledger';
}

export default async function RetailerLedgerPage({
  searchParams,
}: {
  searchParams: { page?: string };
}) {
  const user = await requireUser();
  const supabase = createClient();
  const page = parseCatalogPage(searchParams.page);

  const ledger = await loadRetailerLedger(supabase, user.id, page);
  const totalPages = Math.max(1, Math.ceil(ledger.totalEntries / LEDGER_PAGE_SIZE));

  return (
    <div className="space-y-5 sm:space-y-6">
      <nav
        aria-label="Breadcrumb"
        className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-500 sm:text-xs"
      >
        <Link href="/retailer/account" className="flex items-center gap-1 hover:text-primary-600">
          <ArrowLeft className="h-3.5 w-3.5" /> Account
        </Link>
        <ChevronRight className="h-3 w-3" />
        <span className="text-slate-800">Credit &amp; ledger</span>
      </nav>

      <div>
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary-600">Your finances</p>
        <h1 className="mt-1 text-xl font-bold tracking-tight text-slate-950 sm:text-3xl">Credit &amp; ledger</h1>
        <p className="mt-1 text-xs text-slate-500">
          {ledger.account?.shopName ?? 'Your account'} · order activity and your current credit position
        </p>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-7">
        <div className="space-y-4">
          {/* Real order charges — one row per real order. */}
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 bg-slate-50 px-4 py-3.5 sm:px-5">
              <div className="flex items-center gap-2">
                <ReceiptText className="h-4 w-4 text-primary-600" aria-hidden="true" />
                <div>
                  <h2 className="text-sm font-bold text-slate-900">Order activity</h2>
                  <p className="mt-0.5 text-[10px] text-slate-500">
                    {ledger.totalEntries} order{ledger.totalEntries === 1 ? '' : 's'} on your account
                  </p>
                </div>
              </div>
              {ledger.entries.length > 0 ? (
                <p className="shrink-0 text-right">
                  <span className="block text-[9px] font-bold uppercase tracking-wider text-slate-400">This page</span>
                  <span className="block text-xs font-bold text-slate-900">{formatInr(ledger.pageTotal)}</span>
                </p>
              ) : null}
            </div>

            {ledger.entries.length === 0 ? (
              <div className="flex flex-col items-center justify-center px-5 py-14 text-center">
                <span className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-slate-400">
                  <Scale className="h-6 w-6" aria-hidden="true" />
                </span>
                <h3 className="mt-4 text-sm font-bold text-slate-800">No order activity yet</h3>
                <p className="mt-1.5 max-w-sm text-xs leading-5 text-slate-500">
                  Orders you place will be listed here with their real dates and values. Cancelled orders are not
                  shown, because they never became a charge on your account.
                </p>
                <Link
                  href="/retailer/catalog"
                  className="mt-5 flex h-10 items-center gap-2 rounded-xl bg-primary-600 px-4 text-xs font-bold text-white transition hover:bg-primary-700"
                >
                  Browse products <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              </div>
            ) : (
              <>
                {/* Mobile-first list; a real table from sm up. */}
                <ul className="divide-y divide-slate-100 lg:hidden">
                  {ledger.entries.map((entry) => (
                    <li key={entry.orderId} className="px-4 py-3.5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <Link
                            href={`/retailer/orders/${entry.orderId}`}
                            className="truncate font-mono text-xs font-bold text-slate-900 hover:text-primary-600"
                          >
                            {entry.orderNumber}
                          </Link>
                          <p className="mt-1 text-[10px] text-slate-500">
                            {new Date(entry.placedAt).toLocaleDateString('en-IN', {
                              day: 'numeric',
                              month: 'short',
                              year: 'numeric',
                            })}
                            {' · '}
                            {STATUS_LABELS[entry.status] ?? entry.status}
                          </p>
                          <p className="mt-1 text-[10px] text-slate-400">
                            incl. GST {formatInr(entry.gstTotal)}
                          </p>
                        </div>
                        <p className="shrink-0 text-sm font-bold text-slate-950">{formatInr(entry.grandTotal)}</p>
                      </div>
                    </li>
                  ))}
                </ul>

                <table className="hidden w-full text-left text-xs lg:table">
                  <thead className="border-b border-slate-100 bg-white text-[9px] font-bold uppercase tracking-wider text-slate-400">
                    <tr>
                      <th scope="col" className="px-5 py-3">Date</th>
                      <th scope="col" className="px-5 py-3">Order</th>
                      <th scope="col" className="px-5 py-3">Status</th>
                      <th scope="col" className="px-5 py-3 text-right">Excl. GST</th>
                      <th scope="col" className="px-5 py-3 text-right">GST</th>
                      <th scope="col" className="px-5 py-3 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {ledger.entries.map((entry) => (
                      <tr key={entry.orderId} className="hover:bg-slate-50/70">
                        <td className="whitespace-nowrap px-5 py-3 text-slate-600">
                          {new Date(entry.placedAt).toLocaleDateString('en-IN', {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                          })}
                        </td>
                        <td className="px-5 py-3">
                          <Link
                            href={`/retailer/orders/${entry.orderId}`}
                            className="font-mono font-bold text-slate-900 hover:text-primary-600"
                          >
                            {entry.orderNumber}
                          </Link>
                        </td>
                        <td className="px-5 py-3 text-slate-600">
                          {STATUS_LABELS[entry.status] ?? entry.status}
                        </td>
                        <td className="px-5 py-3 text-right text-slate-600">{formatInr(entry.subtotal)}</td>
                        <td className="px-5 py-3 text-right text-slate-600">{formatInr(entry.gstTotal)}</td>
                        <td className="px-5 py-3 text-right font-bold text-slate-950">
                          {formatInr(entry.grandTotal)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {totalPages > 1 ? (
                  <nav
                    className="flex items-center justify-center gap-3 border-t border-slate-100 bg-slate-50/60 px-4 py-3"
                    aria-label="Ledger pages"
                  >
                    {page > 1 ? (
                      <Link
                        href={ledgerHref(page - 1)}
                        className="flex h-9 items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 text-[10px] font-bold text-slate-700"
                      >
                        <ChevronLeft className="h-3.5 w-3.5" /> Previous
                      </Link>
                    ) : (
                      <span />
                    )}
                    <span className="text-[10px] font-semibold text-slate-500">
                      Page {page} of {totalPages}
                    </span>
                    {page < totalPages ? (
                      <Link
                        href={ledgerHref(page + 1)}
                        className="flex h-9 items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 text-[10px] font-bold text-slate-700"
                      >
                        Next <ChevronRight className="h-3.5 w-3.5" />
                      </Link>
                    ) : (
                      <span />
                    )}
                  </nav>
                ) : null}
              </>
            )}
          </section>

          {/* Honest scope notice — the schema gap, stated to the retailer. */}
          <div className="flex items-start gap-3 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3.5">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-700" aria-hidden="true" />
            <p className="text-[11px] leading-5 text-blue-900">{LEDGER_PAYMENT_GAP_NOTICE}</p>
          </div>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-36">
          {ledger.account ? (
            <CreditSummary
              creditLimit={ledger.account.creditLimit}
              outstandingBalance={ledger.account.outstandingBalance}
              title="Credit position"
            />
          ) : (
            <section className="rounded-2xl border border-slate-200 bg-white p-5 text-center shadow-sm">
              <WalletCards className="mx-auto h-6 w-6 text-slate-300" aria-hidden="true" />
              <p className="mt-3 text-xs font-bold text-slate-800">No retailer record found</p>
              <p className="mt-1 text-[11px] leading-4 text-slate-500">
                Your account is still being set up. Contact your distributor if this does not change.
              </p>
            </section>
          )}

          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">How credit works here</p>
            <ul className="mt-2.5 space-y-2 text-[11px] leading-4 text-slate-600">
              <li className="flex gap-2">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-primary-500" aria-hidden="true" />
                Your credit limit and outstanding balance are maintained by your distributor and are the figures used
                when an order is validated.
              </li>
              <li className="flex gap-2">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-primary-500" aria-hidden="true" />
                Available credit is checked again on the server every time you place an order — it can never be
                bypassed from this screen.
              </li>
              <li className="flex gap-2">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-primary-500" aria-hidden="true" />
                All prices and totals are GST-inclusive; the GST component is shown per order, never added on top.
              </li>
            </ul>
            <Link
              href="/retailer/orders"
              className="mt-3.5 flex h-9 items-center justify-center rounded-lg border border-slate-200 text-[10px] font-bold text-slate-700 transition hover:border-primary-200 hover:text-primary-600"
            >
              View all orders
            </Link>
          </section>
        </aside>
      </div>
    </div>
  );
}
