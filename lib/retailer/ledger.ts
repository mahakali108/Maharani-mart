import 'server-only';

import type { createClient } from '@/lib/supabase/server';
import { calculateCreditPosition, roundMoney, type CreditPosition } from '@/lib/orders/credit';

/**
 * Retailer financial ledger — built ONLY from rows that already exist.
 *
 * WHAT THE SCHEMA ACTUALLY SUPPORTS (audited across all 25 migrations)
 * --------------------------------------------------------------------
 * Real and readable by the retailer under existing RLS:
 *   - `retailers.credit_limit` and `retailers.outstanding_balance` — the
 *     authoritative account position.
 *   - `orders` — every real order the retailer placed, with its own
 *     subtotal / gst_total / grand_total and placed_at date.
 *
 * NOT PRESENT ANYWHERE in the schema:
 *   - no payments / receipts table (money coming IN is not itemised)
 *   - no adjustments or credit notes
 *   - no due date, payment terms (Net-15 / Net-30) or overdue flag
 *   - no `payment_method` on an order, so the schema does not record which
 *     orders were settled in cash and which were charged to credit
 *
 * CONSEQUENCE — and the reason this module does NOT compute a running balance:
 * `outstanding_balance` is a single number maintained by the order/ops flows.
 * Deriving a "balance after each row" from order charges alone would not
 * reconcile with it, because payments against those charges are never
 * recorded. Presenting such a column would be a fabricated financial figure,
 * so this ledger shows the authoritative position and the real order charges
 * side by side and states the limitation plainly in the UI.
 *
 * The safest path to a complete ledger is documented in
 * docs/retailer-enterprise-upgrade.md §4 (a `retailer_ledger_entries` table
 * written in the same transaction as the `outstanding_balance` update).
 *
 * SECURITY
 * --------
 * Every read goes through the caller's cookie-bound, RLS-scoped Supabase
 * client and is additionally filtered to `retailer_id`, so one retailer can
 * never see another retailer's orders or balance. Nothing here is cached: the
 * data is retailer-specific and authenticated.
 */

/** One real order row, presented as an account entry. */
export interface LedgerOrderEntry {
  orderId: string;
  orderNumber: string;
  placedAt: string;
  status: string;
  subtotal: number;
  gstTotal: number;
  grandTotal: number;
}

export interface LedgerAccount {
  shopName: string;
  status: string;
  creditLimit: number;
  outstandingBalance: number;
}

export interface LedgerData {
  account: LedgerAccount | null;
  entries: LedgerOrderEntry[];
  /** Total number of non-cancelled orders, for pagination. */
  totalEntries: number;
  /** Sum of the entries on THIS page only — never presented as a balance. */
  pageTotal: number;
  credit: CreditPosition | null;
}

/**
 * Orders that represent a real charge on the account. Cancelled orders never
 * became a liability, so they are excluded from the ledger rather than shown
 * as a zero — no row is invented either way.
 */
export const LEDGER_EXCLUDED_STATUSES = ['cancelled'] as const;

/** Page size for the ledger list. */
export const LEDGER_PAGE_SIZE = 25;

/**
 * Shown verbatim in the UI so the limitation is visible to the retailer
 * instead of being implied by a missing column.
 */
export const LEDGER_PAYMENT_GAP_NOTICE =
  'Payments and adjustments made against your account are recorded by your distributor and are not yet itemised in this app. The balance shown above is the authoritative one on your account; the list below is your real order history, not a running statement.';

/** Sums real order values to paise, using the shared money rounding. */
export function sumLedgerEntries(entries: Pick<LedgerOrderEntry, 'grandTotal'>[]): number {
  return roundMoney(entries.reduce((total, entry) => total + Number(entry.grandTotal || 0), 0));
}

/** Newest first — a statement reads downwards in time. */
export function sortLedgerEntries(entries: LedgerOrderEntry[]): LedgerOrderEntry[] {
  return [...entries].sort((a, b) => +new Date(b.placedAt) - +new Date(a.placedAt));
}

interface LedgerAccountRow {
  shop_name: string;
  status: string;
  credit_limit: number;
  outstanding_balance: number;
}

interface LedgerOrderRow {
  id: string;
  order_number: string;
  placed_at: string;
  status: string;
  subtotal: number;
  gst_total: number;
  grand_total: number;
}

/**
 * Loads the retailer's own account position and real order charges.
 *
 * @param page 1-based page of the entry list.
 */
export async function loadRetailerLedger(
  supabase: ReturnType<typeof createClient>,
  retailerId: string,
  page = 1
): Promise<LedgerData> {
  const safePage = Math.max(1, Math.floor(page));
  const from = (safePage - 1) * LEDGER_PAGE_SIZE;
  const to = from + LEDGER_PAGE_SIZE - 1;

  const [{ data: accountRow }, { data: orderRows, count }] = await Promise.all([
    supabase
      .from('retailers')
      .select('shop_name, status, credit_limit, outstanding_balance')
      .eq('id', retailerId)
      .maybeSingle<LedgerAccountRow>(),
    supabase
      .from('orders')
      .select('id, order_number, placed_at, status, subtotal, gst_total, grand_total', { count: 'exact' })
      .eq('retailer_id', retailerId)
      .not('status', 'in', `(${LEDGER_EXCLUDED_STATUSES.join(',')})`)
      .order('placed_at', { ascending: false })
      .range(from, to)
      .returns<LedgerOrderRow[]>(),
  ]);

  const entries = sortLedgerEntries(
    (orderRows ?? []).map((row) => ({
      orderId: row.id,
      orderNumber: row.order_number,
      placedAt: row.placed_at,
      status: row.status,
      subtotal: Number(row.subtotal || 0),
      gstTotal: Number(row.gst_total || 0),
      grandTotal: Number(row.grand_total || 0),
    }))
  );

  const account: LedgerAccount | null = accountRow
    ? {
        shopName: accountRow.shop_name,
        status: accountRow.status,
        creditLimit: Number(accountRow.credit_limit || 0),
        outstandingBalance: Number(accountRow.outstanding_balance || 0),
      }
    : null;

  return {
    account,
    entries,
    totalEntries: count ?? entries.length,
    pageTotal: sumLedgerEntries(entries),
    // The same single credit implementation used by checkout and the account
    // card, so the ledger can never disagree with them.
    credit: account
      ? calculateCreditPosition(account.creditLimit, account.outstandingBalance)
      : null,
  };
}
