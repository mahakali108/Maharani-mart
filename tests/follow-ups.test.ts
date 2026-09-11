/**
 * Staff targets/commissions (0038) and follow-ups (0039) — static
 * verification of schema, RLS and lifecycle guarantees, plus the salesman
 * permission wiring. Follows the established migration-assertion pattern
 * (tests/production-readiness.test.ts).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { can } from '@/lib/permissions/permissions';

const ROOT = join(__dirname, '..');
const read = (file: string) => readFileSync(join(ROOT, 'supabase/migrations', file), 'utf8');

const sql38 = read('0038_staff_targets_commissions.sql');
const sql39 = read('0039_follow_ups.sql');
const sql40 = read('0040_schemes_audit.sql');

const stripComments = (text: string) =>
  text
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');

describe('0038 staff targets & commissions schema', () => {
  it('creates both tables idempotently', () => {
    expect(sql38).toContain('create table if not exists staff_targets');
    expect(sql38).toContain('create table if not exists staff_commissions');
  });

  it('constrains metrics, bases, statuses and periods', () => {
    expect(sql38).toContain("check (metric in ('sales_value', 'collection_value', 'order_count', 'visit_count', 'new_retailers'))");
    expect(sql38).toContain("check (basis in ('sales_value', 'collection_value'))");
    expect(sql38).toContain("check (status in ('draft', 'approved', 'paid'))");
    expect(sql38).toContain('check (period_end >= period_start)');
    expect(sql38).toContain('check (rate_percent >= 0 and rate_percent <= 100)');
  });

  it('stores money in integer paise like the wallet ledger', () => {
    expect(sql38).toContain('basis_amount_paise bigint');
    expect(sql38).toContain('computed_amount_paise bigint');
  });

  it('enables RLS with admin-manage / owner-read policies and no delete policy', () => {
    expect(sql38).toContain('alter table staff_targets enable row level security');
    expect(sql38).toContain('alter table staff_commissions enable row level security');
    expect(sql38).toContain('is_admin_or_above() or user_id = auth.uid()');
    // Admin-only writes: the person the target measures can never edit it.
    expect(sql38).toContain('create policy "staff_targets_admin_insert"');
    expect(sql38).toContain('create policy "staff_commissions_admin_update"');
    expect(sql38).not.toContain('for delete');
  });

  it('pairs every create policy with a drop-if-exists', () => {
    for (const sql of [sql38, sql39]) {
      const creates = sql.match(/create policy/g)?.length ?? 0;
      const drops = sql.match(/drop policy if exists/g)?.length ?? 0;
      expect(creates).toBeGreaterThan(0);
      expect(drops).toBe(creates);
    }
  });

  it('adds audit triggers to both tables', () => {
    expect(sql38).toContain('trg_audit_staff_targets');
    expect(sql38).toContain('trg_audit_staff_commissions');
    expect(sql38).toContain('execute function log_audit()');
  });

  it('contains no destructive statements or seed data', () => {
    for (const sql of [sql38, sql39, sql40]) {
      const body = stripComments(sql).toLowerCase();
      expect(body).not.toMatch(/drop table\b/);
      expect(body).not.toMatch(/truncate\b/);
      expect(body).not.toMatch(/drop column\b/);
      expect(body).not.toMatch(/\bdelete from\b/);
      expect(body).not.toMatch(/\binsert into\b/);
    }
  });
});

describe('0039 follow-ups schema', () => {
  it('creates the table idempotently with a closed status set', () => {
    expect(sql39).toContain('create table if not exists follow_ups');
    expect(sql39).toContain("check (status in ('open', 'done', 'cancelled'))");
    expect(sql39).toContain('check (char_length(btrim(note)) between 3 and 500)');
  });

  it('lets a salesman insert only their own reminders for assigned retailers', () => {
    const insertPolicy = sql39.match(/create policy "follow_ups_owner_insert"[\s\S]*?;/)?.[0] ?? '';
    expect(insertPolicy).toContain('owner_id = auth.uid()');
    expect(insertPolicy).toContain('is_retailer_assigned_to_current_salesman(retailer_id)');
  });

  it('is append-only: an update policy exists but no delete policy', () => {
    expect(sql39).toContain('create policy "follow_ups_owner_update"');
    expect(sql39).not.toContain('for delete');
  });

  it('gives admin oversight read access', () => {
    const readPolicy = sql39.match(/create policy "follow_ups_read"[\s\S]*?;/)?.[0] ?? '';
    expect(readPolicy).toContain('owner_id = auth.uid()');
    expect(readPolicy).toContain('is_admin_or_above()');
  });

  it('audits every change', () => {
    expect(sql39).toContain('trg_audit_follow_ups');
  });
});

describe('0040 schemes audit trigger', () => {
  it('audits scheme changes like every other pricing surface', () => {
    expect(sql40).toContain('drop trigger if exists trg_audit_schemes on schemes');
    expect(sql40).toContain('create trigger trg_audit_schemes');
    expect(sql40).toContain('execute function log_audit()');
  });
});

describe('follow-up permission wiring (Phase 2)', () => {
  it('grants followups.manage.own to salesmen only', () => {
    expect(can('salesman', 'followups.manage.own')).toBe(true);
    expect(can('staff', 'followups.manage.own')).toBe(false);
    expect(can('admin', 'followups.manage.own')).toBe(false);
    expect(can('super_admin', 'followups.manage.own')).toBe(false);
    expect(can('retailer', 'followups.manage.own')).toBe(false);
  });

  it('keeps retailers away from every management permission', () => {
    for (const permission of ['followups.manage.own', 'targets.manage', 'commissions.manage', 'notifications.broadcast'] as const) {
      expect(can('retailer', permission)).toBe(false);
    }
  });
});
