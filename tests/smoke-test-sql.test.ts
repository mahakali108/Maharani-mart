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
const migration0046 = readFileSync(
  join(__dirname, '..', 'supabase', 'migrations', '0046_smoke_fixture.sql'),
  'utf8',
);

/**
 * Strips SQL line comments, block comments and single-quoted string literals,
 * leaving only executable SQL. Needed because the fixture table name
 * legitimately appears inside comments and inside catalog string literals
 * (`relname = 'smoke_personas'`), neither of which is a relation reference.
 */
function executableSql(src: string): string {
  let out = '';
  for (let i = 0; i < src.length; ) {
    const two = src.slice(i, i + 2);
    if (two === '--') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (two === '/*') {
      const end = src.indexOf('*/', i + 2);
      i = end === -1 ? src.length : end + 2;
      continue;
    }
    if (src[i] === "'") {
      i++;
      while (i < src.length) {
        if (src[i] === "'") {
          if (src[i + 1] === "'") {
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    out += src[i];
    i++;
  }
  return out;
}

describe('smoke-test.sql structure', () => {
  it('runs everything inside a transaction and rolls back (no seed data persists)', () => {
    expect(sql).toContain('BEGIN;');
    // Rollback must come after the last assertion block.
    expect(sql.lastIndexOf('ROLLBACK;')).toBeGreaterThan(sql.lastIndexOf('DO $$'));
    // The one transaction opens before the fixture row is written.
    expect(sql.indexOf('BEGIN;')).toBeLessThan(sql.indexOf('insert into smoke_fixture.smoke_personas'));
    // The fixture row is deleted as well, so even an executor that commits per
    // statement leaves the scratch table empty.
    expect(sql).toContain('delete from smoke_fixture.smoke_personas;');
  });

  it('reads its fixture from the migration-created table, never from a session-scoped temp table', () => {
    // Regression guard for `ERROR 42P01: relation "smoke_personas" does not
    // exist`: a fixture kept in a TEMP table only exists inside the one session
    // that created it, so a partial run, a pooled executor or a second SQL
    // Editor tab loses it. The fixture must come from a committed table.
    const code = sql
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n');
    expect(code).not.toMatch(/\bcreate\s+temp(orary)?\s+table\b/i);
    expect(code).not.toContain('pg_temp');
    expect(code).not.toMatch(/smoke_orders|smoke_transition_order/);

    const migration = readFileSync(
      join(__dirname, '..', 'supabase', 'migrations', '0046_smoke_fixture.sql'),
      'utf8',
    );
    expect(migration).toContain('create table if not exists smoke_fixture.smoke_personas');
    expect(migration).toContain('grant select on smoke_fixture.smoke_personas to authenticated');
    expect(migration).toContain('enable row level security');
    // Every fixture read goes through that one table.
    expect((sql.match(/smoke_fixture\.smoke_personas/g) ?? []).length).toBeGreaterThan(30);
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

describe('smoke fixture table name is standardized', () => {
  // The fixture table has ONE canonical name, owned by migration 0046:
  // `smoke_fixture.smoke_personas`. It is schema-qualified everywhere it is
  // used, and no second fixture table exists. These checks keep that from
  // drifting — a reference to a name 0046 never created fails at runtime with
  // `42P01: relation "..." does not exist`, which is exactly the class of
  // failure migration 0046 exists to prevent.

  const canonical = 'smoke_fixture.smoke_personas';

  it('migration 0046 creates exactly one fixture table, and it is the canonical one', () => {
    const created = [
      ...migration0046.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?([a-z_.]+)/gi),
    ].map((m) => m[1]);
    expect(created).toEqual([canonical]);
    // Not in `public`: the schema is what keeps it out of the PostgREST API.
    expect(canonical).toMatch(/^smoke_fixture\./);
  });

  it('every executable reference in the smoke test is schema-qualified', () => {
    const code = executableSql(sql).split(canonical).join('<FIXTURE>');
    // Anything still matching is an unqualified (or differently qualified)
    // relation reference, i.e. a name 0046 never created.
    expect(code).not.toContain('smoke_personas');
    expect((executableSql(sql).match(/smoke_fixture\.smoke_personas/g) ?? []).length).toBeGreaterThan(30);
  });

  it('migration 0046 only mentions the bare name in its constraint/policy object names', () => {
    const code = executableSql(migration0046).split(canonical).join('<FIXTURE>');
    expect(code).not.toMatch(/smoke_personas(?!_single_row|_read)/);
  });

  it('no file references a fixture table 0046 does not create', () => {
    const script = join(__dirname, '..', 'scripts', 'production-validate.sh');
    const checklist = join(__dirname, '..', 'docs', 'PRODUCTION_VERIFICATION_CHECKLIST.md');
    const paths = [
      join(__dirname, '..', 'supabase', 'smoke-test.sql'),
      join(__dirname, '..', 'supabase', 'migrations', '0046_smoke_fixture.sql'),
      script,
      join(__dirname, '..', 'README.md'),
      checklist,
      join(__dirname, '..', 'docs', 'PHASE1_AUDIT_FEATURE_MATRIX.md'),
    ];
    for (const p of paths) {
      expect(readFileSync(p, 'utf8')).not.toContain('smoke_test_personas');
    }
    // The runner and the docs point at the same qualified table the migration
    // creates, so they cannot drift onto a name that does not exist.
    expect(readFileSync(script, 'utf8')).toContain(`to_regclass('${canonical}')`);
    expect(readFileSync(checklist, 'utf8')).toContain(`select count(*) from ${canonical};`);
  });
});
