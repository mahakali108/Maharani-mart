import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 🪙 0053 — the order-coin refund function.
 *
 * Refunds have to work when the RETAILER cancels their own order or when STAFF
 * records a return, but `retailer_wallet_ledger` only grants INSERT/UPDATE to
 * admins (0029). Opening that table to retailers would let a shop mint coins
 * for itself, so the fix is one narrow SECURITY DEFINER function.
 *
 * These assertions pin the security shape of that migration: additive only,
 * authenticated-only, self-authorized, status-guarded and idempotent.
 */

const root = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');
const MIGRATION = 'supabase/migrations/0053_order_coin_refund.sql';
const migration = read(MIGRATION);
const reversal = read('lib/orders/wallet-reversal.ts');

/** Strip `--` comments so wording in a comment cannot satisfy an assertion. */
const sql = migration.replace(/--.*$/gm, '');

describe('0053 is a new, additive migration', () => {
  it('keeps 0053 unique and places the additive 0054 migration after it', () => {
    const files = readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql'));
    const numbered = files.map((f) => Number(f.slice(0, 4))).filter((n) => Number.isFinite(n));
    // Highest migration is 0060 (supplier application rate limit). Keep this in step
    // with each new migration; the 0053 uniqueness and ordering checks below are the point.
    expect(Math.max(...numbered)).toBe(60);
    expect(files.filter((f) => f.startsWith('0053'))).toHaveLength(1);
    expect(files.filter((f) => f.startsWith('0054'))).toHaveLength(1);
    expect(files.filter((f) => f.startsWith('0056'))).toHaveLength(1);
    expect(numbered.indexOf(56)).toBeGreaterThan(numbered.indexOf(55));
    expect(files.filter((f) => f.startsWith('0055'))).toHaveLength(1);
  });

  it('drops nothing, alters nothing and touches no policy', () => {
    expect(sql).not.toMatch(/drop\s+table/i);
    expect(sql).not.toMatch(/drop\s+column/i);
    expect(sql).not.toMatch(/drop\s+policy/i);
    expect(sql).not.toMatch(/alter\s+table/i);
    expect(sql).not.toMatch(/create\s+policy/i);
    expect(sql).not.toMatch(/\bdelete\s+from\b/i);
    expect(sql).not.toMatch(/\bupdate\s+public\.\w+\s+set\s+(?!is_reversed)/i);
  });

  it('keeps the ledger table admin-only: it only adds one function', () => {
    const ledger = read('supabase/migrations/0029_retailer_wallet_ledger.sql');
    expect(ledger).toContain('wallet_ledger_admin_insert');
    expect(ledger).toContain('wallet_ledger_admin_update');
    // The migration never loosens those policies.
    expect(sql).not.toMatch(/wallet_ledger_admin_insert/);
    expect(sql).not.toMatch(/wallet_ledger_admin_update/);
  });
});

describe('the refund function is self-authorizing and idempotent', () => {
  it('is SECURITY DEFINER with a fixed search_path', () => {
    expect(sql).toMatch(/security definer/i);
    expect(sql).toMatch(/set search_path = public/i);
  });

  it('lets only the order\u2019s own retailer, staff/admin, or an internal call through', () => {
    expect(sql).toMatch(/auth\.uid\(\) <> v_retailer_id/i);
    expect(sql).toMatch(/is_staff_or_above\(\)/i);
    expect(sql).toMatch(/errcode = '42501'/);
  });

  it('refunds only a cancelled or returned order', () => {
    expect(sql).toMatch(/v_status not in \('cancelled', 'returned'\)/i);
  });

  it('writes ONE reversal credit, linked and keyed deterministically', () => {
    expect(sql).toMatch(/'ORDER_REVERSAL'/);
    expect(sql).toMatch(/reversal_of/);
    expect(sql).toMatch(/'reversal:' \|\| v_debit\.id::text/);
    expect(sql).toMatch(/on conflict \(idempotency_key\) do nothing/i);
    // The credit and the "original reversed" flag move together.
    expect(sql).toMatch(/update public\.retailer_wallet_ledger[\s\S]{0,120}is_reversed = true/i);
  });

  it('never refunds a delivered or in-flight order, and never more than was spent', () => {
    expect(sql).toMatch(/v_debit\.amount_paise/);
    expect(sql).not.toMatch(/amount_paise\s*\+/);
    expect(sql).toMatch(/if not found or v_debit\.is_reversed then\s*\n\s*return 0/i);
  });

  it('is executable by authenticated and service_role, never by anon or public', () => {
    expect(sql).toMatch(/revoke all on function public\.refund_order_coins\([^)]*\) from public/i);
    expect(sql).toMatch(/revoke all on function public\.refund_order_coins\([^)]*\) from anon/i);
    expect(sql).toMatch(/grant execute on function public\.refund_order_coins\([^)]*\) to authenticated/i);
    expect(sql).toMatch(/grant execute on function public\.refund_order_coins\([^)]*\) to service_role/i);
    expect(sql).not.toMatch(/grant execute[^;]*to anon/i);
  });
});

describe('the shortfall function (missing/damaged at delivery)', () => {
  it('is bounded by the order total and keyed to the delivery', () => {
    expect(sql).toMatch(/p_amount_paise > v_grand_total_paise/);
    expect(sql).toMatch(/'delivery-shortfall:' \|\| p_delivery_id::text/);
    expect(sql).toMatch(/on conflict \(idempotency_key\) do nothing/i);
  });

  it('refunds in coins for the delivery team only, reversibly and once', () => {
    expect(sql).toMatch(/public\.is_staff_or_above\(\)/);
    expect(sql).toMatch(/auth\.uid\(\) <> v_delivery_actor/);
    expect(sql).toMatch(/from public\.order_deliveries d/);
    expect(sql).toMatch(/if p_reverse then/);
    expect(sql).toMatch(/and is_reversed = false\s*\n\s*returning \* into/i);
    expect(sql).toMatch(/grant execute on function public\.order_shortfall_coins\([^)]*\) to authenticated/i);
    expect(sql).not.toMatch(/grant execute[^;]*order_shortfall_coins[^;]*to anon/i);
  });
});

describe('the app uses the functions', () => {
  it('settles a delivery shortfall through the function with a fallback', () => {
    const delivery = read('lib/delivery/delivery-actions.ts');
    expect(delivery).toContain("rpc('order_shortfall_coins'");
    expect(delivery).toMatch(/p_amount_paise: settlement\.creditBackPaise/);
    expect(delivery).toMatch(/p_reverse: true/);
    expect(delivery).toContain('`delivery-shortfall:${delivery.id}`');
  });

  it('calls refund_order_coins with the order, reason and actor', () => {
    expect(reversal).toContain("rpc('refund_order_coins'");
    expect(reversal).toMatch(/p_order_id: orderId/);
    expect(reversal).toMatch(/p_reason: reason/);
    expect(reversal).toMatch(/p_created_by: createdBy/);
  });

  it('falls back to the direct write only when the function is absent', () => {
    expect(reversal).toMatch(/does not exist\|could not find the function\|schema cache/i);
    // A real error (for example an authorization failure) must surface.
    expect(reversal).toMatch(/return \{ error: rpcResult\.error\.message \}/);
    expect(reversal).toContain('reversalIdempotencyKey(original.id)');
  });
});
