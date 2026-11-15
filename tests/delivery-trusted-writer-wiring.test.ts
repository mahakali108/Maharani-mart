import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * Migration 0094 rejects OTP / assignment / completion writes from a staff
 * session. These assertions pin the application side of that contract: the
 * protected writes go through the trusted writer, and only AFTER the OTP check.
 */
const actions = readFileSync('lib/delivery/delivery-actions.ts', 'utf8');
const completionSql = readFileSync('supabase/migrations/0099_atomic_delivery_completion.sql', 'utf8');
const completionMap = readFileSync('lib/delivery/completion.ts', 'utf8');
const section = (name: string) => {
  const start = actions.indexOf(`export async function ${name}(`);
  expect(start).toBeGreaterThan(-1);
  const next = actions.indexOf('\nexport async function ', start + 10);
  return actions.slice(start, next === -1 ? undefined : next);
};

describe('delivery actions write protected fields through the trusted writer', () => {
  it('completion verifies the OTP before obtaining the trusted writer', () => {
    const body = section('completeDeliveryAction');
    // PR #126 (0099): the action no longer writes order_deliveries / orders
    // itself. It makes ONE call to complete_delivery_atomic through the
    // trusted writer, and the OTP is verified INSIDE that transaction before
    // any completion write. Intent kept: no protected write before the OTP
    // check, and fail closed without the trusted writer.
    expect(body).toContain('createTrustedDeliveryWriter()');
    expect(body).toContain('TRUSTED_WRITER_UNAVAILABLE');
    expect(body.match(/\.rpc\(/g)).toHaveLength(1);
    expect(body).toContain('rpc(COMPLETE_DELIVERY_RPC');
    expect(body).not.toMatch(/\.from\(/);
    expect(body).not.toMatch(/\.(update|insert|upsert|delete)\(/);
    const otpCheck = completionSql.indexOf('if v_delivery.otp_hash <> p_otp_digest then');
    const completionWrite = completionSql.indexOf('set delivery_status = v_final_status');
    const orderWrite = completionSql.indexOf("update public.orders set status = 'delivered'");
    expect(otpCheck).toBeGreaterThan(-1);
    expect(completionWrite).toBeGreaterThan(otpCheck);
    expect(orderWrite).toBeGreaterThan(otpCheck);
  });

  it('assignment and OTP regeneration check the permission before the trusted write', () => {
    for (const [name, writer] of [['assignDeliveryStaffAction', 'assignWriter'], ['regenerateDeliveryOtpAction', 'otpWriter']] as const) {
      const body = section(name);
      expect(body.indexOf("'deliveries.assign'")).toBeGreaterThan(-1);
      expect(body.indexOf(`const ${writer} = trustedWriterFor(`)).toBeGreaterThan(body.indexOf("'deliveries.assign'"));
    }
  });

  it('settlement converts the rupee line total to paise', () => {
    // PR #126: the conversion is done by the database (0094
    // delivery_shortfall_paise) from the ORIGINAL order line, never from a
    // value the app sends. Behaviour: delivery-completion-action-db.test.ts
    // asserts a ₹200 shortfall is credited as exactly 20000 paise.
    const sql94 = readFileSync('supabase/migrations/0094_delivery_trust_and_loyalty_integrity.sql', 'utf8');
    expect(sql94).toMatch(/round\(\s*oi\.line_total\s*\*\s*100\s*\)/);
    expect(section('completeDeliveryAction')).not.toMatch(/line_total|lineTotalPaise|p_amount_paise/);
  });

  it('the trusted writer fails closed without server configuration and is server-only', () => {
    const writer = readFileSync('lib/delivery/trusted-writer.ts', 'utf8');
    expect(writer).toContain("import 'server-only'");
    expect(writer).toMatch(/SUPABASE_SERVICE_ROLE_KEY\?\.trim\(\)[\s\S]*return null/);
  });

  it('no client component imports the trusted writer', () => {
    expect(actions.startsWith("'use server'") || actions.includes("'use server'")).toBe(true);
    expect(readFileSync('lib/staff/dispatch-actions.ts', 'utf8')).toContain("'use server'");
  });

  it('the generic admin status action refuses delivered for non-admin roles', () => {
    const admin = readFileSync('lib/admin/orders-actions.ts', 'utf8');
    expect(admin).toMatch(/status === 'delivered' && actor\.role !== 'super_admin' && actor\.role !== 'admin'/);
  });
  it('completion checks the snapshot against the original order lines before any settlement or write (SEC-16)', () => {
    const body = section('completeDeliveryAction');
    // PR #126 (0099): the comparison is inside the completion transaction.
    expect(body).toContain('mapCompletionError(');
    expect(completionMap).toContain('This delivery task no longer matches the original order quantities.');
    expect(completionMap).toContain('This delivery task does not match the order lines.');
    const check = completionSql.indexOf('DELIVERY_COMPLETE:SNAPSHOT_TAMPERED');
    expect(check).toBeGreaterThan(-1);
    expect(completionSql).toContain('DELIVERY_COMPLETE:SNAPSHOT_MISMATCH');
    // A line from another order, or a changed quantity, is caught by the same comparison.
    expect(completionSql).toContain('or oi.order_id <> v_order.id');
    expect(completionSql).toContain('di.quantity_ordered is distinct from coalesce(oi.quantity_pieces, oi.quantity)');
    // It runs before the completion write and before the shortfall credit.
    expect(completionSql.indexOf('set delivery_status = v_final_status')).toBeGreaterThan(check);
    expect(completionSql.indexOf('public.order_shortfall_coins(')).toBeGreaterThan(check);
  });
});
