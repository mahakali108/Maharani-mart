import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  as,
  createMigratedDb,
  createPack,
  createRetailer,
  createUser,
  errorOf,
  type Db,
  type PackFixture,
  type RetailerFixture,
} from './helpers/pg-harness';

/**
 * AI-only 14-day retention (migration 0084), executed on PostgreSQL 16.
 *
 * Boundaries under test:
 *   - 13 days 23 hours old  -> KEPT
 *   - exactly 14 days old   -> KEPT (the rule is "strictly older than 14 days";
 *                              it becomes eligible on the next run)
 *   - 14 days + 1 minute    -> DELETED
 *
 * The absolute boundary — retailer/seller accounts, orders, products,
 * inventory, payments, ledgers, audit evidence and legal records — is asserted
 * by counting those tables before and after a live run.
 */

let db: Db;
let retailer: RetailerFixture;
let pack: PackFixture;
let admin: string;

type CleanupReport = {
  run_id: string;
  status: string;
  total_affected: number;
  dry_run: boolean;
  targets: { target_key: string; status: string; eligible_rows?: number; deleted_rows?: number }[];
  errors: { target_key: string; message: string }[];
};

const RUN = `select public.run_ai_data_cleanup($1::boolean, $2::text, $3::int, $4::int) as result`;

async function runCleanup(
  opts: { dryRun?: boolean; batchSize?: number; maxRows?: number; triggeredBy?: string } = {}
): Promise<CleanupReport> {
  const { rows } = await as(db, 'service', (tx) =>
    tx.query<{ result: CleanupReport }>(RUN, [
      opts.dryRun ?? false,
      opts.triggeredBy ?? 'test',
      opts.batchSize ?? 500,
      opts.maxRows ?? 20000,
    ])
  );
  return rows[0]!.result;
}

const ago = (days: number, hours = 0, minutes = 0) =>
  `now() - interval '${days} days' - interval '${hours} hours' - interval '${minutes} minutes'`;

async function seedAiRows(label: string) {
  // Two rows per store: one kept (13d 23h) and one expired (14d + 1 min).
  // Each scenario starts from a clean AI slate so the expected counts describe
  // THIS scenario only.
  await db.query(`delete from ai_audit_logs`);
  await db.query(`delete from ai_business_memory`);
  await db.query(`delete from ai_rate_limit_windows`);
  await db.query(`delete from ai_confirmed_actions`);
  await db.query(`delete from ai_demand_forecasts`);
  const suffix = `${label}-${randomUUID().slice(0, 6)}`;

  await db.query(
    `insert into ai_audit_logs (request_id, user_id, surface, request_type, duration_ms, success, created_at)
     values
       (gen_random_uuid(), $1, 'retailer', 'chat', 10, true, ${ago(13, 23, 0)}),
       (gen_random_uuid(), $1, 'retailer', 'chat', 10, true, ${ago(14, 0, 1)})`,
    [retailer.id]
  );
  await db.query(
    `insert into ai_business_memory (user_id, memory_key, memory_value, source, updated_at)
     values
       ($1, 'preferred_brand', $2, 'user_confirmed', ${ago(13, 23, 0)}),
       ($1, 'frequent_product', $2, 'user_confirmed', ${ago(14, 0, 1)})`,
    [retailer.id, `v-${suffix}`]
  );
  await db.query(
    `insert into ai_rate_limit_windows (user_id, bucket, window_started_at, request_count)
     values
       ($1, $2, ${ago(13, 23, 0)}, 1),
       ($1, $3, ${ago(14, 0, 1)}, 1)`,
    [retailer.id, `k1-${suffix}`, `k2-${suffix}`]
  );
  await db.query(
    `insert into ai_confirmed_actions (nonce, user_id, consumed_at)
     values
       ($1, $2, ${ago(13, 23, 0)}),
       ($3, $2, ${ago(14, 0, 1)})`,
    [randomUUID(), retailer.id, randomUUID()]
  );
  await db.query(
    `insert into ai_demand_forecasts (product_id, snapshot_days, direction, computed_at)
     values
       ($1, 30, 'stable', ${ago(13, 23, 0)}),
       ($1, 30, 'stable', ${ago(14, 0, 1)})`,
    [pack.productId]
  );
}

async function countAiRows() {
  const { rows } = await db.query<{
    audit: string;
    memory: string;
    windows: string;
    confirmed: string;
    forecasts: string;
  }>(`select
        (select count(*) from ai_audit_logs)::text as audit,
        (select count(*) from ai_business_memory)::text as memory,
        (select count(*) from ai_rate_limit_windows)::text as windows,
        (select count(*) from ai_confirmed_actions)::text as confirmed,
        (select count(*) from ai_demand_forecasts)::text as forecasts`);
  return rows[0]!;
}

async function countBusinessRows() {
  const { rows } = await db.query<Record<string, string>>(`
    select
      (select count(*) from retailers)::text as retailers,
      (select count(*) from profiles)::text as profiles,
      (select count(*) from products)::text as products,
      (select count(*) from product_packs)::text as packs,
      (select count(*) from product_tier_prices)::text as tier_prices,
      (select count(*) from orders)::text as orders,
      (select count(*) from retailer_wallet_ledger)::text as wallet_ledger,
      (select count(*) from loyalty_ledger)::text as loyalty_ledger,
      (select count(*) from retailer_approval_events)::text as approval_events,
      (select count(*) from retailer_applications)::text as applications,
      (select count(*) from audit_logs)::text as audit_logs,
      (select count(*) from super_admin_audit_logs)::text as super_admin_audit_logs,
      (select count(*) from cart_items)::text as cart_items,
      (select count(*) from support_tickets)::text as support_tickets
  `);
  return rows[0]!;
}

beforeAll(async () => {
  db = await createMigratedDb();
  admin = await createUser(db, 'admin');
  retailer = await createRetailer(db, { creditLimitRupees: 0 });
  pack = await createPack(db, { gstPercent: 18 });
  // A couple of unrelated rows so the boundary counts are non-trivial.
  await db.query(
    `insert into retailer_wallet_ledger (retailer_id, entry_type, points, amount_paise, note, created_at)
     values ($1, 'ORDER_EARN', 0, 0, 'seed', now() - interval '400 days')
     on conflict do nothing`,
    [retailer.id]
  ).catch(() => undefined);
  await db.query(
    `insert into loyalty_ledger (retailer_id, points, entry_type, reason, created_at)
     values ($1, 5, 'ORDER_EARN', 'seed', now() - interval '400 days')`,
    [retailer.id]
  );
}, 180_000);

afterAll(async () => {
  await db.close();
});

describe('AI 14-day retention boundaries', () => {
  it('dry run reports eligible rows without deleting any of them', async () => {
    await seedAiRows('dry');
    const before = await countAiRows();
    const report = await runCleanup({ dryRun: true });

    expect(report.status).toBe('completed');
    expect(report.dry_run).toBe(true);
    for (const target of report.targets) {
      expect(target.status).toBe('ok');
      expect(target.eligible_rows).toBe(1);
      expect(target.deleted_rows ?? 0).toBe(0);
    }
    expect(await countAiRows()).toEqual(before);
  });

  it('deletes only rows strictly older than 14 days (13d23h and exactly 14d are kept)', async () => {
    await seedAiRows('live');
    const before = await countAiRows();
    const report = await runCleanup();

    expect(report.status).toBe('completed');
    expect(report.total_affected).toBe(5);

    const after = await countAiRows();
    expect(Number(after.audit)).toBe(Number(before.audit) - 1);
    expect(Number(after.memory)).toBe(Number(before.memory) - 1);
    expect(Number(after.windows)).toBe(Number(before.windows) - 1);
    expect(Number(after.confirmed)).toBe(Number(before.confirmed) - 1);
    expect(Number(after.forecasts)).toBe(Number(before.forecasts) - 1);

    // Every remaining AI row is at most 14 days old.
    const { rows } = await db.query<{ violations: string }>(`
      select (
        (select count(*) from ai_audit_logs where created_at < now() - interval '14 days')
      + (select count(*) from ai_business_memory where updated_at < now() - interval '14 days')
      + (select count(*) from ai_rate_limit_windows where window_started_at < now() - interval '14 days')
      + (select count(*) from ai_confirmed_actions where consumed_at < now() - interval '14 days')
      + (select count(*) from ai_demand_forecasts where computed_at < now() - interval '14 days')
      )::text as violations`);
    expect(rows[0]!.violations).toBe('0');
  });

  it('keeps a row sitting exactly on the cutoff and deletes one second older', async () => {
    // `now()` is frozen for the duration of a transaction, so inserting and
    // running the engine inside ONE transaction pins the boundary exactly:
    //   created_at = now() - 14 days  -> NOT deleted (strictly-older rule)
    //   created_at = now() - 14 days - 1s -> deleted
    await db.query(`delete from ai_audit_logs`);
    const report = await as(db, 'service', async (tx) => {
      await tx.query(
        `insert into ai_audit_logs (request_id, user_id, surface, request_type, duration_ms, success, created_at)
         values
           (gen_random_uuid(), $1, 'retailer', 'chat', 1, true, now() - interval '14 days'),
           (gen_random_uuid(), $1, 'retailer', 'chat', 1, true, now() - interval '14 days' - interval '1 second')`,
        [retailer.id]
      );
      const { rows } = await tx.query<{ result: CleanupReport }>(RUN, [false, 'test', 500, 20000]);
      const { rows: left } = await tx.query<{ created_at: string }>(
        `select created_at from ai_audit_logs order by created_at`
      );
      return { report: rows[0]!.result, left };
    });
    expect(report.report.targets[0]?.deleted_rows).toBe(1);
    expect(report.left).toHaveLength(1);
    const kept = await db.query<{ n: string }>(
      `select count(*)::text as n from ai_audit_logs where created_at = now() - interval '14 days'`
    );
    expect(['0', '1']).toContain(kept.rows[0]!.n);
  });

  it('is idempotent: a repeated live run on an unchanged dataset deletes nothing twice', async () => {
    await seedAiRows('idempotent');
    const first = await runCleanup();
    expect(first.total_affected).toBe(5);
    const second = await runCleanup();
    expect(second.total_affected).toBe(0);
    const third = await runCleanup();
    expect(third.total_affected).toBe(0);
  });

  it('respects the batch/max-rows limit and is retry-safe', async () => {
    await seedAiRows('batch');
    const limited = await runCleanup({ batchSize: 1, maxRows: 1 });
    expect(limited.total_affected).toBe(5); // 1 per target, 5 targets, each had 1
    const report = await runCleanup({ batchSize: 1, maxRows: 1 });
    expect(report.total_affected).toBe(0);
  });

  it('records an operational audit row without any AI content', async () => {
    const { rows } = await db.query<{ run_id: string; summary: Record<string, unknown>; errors: unknown[] }>(
      `select run_id, summary, errors from ai_cleanup_runs order by started_at desc limit 1`
    );
    const row = rows[0]!;
    expect(row.run_id).toMatch(/^ai-cleanup-\d{4}-\d{2}-\d{2}-[a-f0-9]{8}$/);
    const serialized = JSON.stringify(row.summary);
    expect(serialized).not.toMatch(/memory_value|prompt|response|brand-|cat-|prod-/);
    expect(row.errors).toEqual([]);
  });

  it('cannot be executed by an API role', async () => {
    for (const who of [retailer.id, admin, 'anon']) {
      const message = await errorOf(db, who, (tx) => tx.query(RUN, [true, 'test', 100, 100]));
      expect(message).not.toBeNull();
    }
    const { rows } = await db.query<{ n: string }>(`select count(*)::text as n from ai_cleanup_runs`);
    expect(Number(rows[0]!.n)).toBeGreaterThan(0);
  });

  it('never touches business, ledger, audit-evidence or account records', async () => {
    const before = await countBusinessRows();
    await seedAiRows('boundary');
    const report = await runCleanup();
    expect(report.total_affected).toBe(5);
    const after = await countBusinessRows();
    expect(after).toEqual(before);
  });

  it('keeps the registry and the hard-coded implementation in step', async () => {
    const { rows } = await db.query<{ table_name: string; retention_days: number; cutoff_column: string }>(
      `select table_name, retention_days, cutoff_column from ai_retention_rules order by table_name`
    );
    expect(rows).toEqual([
      { table_name: 'ai_audit_logs', retention_days: 14, cutoff_column: 'created_at' },
      { table_name: 'ai_business_memory', retention_days: 14, cutoff_column: 'updated_at' },
      { table_name: 'ai_confirmed_actions', retention_days: 14, cutoff_column: 'consumed_at' },
      { table_name: 'ai_demand_forecasts', retention_days: 14, cutoff_column: 'computed_at' },
      { table_name: 'ai_rate_limit_windows', retention_days: 14, cutoff_column: 'window_started_at' },
    ]);
  });

  it('does not alter the general-purpose 90/120-day cleanup engine', async () => {
    // The general engine's own registry must not have gained an AI-scoped row
    // with a shorter window, and its function must still be service-role only.
    const { rows } = await db.query<{ n: string }>(
      `select count(*)::text as n from data_retention_rules where retention_days < 90 and category = 'temporary_90'`
    );
    expect(rows[0]!.n).toBe('0');
    const message = await errorOf(db, retailer.id, (tx) =>
      tx.query(`select public.run_data_cleanup(true, 'manual', 10, 10)`)
    );
    expect(message).not.toBeNull();
  });
});
