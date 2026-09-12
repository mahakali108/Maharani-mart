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

describe('smoke-test.sql structure', () => {
  it('runs everything inside a transaction and rolls back (no seed data persists)', () => {
    expect(sql).toContain('BEGIN;');
    // Rollback must come after the last assertion block.
    expect(sql.lastIndexOf('ROLLBACK;')).toBeGreaterThan(sql.lastIndexOf('DO $$'));
    expect(sql.indexOf('BEGIN;')).toBeLessThan(sql.indexOf('create temp table'));
  });

  it('impersonates each of the four roles through real JWT claims', () => {
    for (const persona of ['admin_id', 'staff_assignee_id', 'staff_outsider_id', 'salesman_id', 'retailer_id', 'retailer_outsider_id']) {
      expect(sql).toContain(persona);
    }
    expect((sql.match(/set local role authenticated;/g) ?? []).length).toBeGreaterThanOrEqual(6);
    // JWT impersonation goes through set_config(): `SET ... = <expression>`
    // is a syntax error (SET only accepts a literal) in both the SQL
    // Editor and psql.
    expect((sql.match(/set_config\('request\.jwt\.claims'/g) ?? []).length).toBeGreaterThanOrEqual(6);
  });

  it('is Supabase SQL Editor compatible: plain SQL only, no psql meta-commands', () => {
    // \echo / \set / any backslash command is psql-only — the SQL Editor
    // rejects it with `syntax error at or near "\"`. (Comments may NAME
    // the forbidden commands; only executable lines are checked.)
    const code = sql
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n');
    expect(code).not.toMatch(/^\\/m);
    expect(code).not.toContain('\\echo');
    expect(code).not.toMatch(/set\s+(local\s+)?request\.jwt\.claims\s*=/i);
    expect(sql).toContain("select set_config('request.jwt.claims'");
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
});
