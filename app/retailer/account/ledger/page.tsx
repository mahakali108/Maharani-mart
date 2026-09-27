import Link from 'next/link';
import { ArrowLeft, ChevronRight, Info, ReceiptText, Clock, CalendarClock } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { formatInr } from '@/lib/retailer/format';
import { formatIndiaDate, formatIndiaDateTime } from '@/lib/datetime/india';
import {
  getRetailerCreditAccount,
  getRetailerWalletSummary,
  getRetailerLedger,
  getRetailerLedgerBatch,
  formatPaise,
  type WalletTransaction,
} from '@/lib/retailer/wallet';
import { WalletLedgerList } from '@/components/retailer/wallet-ledger-list';
import { readCursor } from '@/lib/infinite-scroll/keyset';
import { computeCreditDueDate, type CreditPaymentStatus } from '@/lib/retailer/credit-terms';
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

const PAYMENT_STATUS_META: Record<
  CreditPaymentStatus,
  { label: string; className: string }
> = {
  no_terms: { label: 'Terms not set', className: 'bg-slate-100 text-slate-600' },
  no_due: { label: 'No payment due', className: 'bg-emerald-50 text-emerald-700' },
  on_track: { label: 'On track', className: 'bg-emerald-50 text-emerald-700' },
  due_soon: { label: 'Due soon', className: 'bg-amber-50 text-amber-700' },
  overdue: { label: 'Overdue', className: 'bg-primary-50 text-primary-700' },
};

export default async function RetailerLedgerPage() {
  const user = await requireUser();
  const supabase = createClient();

  // New wallet system: authoritative summary from ledger + legacy
  const [walletSummary, walletLedger, legacyLedger, creditAccount, fullLedger] = await Promise.all([
    getRetailerWalletSummary(supabase, user.id),
    getRetailerLedgerBatch(supabase, user.id, null),
    // Legacy order activity: the first page of the old order-ledger view is
    // kept for backward compatibility, rendered exactly as before.
    loadRetailerLedger(supabase, user.id, 1),
    getRetailerCreditAccount(supabase, user.id),
    getRetailerLedger(supabase, user.id, 1000),
  ]);

  const hasConfiguredLimit = walletSummary.hasConfiguredLimit;

  /** Server Action for ledger batches 2..n; the retailer id is re-derived. */
  async function loadMoreLedger(
    cursor: string | null
  ): Promise<{ items: WalletTransaction[]; nextCursor: string | null }> {
    'use server';
    const caller = await requireUser();
    const batch = await getRetailerLedgerBatch(createClient(), caller.id, readCursor(cursor));
    return { items: batch.entries, nextCursor: batch.nextCursor };
  }

  // Credit terms + due date (real data only): the due date is derived from
  // the oldest still-outstanding ledger debit + the configured Net-N terms.
  const dueDate = creditAccount
    ? computeCreditDueDate({
        entries: fullLedger,
        outstandingPaise: walletSummary.outstandingPaise,
        openingOutstandingPaise: creditAccount.opening_outstanding_paise,
        accountCreatedAt: creditAccount.created_at,
        termsDays: creditAccount.payment_terms_days,
        now: new Date(),
      })
    : null;

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

      {/* Credit terms & payment status — derived from real ledger data only */}
      {creditAccount ? (
        <section className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50 px-4 py-3.5 sm:px-5">
            <div className="flex min-w-0 items-center gap-2">
              <CalendarClock className="h-4 w-4 shrink-0 text-primary-600" aria-hidden="true" />
              <div className="min-w-0">
                <h2 className="break-words text-sm font-bold text-slate-900">Credit terms &amp; payment status</h2>
                <p className="mt-0.5 break-words text-[10px] text-slate-500">
                  Due date = oldest unpaid order + your terms
                </p>
              </div>
            </div>
            <span
              className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold ${PAYMENT_STATUS_META[
                dueDate ? dueDate.status : 'no_terms'
              ].className}`}
            >
              {PAYMENT_STATUS_META[dueDate ? dueDate.status : 'no_terms'].label}
            </span>
          </div>
          <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-3 sm:p-5">
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Terms</p>
              <p className="mt-1 break-words text-sm font-bold text-slate-900">
                {dueDate?.termsLabel ?? 'Not set'}
              </p>
              <p className="mt-0.5 text-[10px] text-slate-500">Set by your distributor</p>
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Outstanding</p>
              <p className="mt-1 break-words text-sm font-bold text-slate-900">
                {formatPaise(walletSummary.outstandingPaise)}
              </p>
              <p className="mt-0.5 text-[10px] text-slate-500">Unpaid balance on your account</p>
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Payment due</p>
              <p className="mt-1 break-words text-sm font-bold text-slate-900">
                {dueDate?.dueDateKey ? formatIndiaDate(dueDate.dueDateKey) : '—'}
              </p>
              <p className="mt-0.5 text-[10px] text-slate-500">
                {dueDate === null || dueDate.status === 'no_terms'
                  ? 'No terms configured'
                  : dueDate.status === 'no_due'
                    ? 'Nothing due right now'
                    : dueDate.daysUntilDue !== null
                      ? dueDate.daysUntilDue < 0
                        ? `Overdue by ${Math.abs(dueDate.daysUntilDue)} day${Math.abs(dueDate.daysUntilDue) === 1 ? '' : 's'}`
                        : dueDate.daysUntilDue === 0
                          ? 'Due today'
                          : `${dueDate.daysUntilDue} day${dueDate.daysUntilDue === 1 ? '' : 's'} remaining`
                      : 'Date not available'}
              </p>
            </div>
          </div>
        </section>
      ) : null}

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

            <WalletLedgerList
              entries={walletLedger.entries}
              loader={loadMoreLedger}
              initialCursor={walletLedger.nextCursor}
              initialHasMore={Boolean(walletLedger.nextCursor)}
            />
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
