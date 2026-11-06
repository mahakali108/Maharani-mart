import Link from 'next/link';
import { ArrowLeft, ChevronRight, Coins, ReceiptText, Clock } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { formatInr, paiseToRupees } from '@/lib/retailer/format';
import { formatIndiaDateTime } from '@/lib/datetime/india';
import {
  getRetailerWalletSummary,
  getRetailerLedger,
  getRetailerLedgerBatch,
  formatPaise,
  type WalletTransaction,
} from '@/lib/retailer/wallet';
import { WalletLedgerList } from '@/components/retailer/wallet-ledger-list';
import { readCursor } from '@/lib/infinite-scroll/keyset';
import { loadRetailerLedger } from '@/lib/retailer/ledger';
import { coinBalancePaise, COIN_SYMBOL } from '@/lib/coins/math';

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending confirmation',
  confirmed: 'Confirmed',
  processing: 'Processing',
  packed: 'Packed',
  dispatched: 'On the way',
  delivered: 'Delivered',
  returned: 'Returned',
};

/**
 * 🪙 COIN HISTORY.
 *
 * The retailer's money screen: the coin balance, what has been spent and added,
 * and the full ledger behind it. Maharani Traders offers no retailer credit, so
 * there is no credit limit, no outstanding-due warning and no Net-15/Net-30
 * terms here.
 *
 * History is preserved intact: every historical credit-era row still renders in
 * the ledger (read-only, never rewritten) — only the framing is coins now.
 */
export default async function RetailerCoinHistoryPage() {
  const user = await requireUser();
  const supabase = (await createClient());

  const [walletSummary, walletLedger, legacyLedger, fullLedger] = await Promise.all([
    getRetailerWalletSummary(supabase, user.id),
    getRetailerLedgerBatch(supabase, user.id, null),
    // Legacy order activity: kept for backward compatibility, unchanged.
    loadRetailerLedger(supabase, user.id, 1),
    // Ledger totals are computed from the recorded rows only — never estimated.
    getRetailerLedger(supabase, user.id, 1000),
  ]);

  const balancePaise = coinBalancePaise(walletSummary.creditLimitPaise, walletSummary.outstandingPaise);
  const spentPaise = fullLedger
    .filter((entry) => entry.transaction_type === 'ORDER_DEBIT' && !entry.is_reversed)
    .reduce((sum, entry) => sum + entry.amount_paise, 0);
  const addedPaise = fullLedger
    .filter((entry) => entry.direction === 'credit' && !entry.is_reversed)
    .reduce((sum, entry) => sum + entry.amount_paise, 0);

  /** Server Action for ledger batches 2..n; the retailer id is re-derived. */
  async function loadMoreLedger(
    cursor: string | null
  ): Promise<{ items: WalletTransaction[]; nextCursor: string | null }> {
    'use server';
    const caller = await requireUser();
    const batch = await getRetailerLedgerBatch((await createClient()), caller.id, readCursor(cursor));
    return { items: batch.entries, nextCursor: batch.nextCursor };
  }

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
        <span className="min-w-0 flex-1 truncate text-slate-800">{COIN_SYMBOL} Coins</span>
      </nav>

      <div className="min-w-0">
        <p className="shop-eyebrow">Your coins</p>
        <h1 className="shop-heading mt-1 break-words font-semibold tracking-tight text-slate-950">
          {COIN_SYMBOL} Coins
        </h1>
        <p className="mt-1 break-words text-xs text-slate-500">
          {legacyLedger.account?.shopName ?? 'Your account'} · coin balance, coins spent, coins added and every ledger
          entry
        </p>
      </div>

      {/* Balance cards — mobile-first, 320px safe, no overflow */}
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="min-w-0 rounded-2xl border border-amber-200 bg-amber-50/60 p-4 shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-wider text-amber-700">{COIN_SYMBOL} Coins available</p>
          <p className="mt-1 break-words text-xl font-bold tracking-tight text-slate-950">{formatPaise(balancePaise)}</p>
          <p className="mt-1 text-[10px] text-slate-500">Spendable on your next order (1 coin = ₹1)</p>
        </div>
        <div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Coins spent</p>
          <p className="mt-1 break-words text-xl font-bold tracking-tight text-slate-950">{formatPaise(spentPaise)}</p>
          <p className="mt-1 text-[10px] text-slate-500">Sum of your order deductions</p>
        </div>
        <div className="min-w-0 rounded-2xl border border-mint-200 bg-mint-50/60 p-4 shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-wider text-mint-700">Coins added</p>
          <p className="mt-1 break-words text-xl font-bold tracking-tight text-mint-700">{formatPaise(addedPaise)}</p>
          <p className="mt-1 text-[10px] text-slate-500">Top-ups, refunds and coin funding</p>
        </div>
      </div>

      <div className="grid min-w-0 grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-6">
        <div className="min-w-0 space-y-4">
          {/* Coin ledger — real data only; added/spent are visually distinguishable */}
          <section className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex min-w-0 items-center justify-between gap-3 border-b border-slate-100 bg-slate-50 px-4 py-3.5 sm:px-5">
              <div className="flex min-w-0 items-center gap-2">
                <Coins className="h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
                <div className="min-w-0">
                  <h2 className="break-words text-sm font-bold text-slate-900">Coin transactions</h2>
                  <p className="mt-0.5 break-words text-[10px] text-slate-500">
                    {walletLedger.total} entr{walletLedger.total === 1 ? 'y' : 'ies'} · recorded data only
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
                  <h2 className="break-words text-sm font-bold text-slate-900">Order activity</h2>
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
                      <Link
                        href={`/retailer/orders/${entry.orderId}`}
                        className="min-w-0 truncate font-mono text-xs font-bold text-slate-900 hover:text-primary-600"
                      >
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
            <Link
              href="/retailer/orders"
              className="flex h-10 items-center justify-center border-t border-slate-100 bg-slate-50 text-[10px] font-bold text-primary-600"
            >
              View all orders
            </Link>
          </section>
        </div>

        <aside className="min-w-0 space-y-4 lg:sticky lg:top-36">
          <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">How coins work</p>
            <ul className="mt-2.5 space-y-2 text-[11px] leading-4 text-slate-600">
              <li className="flex gap-2">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-amber-500" aria-hidden="true" />
                <span className="min-w-0 break-words">
                  Coins are added by your distributor and spent on orders — 1 coin = ₹1.
                </span>
              </li>
              <li className="flex gap-2">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-amber-500" aria-hidden="true" />
                <span className="min-w-0 break-words">
                  At checkout the server applies min(your coins, order total). Anything left is payable on delivery.
                </span>
              </li>
              <li className="flex gap-2">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-amber-500" aria-hidden="true" />
                <span className="min-w-0 break-words">
                  Cancelled or returned orders refund the coins that were spent — exactly once.
                </span>
              </li>
            </ul>
            <div className="mt-3 space-y-2 rounded-xl bg-slate-50 p-3 text-[10px] leading-4 text-slate-600">
              <p>
                <strong>{COIN_SYMBOL} Coins available:</strong>{' '}
                {formatInr(paiseToRupees(balancePaise))}
              </p>
              <p>
                <strong>Coins spent:</strong> {formatPaise(spentPaise)}
              </p>
              <p>
                <strong>Coins added:</strong> {formatPaise(addedPaise)}
              </p>
            </div>
            <Link
              href="/retailer/orders"
              className="mt-3.5 flex h-9 items-center justify-center rounded-lg border border-slate-200 text-[10px] font-bold text-slate-700 hover:border-primary-200 hover:text-primary-600"
            >
              View all orders
            </Link>
          </section>

          <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Payments</p>
            <p className="mt-2 break-words text-[11px] leading-4 text-slate-600">
              Contact your distributor for payment methods: Cash, bank transfer, UPI or cheque. Payments recorded by
              the distributor appear here as coins added. No hidden balances.
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}
