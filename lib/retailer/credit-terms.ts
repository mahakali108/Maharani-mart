/**
 * Credit payment terms (Net-N) — pure helpers for due dates and payment
 * status. No Supabase access: the pages pass in the REAL ledger entries and
 * the authoritative outstanding, and these functions derive the due date.
 *
 * Derivation rule (documented, deterministic, testable):
 *   Payments (credits) are applied FIRST-IN, FIRST-OUT to the oldest
 *   outstanding debit — the standard B2B ageing rule. The DUE DATE is then
 *   `oldest still-outstanding debit date + terms days`. The frozen
 *   pre-ledger opening baseline (migration 0031) counts as the oldest
 *   possible debit, dated at the credit account's creation date.
 *
 * Nothing is invented: with no terms configured there is NO due date, and
 * with no outstanding balance there is nothing due.
 */

import {
  indiaAddDaysToKey,
  indiaCalendarDateKey,
  indiaDiffDays,
  indiaTodayDateKey,
  type TimestampInput,
} from '@/lib/datetime/india';

export interface CreditTermEntry {
  created_at: TimestampInput;
  amount_paise: number;
  direction: 'debit' | 'credit';
  transaction_type: string;
  is_reversed: boolean;
}

export interface OldestOutstandingResult {
  /** Asia/Kolkata calendar key (YYYY-MM-DD) of the oldest unpaid debit. */
  baseDateKey: string;
  /** Paise of the (possibly partially paid) oldest unpaid debit. */
  amountPaise: number;
  /** True when the anchor is the frozen pre-ledger opening baseline. */
  fromOpeningBaseline: boolean;
}

interface QueueItem {
  dateKey: string;
  amountPaise: number;
  fromOpeningBaseline: boolean;
}

/**
 * Walks the ledger chronologically, applying credits FIFO to the oldest
 * unpaid debits, and returns the oldest debit that is still (partially)
 * outstanding — or null when the balance is fully cleared.
 */
export function findOldestOutstandingDebit(
  entries: CreditTermEntry[],
  openingOutstandingPaise: number,
  accountCreatedAt: TimestampInput
): OldestOutstandingResult | null {
  const queue: QueueItem[] = [];
  if (openingOutstandingPaise > 0) {
    queue.push({
      dateKey: indiaCalendarDateKey(accountCreatedAt) ?? '',
      amountPaise: openingOutstandingPaise,
      fromOpeningBaseline: true,
    });
  }

  const eligible = entries
    .filter(
      (entry): entry is CreditTermEntry & { created_at: string | number | Date } =>
        entry.created_at !== null && entry.created_at !== undefined &&
        !entry.is_reversed &&
        entry.transaction_type !== 'CREDIT_LIMIT_CHANGE' &&
        entry.amount_paise > 0
    )
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  for (const entry of eligible) {
    const dateKey = indiaCalendarDateKey(entry.created_at);
    if (dateKey === null) continue; // unparseable timestamps can't anchor a date
    if (entry.direction === 'debit') {
      queue.push({ dateKey, amountPaise: entry.amount_paise, fromOpeningBaseline: false });
    } else {
      // FIFO: the newest credit pays the OLDEST unpaid items first.
      let remaining = entry.amount_paise;
      while (remaining > 0) {
        const head = queue[0];
        if (!head) break;
        if (head.amountPaise <= remaining) {
          remaining -= head.amountPaise;
          queue.shift();
        } else {
          head.amountPaise -= remaining;
          remaining = 0;
        }
      }
    }
  }

  const head = queue[0];
  if (!head || head.amountPaise <= 0) return null;
  if (!head.dateKey) return null; // opening baseline without a usable account date
  return { baseDateKey: head.dateKey, amountPaise: head.amountPaise, fromOpeningBaseline: head.fromOpeningBaseline };
}

export type CreditPaymentStatus = 'no_terms' | 'no_due' | 'on_track' | 'due_soon' | 'overdue';

export interface CreditDueDateInput {
  entries: CreditTermEntry[];
  /** Authoritative outstanding in paisa (from the wallet RPC). */
  outstandingPaise: number;
  /** Frozen pre-ledger baseline in paisa (0 when none). */
  openingOutstandingPaise: number;
  accountCreatedAt: TimestampInput;
  /** Net-N days, or null when the distributor has not set terms. */
  termsDays: number | null;
  now: Date;
}

export interface CreditDueDateResult {
  termsDays: number | null;
  status: CreditPaymentStatus;
  /** Due date (YYYY-MM-DD) — null when nothing is due or no terms set. */
  dueDateKey: string | null;
  /** Negative = overdue days, 0 = due today, positive = days remaining. */
  daysUntilDue: number | null;
  /** "Net 15 days" style label; null when no terms. */
  termsLabel: string | null;
}

/** "Net 15 days" / "Net 30 days" / "Due on order" — from a real terms value. */
export function formatTermsLabel(termsDays: number | null): string | null {
  if (termsDays === null) return null;
  if (termsDays === 0) return 'Due on order';
  return `Net ${termsDays} days`;
}

export function creditPaymentStatusFromDueDate(daysUntilDue: number): CreditPaymentStatus {
  if (daysUntilDue < 0) return 'overdue';
  if (daysUntilDue <= 7) return 'due_soon';
  return 'on_track';
}

export function computeCreditDueDate(input: CreditDueDateInput): CreditDueDateResult {
  const { termsDays } = input;
  const termsLabel = formatTermsLabel(termsDays);

  if (termsDays === null) {
    return { termsDays: null, status: 'no_terms', dueDateKey: null, daysUntilDue: null, termsLabel: null };
  }

  const hasOutstanding = input.outstandingPaise > 0;
  if (!hasOutstanding) {
    return { termsDays, status: 'no_due', dueDateKey: null, daysUntilDue: null, termsLabel };
  }

  const oldest = findOldestOutstandingDebit(
    input.entries,
    input.openingOutstandingPaise,
    input.accountCreatedAt
  );
  const baseDateKey = oldest?.baseDateKey ?? null;
  if (!baseDateKey) {
    // Outstanding exists but no dated anchor is available (e.g. legacy data
    // with only the frozen baseline and no account row) — report the status
    // without inventing a date.
    return { termsDays, status: 'on_track', dueDateKey: null, daysUntilDue: null, termsLabel };
  }

  const dueDateKey = indiaAddDaysToKey(baseDateKey, termsDays);
  if (!dueDateKey) {
    return { termsDays, status: 'on_track', dueDateKey: null, daysUntilDue: null, termsLabel };
  }

  const daysUntilDue = indiaDiffDays(indiaTodayDateKey(input.now), dueDateKey);
  if (daysUntilDue === null) {
    return { termsDays, status: 'on_track', dueDateKey, daysUntilDue: null, termsLabel };
  }

  return {
    termsDays,
    status: creditPaymentStatusFromDueDate(daysUntilDue),
    dueDateKey,
    daysUntilDue,
    termsLabel,
  };
}
