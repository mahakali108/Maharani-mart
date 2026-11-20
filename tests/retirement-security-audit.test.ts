import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RETIRED_ROUTE_PREFIXES, isRetiredPath } from '@/lib/auth/roles';

/**
 * SECURITY AUDIT for the seller/supplier retirement.
 *
 * These are repository-level (source) assertions. The behaviour they describe is
 * also proven against a real PostgreSQL 16 in
 * tests/migration-0110-*.test.ts and tests/mobile-checkout-atomic-db.test.ts;
 * this suite is the belt-and-braces check that the source cannot regress into
 * re-exposing a retired capability.
 */

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), 'utf8');

describe('retired routes are gone, and known by the router', () => {
  it('has no page for any retired prefix', () => {
    for (const prefix of RETIRED_ROUTE_PREFIXES) {
      const dir = join(root, 'app', prefix.replace(/^\//, ''));
      let exists = false;
      try {
        exists = statSync(dir).isDirectory();
      } catch {
        exists = false;
      }
      expect(exists, `${prefix} must not exist as a route directory`).toBe(false);
    }
  });

  it('recognises every retired prefix, including nested paths', () => {
    for (const prefix of RETIRED_ROUTE_PREFIXES) {
      expect(isRetiredPath(prefix), prefix).toBe(true);
      expect(isRetiredPath(`${prefix}/anything/at/all`), prefix).toBe(true);
    }
    // A live route that merely starts with the same letters must NOT be treated
    // as retired (e.g. /retailer must not collide with a /ret prefix).
    expect(isRetiredPath('/retailer/orders')).toBe(false);
    expect(isRetiredPath('/admin/orders')).toBe(false);
  });

  it('keeps the middleware short-circuit ahead of the auth redirect', () => {
    // A retired path must answer as retired even for a signed-in Super Admin,
    // rather than falling through to a role check that could reveal a page.
    const middleware = read('middleware.ts');
    const retiredAt = middleware.indexOf('isRetiredPath(pathname)');
    const authAt = middleware.indexOf('isProtectedPath(pathname)');
    expect(retiredAt).toBeGreaterThan(-1);
    expect(authAt).toBeGreaterThan(-1);
    expect(retiredAt).toBeLessThan(authAt);
  });
});

describe('no live source links to a retired route', () => {
  const files: string[] = [];
  function walk(dir: string) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry)) files.push(full);
    }
  }
  walk(join(root, 'app'));
  walk(join(root, 'components'));
  walk(join(root, 'lib'));

  it('contains no href/router.push/revalidatePath to a retired path', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const line of source.split('\n')) {
        // Ignore the retirement definitions/comments themselves.
        if (/^\s*(\*|\/\/)/.test(line)) continue;
        if (/(href|router\.(push|replace)|revalidatePath|redirect)\s*[=(]/.test(line)) {
          for (const prefix of RETIRED_ROUTE_PREFIXES) {
            if (line.includes(`'${prefix}`) || line.includes(`"${prefix}`) || line.includes(`\`${prefix}`)) {
              offenders.push(`${file.replace(root + '/', '')}: ${line.trim()}`);
            }
          }
        }
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });
});

describe('the migration cannot leak a retired capability back', () => {
  const migration = read('supabase/migrations/0110_retire_seller_supplier_marketplace.sql');

  it('gives every SECURITY DEFINER function it creates a fixed search_path', () => {
    const blocks = migration.split('create or replace function ').slice(1);
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) {
      const name = block.slice(0, block.indexOf('('));
      if (!block.includes('security definer')) continue;
      const header = block.slice(0, block.indexOf('as $'));
      expect(header, `${name} must pin search_path`).toContain('set search_path');
    }
  });

  it('revokes the re-role helper from every API role', () => {
    expect(migration).toMatch(
      /revoke all on function public\.retire_promote_dual_role_seller\(uuid\) from public, anon, authenticated/,
    );
    expect(migration).toMatch(
      /grant execute on function public\.retire_promote_dual_role_seller\(uuid\) to service_role/,
    );
  });

  it('protects the Super Admin activation surface', () => {
    // Block 12. `authenticated` holds EXECUTE so the function can run in the Super
    // Admin's own session and record the real actor via auth.uid() - the same
    // pattern 0081's admin RPCs use. Authorization is the NULL-SAFE
    // `is distinct from 'super_admin'` check inside the function, which no caller
    // can influence. `anon` gets nothing at all.
    expect(migration).toMatch(
      /revoke all on function public\.admin_activate_retailer\(uuid, text, text\) from public, anon/,
    );
    expect(migration).toMatch(
      /grant execute on function public\.admin_activate_retailer\(uuid, text, text\) to authenticated, service_role/,
    );
    // The activation ledger itself is never writable through the API.
    expect(migration).toMatch(
      /revoke insert, update, delete on public\.retailer_activation_ledger from anon, authenticated/,
    );
    // `<>` on a nullable role is NULL, i.e. not TRUE, i.e. a bypass. Assert the
    // NULL-safe comparison is what is actually written.
    const superAdminChecks = migration.match(/public\.current_user_role\(\) is distinct from 'super_admin'/g) ?? [];
    expect(superAdminChecks.length).toBeGreaterThanOrEqual(2);
    expect(migration).not.toMatch(/public\.current_user_role\(\) <> 'super_admin'/);
  });

  it('keeps the checkout RPC service_role-only', () => {
    expect(migration).toMatch(
      /revoke all on function public\.create_order_atomic\([^)]*\) from public, anon, authenticated/,
    );
    expect(migration).toMatch(
      /grant execute on function public\.create_order_atomic\([^)]*\) to service_role/,
    );
  });

  it('does not drop any table, column or enum value', () => {
    // The whole point of the migration: revoke, never drop.
    expect(migration).not.toMatch(/^\s*drop table/m);
    expect(migration).not.toMatch(/^\s*alter table[^;]*drop column/m);
    expect(migration).not.toMatch(/^\s*drop type/m);
  });

  it('preserves the membership predicates that live RLS policies call', () => {
    // Revoking these breaks migration application itself (a revoked function
    // makes a dependent policy raise instead of returning false).
    expect(migration).not.toMatch(/revoke[^;]*on function public\.is_member_of_seller/);
    expect(migration).not.toMatch(/revoke[^;]*on function public\.is_active_seller_member/);
  });

  it('adds the pack-only checkout guard before the offer lookup', () => {
    const guardAt = migration.indexOf('SELLER_OFFERS_RETIRED');
    expect(guardAt).toBeGreaterThan(-1);
    // The guard must be in the v1 RPC body, and it must precede the historical
    // seller-offer branch so a caller is told the marketplace is gone.
    const bodyStart = migration.indexOf('create or replace function public.create_order_atomic(');
    expect(guardAt).toBeGreaterThan(bodyStart);
  });
});

describe('the rollback reverses only what the migration did', () => {
  const rollback = read('supabase/rollbacks/0110_retire_seller_supplier_marketplace.down.sql');

  it('restores from recorded before-state rather than from a role predicate', () => {
    expect(rollback).toContain("a.old_data ->> 'role'");
    expect(rollback).toContain("a.old_data ->> 'is_active'");
    expect(rollback).toContain("a.new_data ->> 'source' in ('migration 0110'");
    // A blanket demotion would be the bug this replaced.
    expect(rollback).not.toMatch(/update public\.profiles\s+set role = 'seller'\s+where role::text = 'retailer'/);
  });

  it('skips a profile whose state changed since the migration', () => {
    expect(rollback).toContain('v_skipped');
    expect(rollback).toMatch(/continue;/);
  });

  it('is explicitly opt-in', () => {
    expect(rollback).toContain("maharani.reactivate_seller_profiles");
    expect(rollback).toContain("<> 'true'");
  });

  it('restores the 0081 approval workflow so it cannot re-role after rollback', () => {
    const restoreAt = rollback.indexOf('create or replace function public.admin_review_retailer_application');
    expect(restoreAt).toBeGreaterThan(-1);
    // The restored body must NOT contain the 0110 promotion step.
    const restoredBody = rollback.slice(restoreAt);
    expect(restoredBody).not.toContain('profile_role_promoted := true');
  });
});

describe('sensitive data stays server-side', () => {
  it('never selects cost_price into a retailer-facing payload', () => {
    const retailer = join(root, 'app', 'retailer');
    const files: string[] = [];
    function walk(dir: string) {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(entry)) files.push(full);
      }
    }
    walk(retailer);
    const offenders = files.filter((f) => /cost_price/.test(readFileSync(f, 'utf8')));
    expect(offenders.map((f) => f.replace(root + '/', ''))).toEqual([]);
  });
});
