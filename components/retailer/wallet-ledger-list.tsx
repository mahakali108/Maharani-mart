'use client';

/**
 * The retailer's wallet transaction history.
 *
 * It renders the SAME entries twice — a card list on phones, a table from `lg`
 * up — so it owns its rows as DATA (via the shared `useInfiniteList`) rather
 * than as pre-rendered markup. Scrolling appends to both layouts at once, and
 * the "N transactions · real data only" heading stays honest because the total
 * is counted once, server-side, with the first batch.
 */

import Link from 'next/link';
import { ArrowDownCircle, ArrowUpCircle, WalletCards } from 'lucide-react';
import { InfiniteScrollStatus, useInfiniteList } from '@/components/ui/infinite-scroll';
import { formatInr } from '@/lib/retailer/format';
import { formatIndiaDateTime } from '@/lib/datetime/india';
import { paiseToRupees } from '@/lib/retailer/format';
import type { WalletTransaction } from '@/lib/retailer/wallet';

/**
 * Ledger row labels, in coin language. Transaction types are the historical
 * database vocabulary and are never rewritten — only how they read.
 */
const TX_TYPE_LABELS: Record<string, string> = {
  ORDER_DEBIT: 'Coins spent',
  PAYMENT_CREDIT: 'Coins added',
  REFUND_CREDIT: 'Coins refunded',
  MANUAL_CREDIT: 'Coins added',
  MANUAL_DEBIT: 'Coins removed',
  ORDER_REVERSAL: 'Coins refunded',
  ADJUSTMENT: 'Coin adjustment',
  CREDIT_LIMIT_CHANGE: 'Coins funded',
};

export type WalletLedgerLoader = (
  cursor: string | null
) => Promise<{ items: WalletTransaction[]; nextCursor: string | null }>;

export function WalletLedgerList({
  entries,
  loader,
  initialCursor,
  initialHasMore,
}: {
  entries: WalletTransaction[];
  loader: WalletLedgerLoader;
  initialCursor: string | null;
  initialHasMore: boolean;
}) {
  const list = useInfiniteList<WalletTransaction>({ loader, initialCursor, initialHasMore });

  const rows = [...entries];
  const seen = new Set(rows.map((entry) => entry.id));
  for (const entry of list.items) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    rows.push(entry);
  }

  return (
    <>
      {rows.length === 0 ? (
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
            Browse products
          </Link>
        </div>
      ) : (
        <>
          {/* Mobile list */}
          <ul className="divide-y divide-slate-100 lg:hidden">
            {rows
              .filter((entry) => entry.transaction_type !== 'CREDIT_LIMIT_CHANGE')
              .map((entry) => {
                const isDebit = entry.direction === 'debit';
                const amount = paiseToRupees(entry.amount_paise);
                return (
                  <li key={entry.id} className="min-w-0 px-4 py-3.5">
                    <div className="flex min-w-0 items-start justify-between gap-3">
                      <div className="flex min-w-0 items-start gap-2.5">
                        <span
                          className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                            isDebit ? 'bg-primary-50 text-primary-600' : 'bg-mint-50 text-mint-600'
                          }`}
                        >
                          {isDebit ? <ArrowUpCircle className="h-4 w-4" /> : <ArrowDownCircle className="h-4 w-4" />}
                        </span>
                        <div className="min-w-0">
                          <p className="break-words text-xs font-bold text-slate-900">
                            {TX_TYPE_LABELS[entry.transaction_type] ?? entry.transaction_type}
                          </p>
                          <p className="mt-0.5 break-words text-[10px] leading-4 text-slate-500">{entry.description}</p>
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
                          isDebit ? 'text-primary-700' : 'text-mint-700'
                        }`}
                      >
                        {isDebit ? '-' : '+'}
                        {formatInr(amount)}
                      </p>
                    </div>
                  </li>
                );
              })}
            {list.loading
              ? [0, 1, 2].map((index) => (
                  <li key={`loading-${index}`} aria-hidden="true" className="px-4 py-3.5">
                    <div className="flex items-start gap-2.5">
                      <span className="h-7 w-7 shrink-0 animate-pulse rounded-full bg-slate-100" />
                      <div className="min-w-0 flex-1 space-y-2">
                        <span className="block h-3 w-24 animate-pulse rounded bg-slate-100" />
                        <span className="block h-3 w-40 animate-pulse rounded bg-slate-100" />
                      </div>
                    </div>
                  </li>
                ))
              : null}
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
              {rows
                .filter((entry) => entry.transaction_type !== 'CREDIT_LIMIT_CHANGE')
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
                            isDebit ? 'bg-primary-50 text-primary-700' : 'bg-mint-50 text-mint-700'
                          }`}
                        >
                          {isDebit ? <ArrowUpCircle className="h-3 w-3" /> : <ArrowDownCircle className="h-3 w-3" />}
                          {TX_TYPE_LABELS[entry.transaction_type] ?? entry.transaction_type}
                        </span>
                      </td>
                      <td className="max-w-[260px] truncate px-5 py-3 text-slate-700">{entry.description}</td>
                      <td
                        className={`px-5 py-3 text-right font-bold ${
                          isDebit ? 'text-primary-700' : 'text-mint-700'
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
              {list.loading
                ? [0, 1, 2].map((index) => (
                    <tr key={`loading-${index}`} aria-hidden="true">
                      {[0, 1, 2, 3, 4].map((cell) => (
                        <td key={cell} className="px-5 py-3">
                          <span className="block h-3 animate-pulse rounded bg-slate-100" />
                        </td>
                      ))}
                    </tr>
                  ))
                : null}
            </tbody>
          </table>

          <InfiniteScrollStatus
            state={list}
            endLabel="No more transactions"
            loadingLabel="Loading more transactions…"
            className="border-t border-slate-100 bg-slate-50/60"
          />
        </>
      )}
    </>
  );
}
