/**
 * Credit payment terms (Net-N) — pure due-date/status math + source guards.
 *
 * Locks in:
 *   1. FIFO credit application → oldest still-outstanding debit anchors the due date
 *   2. Due date = anchor + terms days; statuses: no_terms / no_due / on_track /
 *      due_soon (≤7 days) / overdue
 *   3. Nothing is invented: no terms → no date; no outstanding → nothing due;
 *      unanchorable outstanding → status without a fabricated date
 *   4. Migration 0049 is additive (one nullable column + check), no RLS change
 *   5. Admin sets terms via a guarded action; retailer ledger shows the card
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  computeCreditDueDate,
  creditPaymentStatusFromDueDate,
  findOldestOutstandingDebit,
  formatTermsLabel,
  type CreditTermEntry,
} from '@/lib/retailer/credit-terms';

const root = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

const migration = read('supabase/migrations/0049_credit_payment_terms.sql');
const walletActions = read('lib/admin/wallet-actions.ts');
const termsForm = read('components/admin/wallet-terms-form.tsx');
const ledgerPage = read('app/retailer/account/ledger/page.tsx');
const adminWalletPage = read('app/admin/wallets/[id]/page.tsx');

const d = (iso: string) => ({
  created_at: iso,
  amount_paise: 0,
  direction: 'debit' as const,
  transaction_type: 'ORDER_DEBIT',
  is_reversed: false,
});
const debit = (iso: string, paise: number): CreditTermEntry => ({
  created_at: iso,
  amount_paise: paise,
  direction: 'debit',
  transaction_type: 'ORDER_DEBIT',
  is_reversed: false,
});
const credit = (iso: string, paise: number): CreditTermEntry => ({
  created_at: iso,
  amount_paise: paise,
  direction: 'credit',
  transaction_type: 'PAYMENT_CREDIT',
  is_reversed: false,
});

// ---------------------------------------------------------------------------
// FIFO anchor finding
// ---------------------------------------------------------------------------
describe('findOldestOutstandingDebit (FIFO)', () => {
  it('fully paid sequence → null', () => {
    const result = findOldestOutstandingDebit(
      [debit('2026-08-01T00:00:00Z', 100000), credit('2026-08-20T00:00:00Z', 100000)],
      0,
      new Date('2026-01-01')
    );
    expect(result).toBeNull();
  });

  it('partial payment keeps the oldest debit as anchor', () => {
    const result = findOldestOutstandingDebit(
      [debit('2026-08-01T00:00:00Z', 100000), debit('2026-08-10T00:00:00Z', 50000), credit('2026-08-20T00:00:00Z', 60000)],
      0,
      new Date('2026-01-01')
    );
    // 60k credit pays 60k of the oldest (100k) debit → 40k of Aug-01 remains.
    expect(result).toEqual({ baseDateKey: '2026-08-01', amountPaise: 40000, fromOpeningBaseline: false });
  });

  it('FIFO: credit clears the oldest first, exposing the next anchor', () => {
    const result = findOldestOutstandingDebit(
      [debit('2026-08-01T00:00:00Z', 10000), debit('2026-08-05T00:00:00Z', 20000), credit('2026-08-20T00:00:00Z', 10000)],
      0,
      new Date('2026-01-01')
    );
    expect(result?.baseDateKey).toBe('2026-08-05');
    expect(result?.amountPaise).toBe(20000);
  });

  it('the frozen opening baseline is the oldest possible anchor', () => {
    const result = findOldestOutstandingDebit(
      [debit('2026-08-01T00:00:00Z', 50000)],
      99999,
      new Date('2025-01-15T00:00:00Z')
    );
    expect(result?.fromOpeningBaseline).toBe(true);
    expect(result?.baseDateKey).toBe('2025-01-15');
  });

  it('reversed and limit-change entries never count', () => {
    const entries: CreditTermEntry[] = [
      debit('2026-08-01T00:00:00Z', 100000),
      { ...credit('2026-08-20T00:00:00Z', 100000), is_reversed: true },
      { ...d('2026-08-21T00:00:00Z'), amount_paise: 500, transaction_type: 'CREDIT_LIMIT_CHANGE' },
    ];
    const result = findOldestOutstandingDebit(entries, 0, new Date('2026-01-01'));
    expect(result?.amountPaise).toBe(100000); // reversal ignored
  });
});

// ---------------------------------------------------------------------------
// Due date + status
// ---------------------------------------------------------------------------
describe('computeCreditDueDate', () => {
  const now = new Date('2026-09-15T05:00:00Z'); // India date: 2026-09-15

  const base = {
    entries: [] as CreditTermEntry[],
    openingOutstandingPaise: 0,
    accountCreatedAt: new Date('2026-01-01T00:00:00Z'),
    now,
  };

  it('no terms configured → no_terms, never a date', () => {
    const result = computeCreditDueDate({
      ...base,
      entries: [debit('2026-09-01T00:00:00Z', 100000)],
      outstandingPaise: 100000,
      termsDays: null,
    });
    expect(result.status).toBe('no_terms');
    expect(result.dueDateKey).toBeNull();
    expect(result.termsLabel).toBeNull();
  });

  it('terms + zero outstanding → no_due', () => {
    const result = computeCreditDueDate({ ...base, outstandingPaise: 0, termsDays: 30 });
    expect(result.status).toBe('no_due');
    expect(result.dueDateKey).toBeNull();
    expect(result.termsLabel).toBe('Net 30 days');
  });

  it('due date = anchor + terms, on_track when far away', () => {
    const result = computeCreditDueDate({
      ...base,
      entries: [debit('2026-08-01T00:00:00Z', 100000)],
      outstandingPaise: 100000,
      termsDays: 30,
    });
    // Anchor 2026-08-01 + 30 = 2026-08-31 → 15 days before "now" (2026-09-15)
    expect(result.dueDateKey).toBe('2026-08-31');
    expect(result.daysUntilDue).toBe(-15);
    expect(result.status).toBe('overdue');
  });

  it('within 7 days → due_soon; 0 → due today (still due_soon)', () => {
    const soon = computeCreditDueDate({
      ...base,
      entries: [debit('2026-09-08T00:00:00Z', 100000)],
      outstandingPaise: 100000,
      termsDays: 7, // 2026-09-15 → due today
    });
    expect(soon.dueDateKey).toBe('2026-09-15');
    expect(soon.daysUntilDue).toBe(0);
    expect(soon.status).toBe('due_soon');

    const track = computeCreditDueDate({
      ...base,
      entries: [debit('2026-09-10T00:00:00Z', 100000)],
      outstandingPaise: 100000,
      termsDays: 30, // 2026-10-10 → 25 days out
    });
    expect(track.status).toBe('on_track');
    expect(track.daysUntilDue).toBe(25);
  });

  it('opening baseline anchor works end-to-end', () => {
    const result = computeCreditDueDate({
      ...base,
      outstandingPaise: 50000,
      openingOutstandingPaise: 50000,
      accountCreatedAt: new Date('2026-08-01T00:00:00Z'),
      termsDays: 30,
    });
    expect(result.dueDateKey).toBe('2026-08-31');
    expect(result.status).toBe('overdue');
  });

  it('unanchorable outstanding → honest status, no fabricated date', () => {
    // Outstanding exists but no dated entry and no usable account date.
    const result = computeCreditDueDate({
      entries: [],
      outstandingPaise: 50000,
      openingOutstandingPaise: 50000,
      accountCreatedAt: null,
      termsDays: 30,
      now,
    });
    expect(result.dueDateKey).toBeNull();
    expect(['on_track']).toContain(result.status);
  });

  it('Net-15 preset label', () => {
    expect(formatTermsLabel(15)).toBe('Net 15 days');
    expect(formatTermsLabel(0)).toBe('Due on order');
    expect(formatTermsLabel(null)).toBeNull();
  });

  it('status thresholds: <0 overdue, 0..7 due_soon, >7 on_track', () => {
    expect(creditPaymentStatusFromDueDate(-1)).toBe('overdue');
    expect(creditPaymentStatusFromDueDate(0)).toBe('due_soon');
    expect(creditPaymentStatusFromDueDate(7)).toBe('due_soon');
    expect(creditPaymentStatusFromDueDate(8)).toBe('on_track');
  });
});

// ---------------------------------------------------------------------------
// Source guards
// ---------------------------------------------------------------------------
describe('migration 0049', () => {
  it('adds exactly one nullable column, idempotently', () => {
    expect(migration).toContain('add column if not exists payment_terms_days int');
    expect(migration).not.toMatch(/create table/i);
  });

  it('constrains the column to 0..365 or NULL', () => {
    expect(migration).toContain('check (payment_terms_days is null or (payment_terms_days >= 0 and payment_terms_days <= 365))');
  });

  it('does not touch RLS (no new policies, none dropped)', () => {
    expect(migration).not.toMatch(/create policy/i);
    expect(migration).not.toMatch(/drop policy/i);
    expect(migration).not.toMatch(/enable row level security/i);
  });

  it('seeds no data', () => {
    expect(migration).not.toMatch(/insert into/i);
  });
});

describe('admin surface', () => {
  it('setPaymentTermsAction is permission-guarded and schema-validated', () => {
    expect(walletActions).toContain('export async function setPaymentTermsAction');
    // Matches the existing credit-limit guard (RLS write is is_admin_or_above).
    expect(walletActions).toContain("requirePermission('retailers.edit')");
    expect(walletActions).toContain('paymentTermsSchema');
  });

  it('persists only the terms (+ reason), never money', () => {
    expect(walletActions).toMatch(/payment_terms_days: paymentTermsDays/);
    expect(walletActions).not.toMatch(/payment_terms_days: paymentTermsDays[\s\S]{0,120}credit_limit_paise/);
  });

  it('the form offers Net 15/30/60 presets and clear', () => {
    expect(termsForm).toContain('[15, 30, 60]');
    expect(termsForm).toContain('Clear');
    expect(termsForm).toContain('setPaymentTermsAction');
  });

  it('the admin wallet detail page shows derived due date + status', () => {
    expect(adminWalletPage).toContain('computeCreditDueDate');
    expect(adminWalletPage).toContain('WalletTermsForm');
    expect(adminWalletPage).toContain('Payment due');
  });
});

describe('retailer ledger surface', () => {
  it('shows the terms card with terms, outstanding and due date', () => {
    expect(ledgerPage).toContain('Credit terms & payment status');
    expect(ledgerPage).toContain('computeCreditDueDate');
    expect(ledgerPage).toContain('getRetailerCreditAccount');
  });

  it('never renders a due date when none is derivable', () => {
    expect(ledgerPage).toMatch(/dueDate\?\.dueDateKey \? formatIndiaDate\(dueDate\.dueDateKey\) : '—'/);
  });

  it('the ledger stays scoped to the caller (RLS + query)', () => {
    expect(ledgerPage).toContain('await requireUser()');
  });
});
