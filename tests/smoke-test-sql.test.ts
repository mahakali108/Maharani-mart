/**
 * supabase/smoke-test.sql — keeps the LIVE smoke script (RLS role matrix,
 * transition triggers, private buckets, audit trail) structurally honest.
 * The script itself runs against a real Supabase project with psql; these
 * checks make sure it keeps testing what it claims to test (and never
 * forgets the rollback that keeps the database free of seed data).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(join(__dirname, '..', 'supabase', 'smoke-test.sql'), 'utf8');
const validateScript = readFileSync(join(__dirname, '..', 'scripts', 'production-validate.sh'), 'utf8');
const checklist = readFileSync(join(__dirname, '..', 'docs', 'PRODUCTION_VERIFICATION_CHECKLIST.md'), 'utf8');

describe('smoke-test.sql structure', () => {
  it('runs everything inside a transaction and rolls back (no seed data persists)', () => {
    expect(sql).toContain('BEGIN;');
    // Rollback must come after the last assertion block.
    expect(sql.lastIndexOf('ROLLBACK;')).toBeGreaterThan(sql.lastIndexOf('DO $$'));
    expect(sql.indexOf('BEGIN;')).toBeLessThan(sql.indexOf('create temp table'));
  });

  it('impersonates each persona through set_config JWT claims, never SET (F2)', () => {
    const personas = ['admin_id', 'staff_assignee_id', 'staff_outsider_id', 'salesman_id', 'retailer_id', 'retailer_outsider_id'];
    for (const persona of personas) {
      expect(sql).toContain(persona);
    }
    expect(sql.split('set local role authenticated;').length - 1).toBeGreaterThanOrEqual(6);
    // F2: PostgreSQL SET accepts literals only — `SET ... = format(...)` is a
    // syntax error. Every JWT claim setup MUST use transaction-local
    // set_config(..., true). Any line touching the claims key without
    // set_config fails this test.
    const claimLines = sql.split('\n').filter((line) => line.includes('request.jwt.claims'));
    expect(claimLines.length).toBe(6);
    for (const line of claimLines) {
      expect(line).toContain('set_config(');
    }
    expect(sql.split("set_config('request.jwt.claims'").length - 1).toBe(6);
    // Each impersonation passes its persona through format() and stays local.
    for (const persona of personas) {
      expect(sql).toContain(`(select ${persona}::text from smoke_personas)), true);`);
    }
  });

  it('exercises admin, staff (assignee + out-of-scope), salesman and retailer sections', () => {
    for (const section of ['§A', '§B', '§C', '§D', '§E', '§F', '§G']) {
      expect(sql).toContain(section);
    }
    expect(sql).toContain('cross-area leak');
    expect(sql).toContain('UNASSIGNED retailer');
    expect(sql).toContain('another retailer can see');
  });

  it('negative UPDATE tests compare row state, because RLS blocks updates silently', () => {
    // The state-based pattern must be used for every negative update check.
    expect(sql).toContain('RLS blocks silently');
    expect(sql).toContain('did not land');
    expect(sql).toContain('STILL');
  });

  it('verifies the order and delivery transition triggers with expected rejections', () => {
    expect(sql).toContain('pending -> delivered rejected');
    expect(sql).toContain('cancelled -> confirmed rejected');
    expect(sql).toContain('delivered -> failed rejected');
    expect(sql).toContain('returned_to_warehouse is terminal');
  });

  it('verifies one-task-per-order, the split invariant and the OTP ceiling', () => {
    expect(sql).toContain('exactly one delivery task per order');
    expect(sql).toContain('quantity split invariant');
    expect(sql).toContain('OTP attempt ceiling');
  });

  it('verifies both proof buckets are private and policy-covered', () => {
    expect(sql).toContain("storage.buckets where id = 'delivery-proofs'");
    expect(sql).toContain("storage.buckets where id = 'payment-proofs'");
    expect(sql).toContain('is PUBLIC');
    expect(sql).toContain("policyname like '%proof%'");
  });

  it('verifies the audit trail was written by the 0043/0044 triggers', () => {
    expect(sql).toContain("table_name = 'order_deliveries'");
    expect(sql).toContain("table_name = 'payment_collections'");
  });

  it('uses only core PostgreSQL crypto (no pgcrypto dependency)', () => {
    expect(sql).not.toContain('digest(');
    expect(sql).toContain('md5(');
  });

  it('fixture satisfies the 0046 pre-completion invariant and leaves the split-test line unattached (F3)', () => {
    // §0 attaches ONLY the qty-10 line with its true ordered quantity —
    // never a hard literal, never the qty-4 line (which §E relies on).
    expect(sql).toContain('select d.id, oi.id, oi.quantity');
    expect(sql).toContain('and oi.quantity = 10;');
    expect(sql).not.toContain('select d.id, oi.id, 10');
    expect(sql).toContain('§0 dispatch-state snapshot (0/0/0, non-terminal) accepted; qty-4 line unattached');
  });

  it('unmasked RLS negative test: outsider insert targets the task-less transition order and requires 42501 (F5)', () => {
    expect(sql).toContain("values ((select id from smoke_transition_order), 'assigned');");
    expect(sql).toContain('exception when insufficient_privilege then');
    expect(sql).toContain('NOT denied by RLS (42501)');
  });

  it('strict error handling everywhere: ON_ERROR_STOP and a single rollback, never COMMIT (F6)', () => {
    expect(sql).toContain('psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/smoke-test.sql');
    expect(validateScript).toContain('psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$SMOKE"');
    expect(checklist).toContain('-v ON_ERROR_STOP=1 -f supabase/smoke-test.sql');
    expect(sql).not.toContain('COMMIT;');
  });
});
