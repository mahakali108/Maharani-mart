import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, createMigratedDb, createPack, createUser, errorOf, type Db } from './helpers/pg-harness';

/**
 * Migration 0084 — AI-only 14-day retention.
 *
 * The owner's constraint is narrow and must stay narrow: delete Super Admin AI
 * data older than 14 days, and nothing else. These tests drive the real
 * function on a real database.
 *
 * BOUNDARY NOTE (PGlite): `now()` is fixed for the whole transaction, so a row
 * written with `now() - interval '14 days'` is exactly 14 days old *within that
 * transaction* and is therefore NOT strictly older than the cutoff — it is
 * kept. Rows at 14 days + 1 minute are deleted. The boundary is asserted
 * against that documented behaviour rather than pretending a clock advanced.
 */

let db: Db;
let retailer: string;

const AI_TABLES = [
  'ai_audit_logs',
  'ai_business_memory',
  'ai_rate_limit_windows',
  'ai_confirmed_actions',
  'ai_demand_forecasts',
] as const;

async function seedAiRows(daysAgo: number) {
  // Keep each seed isolated: earlier eligible rows would inflate the counts.
  for (const table of AI_TABLES) {
    await db.query(`delete from public.${table}`);
  }
  const age = `${daysAgo} days`;
  await db.query(
    `insert into public.ai_audit_logs (request_id, user_id, surface, request_type, tool_name, duration_ms, success, created_at)
     values (gen_random_uuid(), $1, 'admin', 'tool', 'get_business_overview', 12, true, now() - $2::interval)`,
    [retailer, age]
  );
  await db.query(
    `insert into public.ai_business_memory (user_id, memory_key, memory_value, updated_at)
     values ($1, 'reorder_preference', 'concise', now() - $2::interval)`,
    [retailer, age]
  );
  await db.query(
    `insert into public.ai_rate_limit_windows (user_id, bucket, window_started_at, request_count)
     values ($1, 'chat', now() - $2::interval, 3)`,
    [retailer, age]
  );
  await db.query(
    `insert into public.ai_confirmed_actions (nonce, user_id, consumed_at)
     values ($1, $2, now() - $3::interval)`,
    [randomUUID(), retailer, age]
  );
  await db.query(
    `insert into public.ai_demand_forecasts (product_id, snapshot_days, direction, computed_at)
     select product_id, 30, 'stable', now() - $1::interval from public.product_packs limit 1`,
    [age]
  );
}

async function counts(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const table of AI_TABLES) {
    const { rows } = await db.query<{ n: string }>(`select count(*)::text as n from public.${table}`);
    out[table] = Number(rows[0]!.n);
  }
  return out;
}

interface CleanupTarget {
  table: string;
  eligible_rows?: number;
  deleted_rows?: number;
  status: string;
}
interface CleanupResult {
  run_id: string;
  dry_run: boolean;
  cutoff: string;
  total_affected: number;
  targets: CleanupTarget[];
  errors: { target_key: string; message: string }[];
  status: string;
}

async function run(dryRun = false, batch = 500) {
  const { rows } = await db.query<{ r: CleanupResult }>(
    `select public.run_ai_data_cleanup($1, 'test', $2, 5000) as r`,
    [dryRun, batch]
  );
  const result = rows[0]!.r;
  // Convenience view used by the assertions below.
  return {
    ...result,
    totalDeleted: result.total_affected,
    deleted: Object.fromEntries(
      result.targets.map((target) => [target.table, target.deleted_rows ?? target.eligible_rows ?? 0])
    ) as Record<string, number>,
  };
}

beforeAll(async () => {
  db = await createMigratedDb();
  retailer = await createUser(db, 'retailer');
  // A non-AI row of every "must never be touched" family, plus one product so
  // a forecast snapshot can be seeded (ai_demand_forecasts.product_id is NOT NULL).
  await db.query(`insert into public.warehouses (name, is_active) values ('Retention warehouse', true)`);
  await createPack(db, { gstPercent: 18, moq: 1, unitsPerCase: 10 });
}, 180_000);

afterAll(async () => {
  await db?.close();
});

describe('14-day boundary', () => {
  it('keeps rows that are 13 days 23 hours old', async () => {
    await seedAiRows(13);
    await db.query(`update public.ai_audit_logs set created_at = now() - interval '13 days 23 hours'`);
    const result = await run();
    expect(result.totalDeleted).toBe(0);
    expect((await counts()).ai_audit_logs).toBe(1);
  });

  it('keeps a row exactly on the cutoff and deletes one a second older (same transaction)', async () => {
    for (const table of AI_TABLES) await db.query(`delete from public.${table}`);
    // `now()` is fixed inside one transaction, so this pins the boundary
    // exactly: the row at now() - 14 days equals the cutoff, and the strict
    // `<` predicate must not delete it, while a row one second older goes.
    const outcome = await as(db, 'service', async (tx) => {
      await tx.query(
        `insert into public.ai_audit_logs (request_id, user_id, surface, request_type, tool_name, duration_ms, success, created_at)
         values (gen_random_uuid(), $1, 'admin', 'tool', 'boundary-exact', 1, true, now() - interval '14 days')`,
        [retailer]
      );
      await tx.query(
        `insert into public.ai_audit_logs (request_id, user_id, surface, request_type, tool_name, duration_ms, success, created_at)
         values (gen_random_uuid(), $1, 'admin', 'tool', 'boundary-older', 1, true, now() - interval '14 days 1 second')`,
        [retailer]
      );
      const res = await tx.query<{ r: { total_affected: number } }>(
        `select public.run_ai_data_cleanup(false, 'test', 500, 5000) as r`
      );
      const remaining = await tx.query<{ tool_name: string }>(
        `select tool_name from public.ai_audit_logs where tool_name like 'boundary-%' order by tool_name`
      );
      return { deleted: res.rows[0]!.r.total_affected, remaining: remaining.rows.map((row) => row.tool_name) };
    });
    expect(outcome.deleted).toBe(1);
    expect(outcome.remaining).toEqual(['boundary-exact']);
  });

  it('deletes rows 14 days + 1 minute old across all five AI tables', async () => {
    await seedAiRows(15);
    await db.query(`update public.ai_audit_logs set created_at = now() - interval '14 days 1 minute'`);
    await db.query(`update public.ai_business_memory set updated_at = now() - interval '14 days 1 minute'`);
    await db.query(`update public.ai_rate_limit_windows set window_started_at = now() - interval '14 days 1 minute'`);
    await db.query(`update public.ai_confirmed_actions set consumed_at = now() - interval '14 days 1 minute'`);
    await db.query(`update public.ai_demand_forecasts set computed_at = now() - interval '14 days 1 minute'`);
    const result = await run();
    expect(result.totalDeleted).toBe(5);
    const after = await counts();
    for (const table of AI_TABLES) expect(after[table], table).toBe(0);
  });
});

describe('dry run, idempotency and batching', () => {
  it('a dry run reports the rows but deletes nothing', async () => {
    await seedAiRows(30);
    const before = await counts();
    const result = await run(true);
    expect(result.dry_run).toBe(true);
    // A dry run reports eligibility only; it deletes nothing.
    expect(result.targets.map((target) => target.eligible_rows)).toEqual([1, 1, 1, 1, 1]);
    expect(result.targets.every((target) => target.deleted_rows === undefined)).toBe(true);
    expect(await counts()).toEqual(before);
  });

  it('is idempotent and retry-safe', async () => {
    // A dataset with nothing older than the cutoff: two runs must both be no-ops.
    await seedAiRows(5);
    const first = await run();
    expect(first.totalDeleted).toBe(0);
    const second = await run();
    expect(second.totalDeleted).toBe(0);

    // And a deleting run followed by a rerun deletes nothing more.
    await seedAiRows(30);
    expect((await run()).totalDeleted).toBeGreaterThan(0);
    expect((await run()).totalDeleted).toBe(0);
  });

  it('respects the per-target batch size (one bounded batch per run)', async () => {
    for (const table of AI_TABLES) await db.query(`delete from public.${table}`);
    await db.query(
      `insert into public.ai_audit_logs (request_id, user_id, surface, request_type, tool_name, duration_ms, success, created_at)
       select gen_random_uuid(), $1, 'admin', 'tool', 'get_business_overview', 12, true, now() - interval '40 days'
         from generate_series(1, 12)`,
      [retailer]
    );
    const first = await run(false, 3);
    expect(first.deleted.ai_audit_logs).toBe(3);
    const { rows } = await db.query<{ n: string }>(`select count(*)::text as n from public.ai_audit_logs`);
    expect(Number(rows[0]!.n)).toBe(9);
  });
});

describe('scope isolation', () => {
  it('leaves every business, ledger and audit-account record untouched', async () => {
    const tables = [
      'orders',
      'order_items',
      'payment_collections',
      'retailer_wallet_ledger',
      'loyalty_ledger',
      'retailer_credit_accounts',
      'coupons',
      'notification_logs',
      'audit_logs',
      'super_admin_audit_logs',
      'cleanup_runs',
      'products',
      'product_packs',
      'retailer_account_requests',
    ];
    const before: Record<string, number> = {};
    for (const table of tables) {
      const { rows } = await db.query<{ n: string }>(`select count(*)::text as n from public.${table}`);
      before[table] = Number(rows[0]!.n);
    }
    await seedAiRows(45);
    await run();
    for (const table of tables) {
      const { rows } = await db.query<{ n: string }>(`select count(*)::text as n from public.${table}`);
      expect(Number(rows[0]!.n), table).toBe(before[table]);
    }
  });

  it('never deletes a general audit row even at 400 days', async () => {
    await db.query(
      `insert into public.audit_logs (table_name, record_id, action, changed_by, created_at)
       values ('retailers', gen_random_uuid(), 'update', $1, now() - interval '400 days')`,
      [retailer]
    );
    const before = await db.query<{ n: string }>(`select count(*)::text as n from public.audit_logs`);
    await seedAiRows(45);
    await run();
    const after = await db.query<{ n: string }>(`select count(*)::text as n from public.audit_logs`);
    expect(after.rows[0]!.n).toBe(before.rows[0]!.n);
  });

  it('records a run audit row without prompts, responses or personal data', async () => {
    await seedAiRows(45);
    await run();
    const { rows } = await db.query<{ summary: unknown; triggered_by: string; errors: unknown }>(
      `select summary, triggered_by, errors from public.ai_cleanup_runs order by started_at desc limit 1`
    );
    expect(rows[0]!.summary).toBeTruthy();
    const serialized = JSON.stringify(rows[0]);
    expect(serialized).not.toMatch(/select |insert |@|password|token/i);
    expect(rows[0]!.triggered_by).toBe('test');
  });

  it('is not executable by an API role', async () => {
    const message = await errorOf(db, 'anon', (tx) =>
      tx.query(`select public.run_ai_data_cleanup(false, 'anon', 100, 100)`)
    );
    expect(message).toMatch(/permission denied|could not be executed/i);
  });

  it('has a registry that matches the implemented allow-list exactly', async () => {
    const { rows } = await db.query<{ table_name: string; cutoff_column: string; retention_days: number }>(
      `select table_name, cutoff_column, retention_days from public.ai_retention_rules order by table_name`
    );
    expect(rows).toEqual([
      { table_name: 'ai_audit_logs', cutoff_column: 'created_at', retention_days: 14 },
      { table_name: 'ai_business_memory', cutoff_column: 'updated_at', retention_days: 14 },
      { table_name: 'ai_confirmed_actions', cutoff_column: 'consumed_at', retention_days: 14 },
      { table_name: 'ai_demand_forecasts', cutoff_column: 'computed_at', retention_days: 14 },
      { table_name: 'ai_rate_limit_windows', cutoff_column: 'window_started_at', retention_days: 14 },
    ]);
  });

  it('leaves the existing 90/120-day engine completely untouched', async () => {
    const { rows } = await db.query<{ spec: string }>(
      `select prosrc as spec from pg_proc where proname = 'run_data_cleanup'`
    );
    expect(rows).toHaveLength(1);
    // The general engine knows nothing about the AI-only 14-day rule.
    expect(rows[0]!.spec).not.toContain('ai_retention_rules');
    expect(rows[0]!.spec).not.toContain('ai_cleanup_runs');
  });
});
