import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Contract: the Web CI workflow MUST run migration validation as an explicit,
 * separately named step — never folded invisibly into a generic test run and
 * never delegated to the hosted "Supabase Preview" check, which is SKIPPED on
 * the Free plan (preview branches are paid) and therefore proves nothing.
 *
 * Why this test exists
 * --------------------
 * 2026-11-17 audit found the PR #137 "Supabase Preview" check in state
 * SKIPPED while the Supabase branch reported MIGRATIONS_FAILED. A skipped
 * check must never be mistaken for a successful migration test. The real
 * gate is PGlite (in-process PostgreSQL 16, no credentials): each suite below
 * applies EVERY file in `supabase/migrations` in order via
 * `tests/helpers/pg-harness.ts`, then exercises Phase 3 behaviour, the
 * guarded 0109 rollback, and the security/privilege hardening invariants.
 *
 * What this guards against
 * ------------------------
 *   - the gate step being deleted or renamed in a future workflow edit;
 *   - a gate suite being renamed/removed so CI silently stops running it
 *     (vitest errors on a missing positional filter, but only in CI — this
 *     test makes the drift visible locally too);
 *   - the main test step and the gate step drifting apart so a suite either
 *     runs twice (wasted minutes on a free plan) or not at all.
 */

const WORKFLOW_PATH = path.join(__dirname, '..', '.github', 'workflows', 'ci.yml');
const TESTS_DIR = path.join(__dirname);

/**
 * The nine suites that constitute the migration/security gate. Order matters
 * only for readability; membership must match the CI workflow exactly.
 */
const GATE_SUITES = [
  'tests/migration-reservations.test.ts',
  'tests/migration-catalog-invariants.test.ts',
  'tests/security-advisor-remediation-db.test.ts',
  'tests/security-definer-hardening-db.test.ts',
  'tests/privilege-hardening-db.test.ts',
  'tests/publishing-integrity-0108-db.test.ts',
  'tests/super-admin-bootstrap-db.test.ts',
  'tests/phase3-business-control-db.test.ts',
  'tests/phase3-rollback-protection-db.test.ts',
] as const;

const GATE_STEP_NAME = 'Migration chain, rollback & security gate (PGlite)';

describe('Web CI migration gate contract', () => {
  const workflow = readFileSync(WORKFLOW_PATH, 'utf8');

  it('has a dedicated, named migration/rollback/security gate step', () => {
    expect(workflow).toContain(`- name: ${GATE_STEP_NAME}`);
  });

  it('runs every gate suite in the dedicated step', () => {
    const gateStepIndex = workflow.indexOf(`- name: ${GATE_STEP_NAME}`);
    expect(gateStepIndex).toBeGreaterThan(-1);
    // The gate step is the last test-related step; slice to the next step or
    // end of file so we only inspect this step's run block.
    const rest = workflow.slice(gateStepIndex);
    const nextStepIndex = rest.indexOf('\n      - name:', 1);
    const gateBlock = nextStepIndex === -1 ? rest : rest.slice(0, nextStepIndex);
    for (const suite of GATE_SUITES) {
      expect(gateBlock, `gate step must run ${suite}`).toContain(suite);
    }
  });

  it('keeps the full-suite step on the repo script (`pnpm test`) so CI runs exactly what developers run', () => {
    const mainStepIndex = workflow.indexOf('- name: Unit and integration tests');
    expect(mainStepIndex).toBeGreaterThan(-1);
    const rest = workflow.slice(mainStepIndex);
    const nextStepIndex = rest.indexOf('\n      - name:', 1);
    const mainBlock = nextStepIndex === -1 ? rest : rest.slice(0, nextStepIndex);
    expect(mainBlock).toContain('run: corepack pnpm test');
    // No filtering: the main step must not silently drop suites.
    expect(mainBlock).not.toContain('--exclude');
  });

  it('every gate suite file exists on disk', () => {
    for (const suite of GATE_SUITES) {
      const fileName = suite.replace(/^tests\//, '');
      expect(existsSync(path.join(TESTS_DIR, fileName)), `${suite} must exist`).toBe(true);
    }
  });

  it('every DB gate suite applies the full migration chain via the PGlite harness', () => {
    for (const suite of GATE_SUITES) {
      if (!suite.endsWith('-db.test.ts')) continue;
      const fileName = suite.replace(/^tests\//, '');
      const source = readFileSync(path.join(TESTS_DIR, fileName), 'utf8');
      // createMigratedDb()/migration helpers in tests/helpers/pg-harness.ts
      // apply EVERY file in supabase/migrations in order — that application
      // IS the fresh-install migration test for the whole chain.
      expect(source, `${suite} must build its database through the pg-harness`).toMatch(
        /pg-harness/
      );
    }
  });

  it('documents that a skipped Supabase Preview check is not a migration test', () => {
    expect(workflow).toMatch(/Supabase Preview/);
    expect(workflow).toMatch(/SKIPPED/);
  });
});
