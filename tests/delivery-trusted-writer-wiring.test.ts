import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * Migration 0094 rejects OTP / assignment / completion writes from a staff
 * session. These assertions pin the application side of that contract: the
 * protected writes go through the trusted writer, and only AFTER the OTP check.
 */
const actions = readFileSync('lib/delivery/delivery-actions.ts', 'utf8');
const section = (name: string) => {
  const start = actions.indexOf(`export async function ${name}(`);
  expect(start).toBeGreaterThan(-1);
  const next = actions.indexOf('\nexport async function ', start + 10);
  return actions.slice(start, next === -1 ? undefined : next);
};

describe('delivery actions write protected fields through the trusted writer', () => {
  it('completion verifies the OTP before obtaining the trusted writer', () => {
    const body = section('completeDeliveryAction');
    const verify = body.indexOf('verifyDeliveryOtp(');
    const writer = body.indexOf('trustedWriterFor(');
    expect(verify).toBeGreaterThan(-1);
    expect(writer).toBeGreaterThan(verify);
    expect(body).toContain("completionWriter\n    .from('order_deliveries')");
    expect(body).toMatch(/completionWriter\s*\.from\('orders'\)/);
    expect(body).toContain('TRUSTED_WRITER_UNAVAILABLE');
  });

  it('assignment and OTP regeneration check the permission before the trusted write', () => {
    for (const [name, writer] of [['assignDeliveryStaffAction', 'assignWriter'], ['regenerateDeliveryOtpAction', 'otpWriter']] as const) {
      const body = section(name);
      expect(body.indexOf("'deliveries.assign'")).toBeGreaterThan(-1);
      expect(body.indexOf(`const ${writer} = trustedWriterFor(`)).toBeGreaterThan(body.indexOf("'deliveries.assign'"));
    }
  });

  it('settlement converts the rupee line total to paise', () => {
    expect(actions).toContain('lineTotalPaise: Math.round(Number(value?.line_total ?? 0) * 100)');
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
    const check = body.indexOf('This delivery task no longer matches the original order quantities.');
    expect(check).toBeGreaterThan(-1);
    expect(body).toContain('This delivery task does not match the order lines.');
    expect(body).toContain('This delivery task contains a line from another order.');
    expect(body).toContain('original.quantity_pieces ?? original.quantity');
    // The comparison runs before settlement lines are built and before the trusted write.
    expect(body.indexOf('const settlementLines')).toBeGreaterThan(check);
    expect(body.indexOf("completionWriter\n    .from('order_deliveries')")).toBeGreaterThan(check);
  });
});
