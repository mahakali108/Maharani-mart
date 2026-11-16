/**
 * SERVER-ACTION ATTACK-SURFACE AUDIT (regression for the production
 * stability audit).
 *
 * In a `'use server'` module EVERY exported async function becomes a
 * remotely invocable HTTP endpoint — whether or not any page imports it.
 * Three defects were found and fixed under this rule:
 *
 *   1. `productIdsForOrder` (lib/admin/orders-actions.ts) — an unused,
 *      unguarded exported action that let any authenticated caller probe
 *      order_items through the action transport. Removed.
 *   2. `seedDefaultPackForProduct` (lib/admin/products-actions.ts) — an
 *      internal helper taking a Supabase client parameter, exported only so
 *      the CSV importer could share it. Moved to lib/admin/pack-seed.ts
 *      (a plain server-only module, not an action endpoint).
 *   3. `ensureDefaultAddress` (lib/retailer/address-actions.ts) — same
 *      pattern; export removed.
 *
 * This test statically enforces the convention so the defects cannot
 * reappear:
 *
 *   A. No exported async function in a 'use server' module may accept a
 *      Supabase client (or any obviously non-serializable internal object)
 *      as a parameter.
 *   B. Every exported async function in a 'use server' module must be
 *      authorized: either its body calls a recognized guard, or it
 *      delegates to another action in the same module that does, or it is
 *      on the explicit PUBLIC allowlist (login/register/logout flows that
 *      are public by design).
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();

/** Guards that authorize a caller inside an action body. */
const GUARD_CALL = new RegExp(
  [
    'requirePermission\\(',
    'requireSuperAdmin\\(',
    'requireUser\\(',
    'requireApprovedRetailer\\(',
    'requireSeller\\(',
    'requireActiveSeller\\(',
    'requireStaff\\(',
    'requireSalesman\\(',
    'requireAdmin\\(',
    'auth\\.getUser\\(',
    'authorizeMediaWrite\\(',
  ].join('|')
);

/**
 * Actions that are public by design (unauthenticated auth flows). Everything
 * else must guard. Additions to this list need a security review.
 */
/**
 * Actions whose guard lives in another module they delegate to. Each entry
 * is verified below: the delegation target must really contain the guard.
 */
const CROSS_MODULE_DELEGATIONS: Record<string, { target: string; guard: RegExp }> = {
  // uploadMediaAction → uploadMedia (lib/media/index.ts) → authorizeMediaWrite
  // (lib/media/access.ts), which performs the session + role + ownership check.
  'lib/media/actions.ts::uploadMediaAction': {
    target: 'lib/media/index.ts',
    guard: /authorizeMediaWrite\(/,
  },
};

const PUBLIC_ALLOWLIST = new Set([
  'lib/auth/actions.ts::loginAction',
  'lib/auth/actions.ts::loginWithPhoneAction',
  'lib/auth/actions.ts::requestPasswordResetAction',
  // Email-OTP sign-in: public BY DESIGN, and the ONLY two OTP endpoints.
  //   requestEmailOtpAction — unauthenticated by definition (the caller has no
  //     session yet). Defences are structural rather than session-based:
  //     `shouldCreateUser: false` (never creates an account), an identical
  //     generic response for every outcome (no account enumeration), a
  //     server-set httpOnly resend cooldown, and GoTrue's own rate limits.
  //   verifyEmailOtpAction — authorizes by possession of the short-lived code
  //     itself; the pending email is read from an httpOnly cookie, never from
  //     the request, and GoTrue performs the comparison. After success the
  //     role/active/approval gate in lib/auth/sign-in-gate.ts runs before any
  //     redirect, so OTP grants no privilege that password login does not.
  'lib/auth/actions.ts::requestEmailOtpAction',
  'lib/auth/actions.ts::verifyEmailOtpAction',
  'lib/auth/actions.ts::resendConfirmationAction',
  'lib/auth/actions.ts::logoutAction',
  'lib/auth/actions.ts::registerRetailerAction',
  'lib/auth/actions.ts::registerSellerAction',
  // Supplier application submission is public BY DESIGN (V1 application-only,
  // owner-approved): it has no session to guard with. Its defences are the
  // honeypot + per-phone throttle in the action and, at the database layer,
  // a SECURITY DEFINER function that can only create a 'pending' row —
  // anon has no SELECT/INSERT grant on `suppliers` (migration 0059, covered
  // by tests/supplier-applications-db.test.ts).
  'lib/admin/supplier-actions.ts::submitSupplierApplicationAction',
  // Session sign-outs: the only effect is ending the caller's own session.
  'lib/retailer/profile-actions.ts::logoutAllSessionsAction',
  'lib/retailer/profile-actions.ts::logoutThisDeviceAction',
]);

function useServerFiles(): string[] {
  const out = execSync(
    `grep -rl "'use server'" lib app --include='*.ts' --include='*.tsx'`,
    { cwd: ROOT, encoding: 'utf8' }
  );
  return out
    .trim()
    .split('\n')
    .filter(Boolean)
    // Only modules whose FIRST statement is 'use server' register actions.
    .filter((f) => {
      const head = readFileSync(path.join(ROOT, f), 'utf8').slice(0, 200);
      return /^\s*(\/\*[\s\S]*?\*\/\s*|\/\/[^\n]*\n\s*)*['"]use server['"]/.test(head);
    });
}

interface ExportedAction {
  file: string;
  name: string;
  body: string;
}

function exportedActions(file: string): ExportedAction[] {
  const src = readFileSync(path.join(ROOT, file), 'utf8');
  const re = /export async function (\w+)/g;
  const marks: { name: string; start: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) marks.push({ name: m[1] ?? '', start: m.index });
  return marks.map((mark, i) => ({
    file,
    name: mark.name,
    body: src.slice(mark.start, marks[i + 1]?.start ?? src.length),
  }));
}

/** Does this action's body call another exported action of the same module? */
function delegatesToGuarded(action: ExportedAction, siblings: ExportedAction[], seen = new Set<string>()): boolean {
  if (GUARD_CALL.test(action.body)) return true;
  if (seen.has(action.name)) return false;
  seen.add(action.name);
  return siblings.some(
    (s) =>
      s.name !== action.name &&
      new RegExp(`\\b${s.name}\\(`).test(action.body) &&
      delegatesToGuarded(s, siblings, seen)
  );
}

describe('server-action surface hygiene', () => {
  const files = useServerFiles();

  it('finds the action modules (sanity)', () => {
    expect(files.length).toBeGreaterThan(30);
  });

  it('A. no exported action accepts a Supabase client parameter', () => {
    const offenders: string[] = [];
    for (const file of files) {
      for (const a of exportedActions(file)) {
        const header = a.body.slice(0, a.body.indexOf('{') === -1 ? 400 : a.body.indexOf('{'));
        if (/supabase\s*:\s*(ReturnType<typeof createClient>|SupabaseClient)/.test(header)) {
          offenders.push(`${file}::${a.name}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('B. every exported action guards, delegates to a guarded action, or is allowlisted public', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const actions = exportedActions(file);
      // Helpers imported from sibling guarded modules count as delegation
      // targets too (e.g. bulkCatalogAction → local guarded functions, or a
      // wrapper that re-exports a guarded flow). We only inspect same-file
      // bodies plus the module's non-exported functions:
      const src = readFileSync(path.join(ROOT, file), 'utf8');
      const localFns: ExportedAction[] = [];
      const reLocal = /(?:^|\n)async function (\w+)/g;
      let m: RegExpExecArray | null;
      while ((m = reLocal.exec(src)) !== null) {
        const start = m.index;
        localFns.push({ file, name: m[1] ?? '', body: src.slice(start, start + 4000) });
      }
      const pool = [...actions, ...localFns];
      for (const a of actions) {
        const key = `${file}::${a.name}`;
        if (PUBLIC_ALLOWLIST.has(key)) continue;
        const cross = CROSS_MODULE_DELEGATIONS[key];
        if (cross) {
          const targetSrc = readFileSync(path.join(ROOT, cross.target), 'utf8');
          expect(cross.guard.test(targetSrc), `${key} delegation target ${cross.target} lost its guard`).toBe(true);
          continue;
        }
        if (!delegatesToGuarded(a, pool)) offenders.push(key);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('regression: the specific audited endpoints stay fixed', () => {
    const orders = readFileSync(path.join(ROOT, 'lib/admin/orders-actions.ts'), 'utf8');
    expect(orders).not.toContain('export async function productIdsForOrder');

    const products = readFileSync(path.join(ROOT, 'lib/admin/products-actions.ts'), 'utf8');
    expect(products).not.toContain('export async function seedDefaultPackForProduct');

    const addresses = readFileSync(path.join(ROOT, 'lib/retailer/address-actions.ts'), 'utf8');
    expect(addresses).not.toContain('export async function ensureDefaultAddress');

    // The shared seeding helper must live in a server-only NON-action module
    // and still be used by both the product form and the CSV importer.
    const seed = readFileSync(path.join(ROOT, 'lib/admin/pack-seed.ts'), 'utf8');
    expect(seed).toContain("import 'server-only'");
    expect(seed).not.toMatch(/^\s*['"]use server['"]/);
    expect(readFileSync(path.join(ROOT, 'lib/admin/products-actions.ts'), 'utf8')).toContain(
      "from '@/lib/admin/pack-seed'"
    );
    expect(readFileSync(path.join(ROOT, 'lib/admin/product-import-actions.ts'), 'utf8')).toContain(
      "from '@/lib/admin/pack-seed'"
    );
  });
});
