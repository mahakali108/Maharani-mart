/**
 * Guards the owner-run diagnostic `supabase/audits/0109_dependency_diagnostic_readonly.sql`.
 *
 * The script is executed by hand in the Supabase SQL editor, so a syntax error,
 * or a statement that needs a column/table the database does not have yet, would
 * fail exactly when it is needed. It is run here against disposable databases:
 *
 *   * the exact live production baseline (0001..0103) — the state the owner is in
 *     when they run it, where `products.description` and every Phase 3 table are
 *     still absent;
 *   * a deliberately broken baseline (only 0060's table dropped), which the
 *     script must report as MISSING rather than crash.
 *
 * It also pins the read-only guarantee: every statement must be a SELECT/WITH,
 * and execution inside a `set transaction read only` transaction must succeed.
 *
 * Environment limit: PGlite is PostgreSQL 16 (WASM) with stubbed auth/storage;
 * the same blocks were executed against fhrmsrumsraprvutrpeo (PostgreSQL 17.11)
 * during the investigation — see docs/repair/MIGRATION_0109_DEPENDENCY_REPORT.md.
 */
import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createMigratedDb } from './helpers/pg-harness';

const SCRIPT = 'supabase/audits/0109_dependency_diagnostic_readonly.sql';

/** Ledger stub, so the migration-history blocks have something to read. */
const LEDGER_STUB = `
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (
  version text primary key,
  name text,
  statements text[] default '{}',
  created_by text,
  idempotency_key text,
  rollback text[]
);
`;

/** Splits the script into top-level statements, respecting quotes and parens. */
function statements(sql: string): string[] {
  const stripped = sql.replace(/--[^\n]*/g, '');
  const out: string[] = [];
  let depth = 0;
  let current = '';
  let inString = false;
  for (let i = 0; i < stripped.length; i += 1) {
    const ch = stripped[i]!;
    if (ch === "'") {
      if (inString && stripped[i + 1] === "'") {
        current += "''";
        i += 1;
        continue;
      }
      inString = !inString;
    }
    if (inString) {
      current += ch;
      continue;
    }
    current += ch;
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    else if (ch === ';' && depth === 0) {
      if (current.trim()) out.push(current.trim());
      current = '';
    }
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

async function withLedger(db: PGlite, versions: string[]): Promise<void> {
  await db.exec(LEDGER_STUB);
  for (const version of versions) {
    const name = `${version}_recorded`;
    await db.query(
      `insert into supabase_migrations.schema_migrations (version, name) values ($1, $2)
       on conflict (version) do nothing`,
      [version, name],
    );
  }
}

const REPO_VERSIONS = Array.from({ length: 103 }, (_, i) => String(i + 1).padStart(4, '0')).filter(
  (v) => v !== '0061',
);

describe('0109 dependency diagnostic (read-only, owner-run)', () => {
  const openDbs: PGlite[] = [];
  afterAll(async () => {
    for (const db of openDbs) await db.close();
  });

  it('contains no write statement and no migration-repair instruction', () => {
    const sql = readFileSync(SCRIPT, 'utf8');
    const stmts = statements(sql);
    expect(stmts.length).toBeGreaterThanOrEqual(10);
    for (const stmt of stmts) {
      expect(stmt, `non-SELECT statement: ${stmt.slice(0, 80)}`).toMatch(/^(select|with)\b/i);
    }
    // The words may appear in prose comments, but no executable statement may
    // start a write. Scan only the de-commented statement text.
    for (const stmt of stmts) {
      expect(stmt, 'write keyword inside a statement').not.toMatch(
        /(^|\s)(insert\s+into|update\s+\w+\s+set|delete\s+from|alter\s+table|drop\s+table|create\s+table|create\s+policy|grant\s+|revoke\s+|truncate\s)/i,
      );
    }
  });

  it('runs unchanged on the live production baseline (0001..0103) without raising', async () => {
    const db = await createMigratedDb({ lastMigration: '0103_security_advisor_remediation.sql' });
    openDbs.push(db);
    await withLedger(db, REPO_VERSIONS);

    const sql = readFileSync(SCRIPT, 'utf8');
    const stmts = statements(sql);
    const results = await db.transaction(async (tx) => {
      await tx.exec('set transaction read only');
      const rows: unknown[] = [];
      for (const stmt of stmts) rows.push((await tx.query(stmt)).rows);
      return rows;
    });
    expect(results).toHaveLength(stmts.length);

    // Block 1 — all 19 guard objects resolve at the 0103 baseline.
    const verdict = results[0] as Array<{ verdict: string; required_object: string }>;
    expect(verdict).toHaveLength(19);
    expect(verdict.filter((r) => r.verdict !== 'PRESENT')).toEqual([]);

    // Block 2 — summary conclusion.
    const summary = results[1] as Array<{ missing: number; conclusion: string }>;
    expect(summary[0]!.missing).toBe(0);
    expect(summary[0]!.conclusion).toContain('GUARD SHOULD PASS');

    // Block 6 — 0107 not in force on production today (must not raise 42703 even
    // though products.description does not exist yet).
    const ordering = results[5] as Array<Record<string, unknown>>;
    expect(ordering[0]!.description_column_exists).toBe(false);
    expect(ordering[0]!.authenticated_can_read_cost_price).toBe(true);
    expect(String(ordering[0]!.verdict)).toContain('0107 NOT IN FORCE');
  }, 180_000);

  it('reports a genuinely missing dependency as MISSING instead of crashing', async () => {
    const db = await createMigratedDb({ lastMigration: '0103_security_advisor_remediation.sql' });
    openDbs.push(db);
    await withLedger(db, REPO_VERSIONS);
    await db.exec('drop table public.supplier_application_rate_limits cascade');

    const sql = readFileSync(SCRIPT, 'utf8');
    const stmts = statements(sql);
    const results = await db.transaction(async (tx) => {
      await tx.exec('set transaction read only');
      const rows: unknown[] = [];
      for (const stmt of stmts) rows.push((await tx.query(stmt)).rows);
      return rows;
    });

    const verdict = results[0] as Array<{ required_object: string; verdict: string; created_by: string }>;
    const missing = verdict.filter((r) => r.verdict === 'MISSING');
    expect(missing).toHaveLength(1);
    expect(missing[0]!.required_object).toBe('public.supplier_application_rate_limits');
    expect(missing[0]!.created_by).toBe('0060_supplier_application_rate_limit');

    const summary = results[1] as Array<{ missing: number; conclusion: string }>;
    expect(summary[0]!.missing).toBe(1);
    expect(summary[0]!.conclusion).toContain('GUARD WILL FAIL');
  }, 180_000);
});
