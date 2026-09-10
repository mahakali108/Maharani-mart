import Link from 'next/link';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Info,
  ReceiptText,
  WalletCards,
  ArrowDownCircle,
  ArrowUpCircle,
  Clock,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { formatInr } from '@/lib/retailer/format';
import { parseCatalogPage } from '@/lib/retailer/catalog-params';
import { formatIndiaDateTime } from '@/lib/datetime/india';
import {
  getRetailerWalletSummary,
  getRetailerLedgerPaginated,
  paiseToRupees,
  formatPaise,
} from '@/lib/retailer/wallet';
import { loadRetailerLedger } from '@/lib/retailer/ledger';

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending confirmation',
  confirmed: 'Confirmed',
  processing: 'Processing',
  packed: 'Packed',
  dispatched: 'On the way',
  delivered: 'Delivered',
  returned: 'Returned',
};

const TX_TYPE_LABELS: Record<string, string> = {
  ORDER_DEBIT: 'Order',
  PAYMENT_CREDIT: 'Payment',
  REFUND_CREDIT: 'Refund',
  MANUAL_CREDIT: 'Credit',
  MANUAL_DEBIT: 'Debit',
  ORDER_REVERSAL: 'Reversal',
  ADJUSTMENT: 'Adjustment',
  CREDIT_LIMIT_CHANGE: 'Limit Change',
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

  // New wallet system: authoritative summary from ledger + legacy
  const [walletSummary, walletLedger, legacyLedger] = await Promise.all([
    getRetailerWalletSummary(supabase, user.id),
    getRetailerLedgerPaginated(supabase, user.id, page, 25),
    loadRetailerLedger(supabase, user.id, page),
  ]);

  const totalPages = Math.max(1, Math.ceil(walletLedger.total / 25));
  const hasConfiguredLimit = walletSummary.hasConfiguredLimit;

  // For retailer view, hide internal details: no cost, no SKU, no admin notes, no other customers
  // Show only own transactions, with clear cards

  return (
    <div className="mx-auto w-full max-w-full space-y-4 overflow-x-hidden pb-[calc(6rem+env(safe-area-inset-bottom))] sm:space-y-5">
      <nav
        aria-label="Breadcrumb"
        className="flex min-w-0 items-center gap-1 overflow-hidden text-[10px] font-semibold text-slate-500 sm:gap-1.5 sm:text-xs"
      >
        <Link href="/retailer/account" className="flex shrink-0 items-center gap-1 rounded px-1 py-0.5 hover:text-primary-600">
          <ArrowLeft className="h-3.5 w-3.5" /> Account
        </Link>
        <ChevronRight className="h-3 w-3 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-slate-800">Wallet & Credit</span>
      </nav>

      <div className="min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary-600">Your finances</p>
        <h1 className="mt-1 break-words text-xl font-bold tracking-tight text-slate-950 sm:text-2xl">Wallet & Credit</h1>
        <p className="mt-1 break-words text-xs text-slate-500">
          {legacyLedger.account?.shopName ?? 'Your account'} · credit limit, outstanding, available, payment history
        </p>
      </div>

      {/* Balance cards — mobile-first, 320px safe, no overflow */}
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Credit Limit</p>
          <p className="mt-1 break-words text-xl font-bold tracking-tight text-slate-950">
            {hasConfiguredLimit ? formatPaise(walletSummary.creditLimitPaise) : 'Not configured'}
          </p>
          <p className="mt-1 text-[10px] text-slate-500">Total credit granted by distributor</p>
        </div>
        <div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Outstanding</p>
          <p className="mt-1 break-words text-xl font-bold tracking-tight text-slate-950">
            {formatPaise(walletSummary.outstandingPaise)}
          </p>
          <p className="mt-1 text-[10px] text-slate-500">Total used credit</p>
        </div>
        <div
          className={`min-w-0 rounded-2xl border p-4 shadow-sm ${
            walletSummary.availablePaise < 0 ? 'border-primary-200 bg-primary-50' : 'border-emerald-200 bg-emerald-50/70'
          }`}
        >
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Available Credit</p>
          <p
            className={`mt-1 break-words text-xl font-bold tracking-tight ${
              walletSummary.availablePaise < 0 ? 'text-primary-700' : 'text-emerald-700'
            }`}
          >
            {formatPaise(walletSummary.availablePaise)}
          </p>
          <p className="mt-1 text-[10px] text-slate-500">
            {walletSummary.isOverLimit ? 'Overdue — contact distributor' : 'Available for new orders'}
          </p>
        </div>
      </div>

      {hasConfiguredLimit ? null : (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3.5">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
          <p className="min-w-0 break-words text-[11px] leading-5 text-amber-900">
            No credit facility configured yet. Your distributor will set your credit limit. You can still browse products.
          </p>
        </div>
      )}

      {walletSummary.isOverLimit ? (
        <div className="flex items-start gap-3 rounded-2xl border border-primary-200 bg-primary-50 px-4 py-3.5">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary-700" aria-hidden="true" />
          <p className="min-w-0 break-words text-[11px] leading-5 text-primary-900">
            Your account is over limit by {formatPaise(walletSummary.outstandingPaise - walletSummary.creditLimitPaise)}. New
            credit orders will be rejected until payment is recorded. Contact your distributor.
          </p>
        </div>
      ) : null}

      <div className="grid min-w-0 grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-6">
        <div className="min-w-0 space-y-4">
          {/* Wallet ledger — real data only, debit/credit visually distinguishable */}
          <section className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex min-w-0 items-center justify-between gap-3 border-b border-slate-100 bg-slate-50 px-4 py-3.5 sm:px-5">
              <div className="flex min-w-0 items-center gap-2">
                <ReceiptText className="h-4 w-4 shrink-0 text-primary-600" aria-hidden="true" />
                <div className="min-w-0">
                  <h2 className="break-words text-sm font-bold text-slate-900">Transaction History</h2>
                  <p className="mt-0.5 break-words text-[10px] text-slate-500">
                    {walletLedger.total} transaction{walletLedger.total === 1 ? '' : 's'} · real data only
                  </p>
                </div>
              </div>
              <Clock className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
            </div>

            {walletLedger.entries.length === 0 ? (
              <div className="flex flex-col items-center justify-center px-5 py-14 text-center">
                <span className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-slate-400">
                  <WalletCards className="h-6 w-6" aria-hidden="true" />
                </span>
                <h3 className="mt-4 break-words text-sm font-bold text-slate-800">No wallet transactions yet</h3>
                <p className="mt-1.5 max-w-sm break-words text-xs leading-5 text-slate-500">
                  Orders you place and payments recorded by your distributor will appear here. No fake data is shown.
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
                {/* Mobile list */}
                <ul className="divide-y divide-slate-100 lg:hidden">
                  {walletLedger.entries.map((entry) => {
                    const isDebit = entry.direction === 'debit';
                    const amount = paiseToRupees(entry.amount_paise);
                    if (entry.transaction_type === 'CREDIT_LIMIT_CHANGE') return null; // hide from retailer
                    return (
                      <li key={entry.id} className="min-w-0 px-4 py-3.5">
                        <div className="flex min-w-0 items-start justify-between gap-3">
                          <div className="flex min-w-0 items-start gap-2.5">
                            <span
                              className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                                isDebit ? 'bg-primary-50 text-primary-600' : 'bg-emerald-50 text-emerald-600'
                              }`}
                            >
                              {isDebit ? <ArrowUpCircle className="h-4 w-4" /> : <ArrowDownCircle className="h-4 w-4" />}
                            </span>
                            <div className="min-w-0">
                              <p className="break-words text-xs font-bold text-slate-900">
                                {TX_TYPE_LABELS[entry.transaction_type] ?? entry.transaction_type}
                              </p>
                              <p className="mt-0.5 break-words text-[10px] leading-4 text-slate-500">
                                {entry.description}
                              </p>
                              <p className="mt-1 break-words text-[10px] text-slate-400">
                                {formatIndiaDateTime(entry.created_at)}
                                {entry.reference_type ? ` · ${entry.reference_type}` : ''}
                                {entry.reference_id ? ` ${entry.reference_id.slice(0, 8)}…` : ''}
                              </p>
                              {entry.reason ? (
                                <p className="mt-1 break-words text-[10px] text-slate-400">Reason: {entry.reason}</p>
                              ) : null}
                            </div>
                          </div>
                          <p
                            className={`shrink-0 break-words text-sm font-bold ${
                              isDebit ? 'text-primary-700' : 'text-emerald-700'
                            }`}
                          >
                            {isDebit ? '-' : '+'}
                            {formatInr(amount)}
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ul>

                {/* Desktop table */}
                <table className="hidden w-full min-w-0 text-left text-xs lg:table">
                  <thead className="border-b border-slate-100 bg-white text-[9px] font-bold uppercase tracking-wider text-slate-400">
                    <tr>
                      <th className="px-5 py-3">Date</th>
                      <th className="px-5 py-3">Type</th>
                      <th className="px-5 py-3">Description</th>
                      <th className="px-5 py-3 text-right">Amount</th>
                      <th className="px-5 py-3">Reference</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {walletLedger.entries
                      .filter((e) => e.transaction_type !== 'CREDIT_LIMIT_CHANGE')
                      .map((entry) => {
                        const isDebit = entry.direction === 'debit';
                        return (
                          <tr key={entry.id} className="hover:bg-slate-50/70">
                            <td className="whitespace-nowrap px-5 py-3 text-slate-600">
                              {formatIndiaDateTime(entry.created_at)}
                            </td>
                            <td className="px-5 py-3">
                              <span
                                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                                  isDebit ? 'bg-primary-50 text-primary-700' : 'bg-emerald-50 text-emerald-700'
                                }`}
                              >
                                {isDebit ? (
                                  <ArrowUpCircle className="h-3 w-3" />
                                ) : (
                                  <ArrowDownCircle className="h-3 w-3" />
                                )}
                                {TX_TYPE_LABELS[entry.transaction_type] ?? entry.transaction_type}
                              </span>
                            </td>
                            <td className="max-w-[260px] truncate px-5 py-3 text-slate-700">{entry.description}</td>
                            <td
                              className={`px-5 py-3 text-right font-bold ${
                                isDebit ? 'text-primary-700' : 'text-emerald-700'
                              }`}
                            >
                              {isDebit ? '-' : '+'}
                              {formatInr(paiseToRupees(entry.amount_paise))}
                            </td>
                            <td className="px-5 py-3 text-slate-500">
                              {entry.reference_type ? `${entry.reference_type}` : '—'}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>

                {totalPages > 1 ? (
                  <nav className="flex items-center justify-center gap-3 border-t border-slate-100 bg-slate-50/60 px-4 py-3">
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

          {/* Legacy order activity for backward compat */}
          <section className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex min-w-0 items-center justify-between gap-3 border-b border-slate-100 bg-slate-50 px-4 py-3.5 sm:px-5">
              <div className="flex min-w-0 items-center gap-2">
                <ReceiptText className="h-4 w-4 shrink-0 text-primary-600" aria-hidden="true" />
                <div className="min-w-0">
                  <h2 className="break-words text-sm font-bold text-slate-900">Order Activity</h2>
                  <p className="mt-0.5 break-words text-[10px] text-slate-500">
                    {legacyLedger.totalEntries} order{legacyLedger.totalEntries === 1 ? '' : 's'} on your account
                  </p>
                </div>
              </div>
            </div>
            {legacyLedger.entries.length === 0 ? (
              <p className="p-4 text-xs text-slate-500">No orders yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {legacyLedger.entries.slice(0, 5).map((entry) => (
                  <li key={entry.orderId} className="min-w-0 px-4 py-3">
                    <div className="flex min-w-0 items-center justify-between gap-3">
                      <Link href={`/retailer/orders/${entry.orderId}`} className="min-w-0 truncate font-mono text-xs font-bold text-slate-900 hover:text-primary-600">
                        {entry.orderNumber}
                      </Link>
                      <span className="shrink-0 text-xs font-bold">{formatInr(entry.grandTotal)}</span>
                    </div>
                    <p className="mt-1 break-words text-[10px] text-slate-500">
                      {formatIndiaDateTime(entry.placedAt)} · {STATUS_LABELS[entry.status] ?? entry.status}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            <Link href="/retailer/orders" className="flex h-10 items-center justify-center border-t border-slate-100 bg-slate-50 text-[10px] font-bold text-primary-600">
              View all orders
            </Link>
          </section>
        </div>

        <aside className="min-w-0 space-y-4 lg:sticky lg:top-36">
          <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">How credit works</p>
            <ul className="mt-2.5 space-y-2 text-[11px] leading-4 text-slate-600">
              <li className="flex gap-2">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-primary-500" aria-hidden="true" />
                <span className="min-w-0 break-words">Credit limit and outstanding are maintained by your distributor and checked server-side on every order.</span>
              </li>
              <li className="flex gap-2">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-primary-500" aria-hidden="true" />
                <span className="min-w-0 break-words">Available credit = Credit limit − Outstanding. Uses integer paise.</span>
              </li>
              <li className="flex gap-2">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-primary-500" aria-hidden="true" />
                <span className="min-w-0 break-words">Payments recorded by Admin appear as credits. No fake balances.</span>
              </li>
            </ul>
            <div className="mt-3 space-y-2 rounded-xl bg-slate-50 p-3 text-[10px] leading-4 text-slate-600">
              <p><strong>Credit Limit:</strong> {hasConfiguredLimit ? formatPaise(walletSummary.creditLimitPaise) : 'Not set'}</p>
              <p><strong>Outstanding:</strong> {formatPaise(walletSummary.outstandingPaise)}</p>
              <p><strong>Available:</strong> {formatPaise(walletSummary.availablePaise)}</p>
              {walletSummary.isOverLimit ? <p className="font-bold text-primary-700">Overdue: {formatPaise(walletSummary.outstandingPaise - walletSummary.creditLimitPaise)}</p> : null}
            </div>
            <Link href="/retailer/orders" className="mt-3.5 flex h-9 items-center justify-center rounded-lg border border-slate-200 text-[10px] font-bold text-slate-700 hover:border-primary-200 hover:text-primary-600">
              View all orders
            </Link>
          </section>

          <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Payment Instructions</p>
            <p className="mt-2 break-words text-[11px] leading-4 text-slate-600">
              Contact your distributor for payment methods: Cash, Bank transfer, UPI, Cheque. Payments will be recorded by Admin and reflected here.
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}
