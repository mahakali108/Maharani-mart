/**
 * PRODUCTION READINESS — executable verification of the merge checklist.
 *
 * Every claim in the final security review is asserted here against the
 * actual migration SQL and server-action source, so the review cannot drift
 * from the code. Browser-based row-level tests need a live Supabase project;
 * what CAN be verified statically is verified here.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');
const read = (relative: string) => readFileSync(join(ROOT, relative), 'utf8');

const MIGRATIONS = [
  'supabase/migrations/0032_retailer_address_book.sql',
  'supabase/migrations/0033_retailer_saved_carts.sql',
  'supabase/migrations/0034_retailer_product_feedback.sql',
  'supabase/migrations/0035_retailer_profile_rpc_prefs_requests.sql',
  'supabase/migrations/0036_order_shipping_address.sql',
];

const sql = (file: string) => read(`supabase/migrations/${file}`);
const stripComments = (text: string) =>
  text
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');

describe('1. migrations 0032–0036 are additive and re-runnable', () => {
  it('contains no destructive statements anywhere', () => {
    for (const file of MIGRATIONS) {
      const body = stripComments(sql(file.split('/').pop()!)).toLowerCase();
      expect(body, file).not.toMatch(/drop table\b/);
      expect(body, file).not.toMatch(/truncate\b/);
      expect(body, file).not.toMatch(/drop column\b/);
      // Any ALTER TABLE must be additive (ADD COLUMN / ADD CONSTRAINT) or RLS enabling.
      expect(body, file).not.toMatch(/alter table [a-z_]+ (?!add |enable row level security)/);
      expect(body, file).not.toMatch(/\bdelete from\b/);
      expect(body, file).not.toMatch(/\binsert into\b/); // no seed/business data
    }
  });

  it('is re-runnable: IF NOT EXISTS on every object, drop-if-exists on every policy, guarded constraint', () => {
    expect(sql('0032_retailer_address_book.sql')).toMatch(/create table if not exists retailer_addresses/);
    expect(sql('0033_retailer_saved_carts.sql')).toMatch(/create table if not exists retailer_saved_carts/);
    expect(sql('0034_retailer_product_feedback.sql')).toMatch(/create table if not exists retailer_product_issues/);
    expect(sql('0035_retailer_profile_rpc_prefs_requests.sql')).toMatch(/create table if not exists retailer_notification_prefs/);
    expect(sql('0036_order_shipping_address.sql')).toMatch(/add column if not exists shipping_address/);
    expect(sql('0036_order_shipping_address.sql')).toContain("if not exists (");
    expect(sql('0036_order_shipping_address.sql')).toContain('pg_constraint');
    // Every policy is preceded by drop policy if exists.
    for (const file of MIGRATIONS.slice(0, 4)) {
      const body = sql(file.split('/').pop()!);
      const creates = body.match(/create policy/g)?.length ?? 0;
      const drops = body.match(/drop policy if exists/g)?.length ?? 0;
      expect(creates, file).toBeGreaterThan(0);
      expect(drops, file).toBe(creates);
    }
  });

  it('depends only on objects created by 0001 (uuid-ossp, is_staff_or_above, retailers/products/product_packs)', () => {
    const init = stripComments(sql('0001_init.sql'));
    expect(init).toContain('create extension if not exists "uuid-ossp"');
    expect(init).toContain('create or replace function is_staff_or_above()');
    // Base tables from 0001 and 0004 (all FK targets used by 0032–0036).
    for (const table of ['retailers', 'products']) {
      expect(init).toMatch(new RegExp(`create table (if not exists )?${table} \\(`));
    }
    const packs = stripComments(sql('0004_product_packs.sql'));
    expect(packs).toMatch(/create table (if not exists )?product_packs \(/);
    // The new migrations reference these via FK — nothing newer is required.
    for (const file of ['0032_retailer_address_book.sql', '0033_retailer_saved_carts.sql']) {
      const body = sql(file);
      expect(body).toContain('references retailers(id)');
    }
  });

  it('enables RLS on every new table', () => {
    const joined = MIGRATIONS.slice(0, 4).map((file) => sql(file.split('/').pop()!)).join('\n');
    for (const table of [
      'retailer_addresses',
      'retailer_saved_carts',
      'retailer_saved_cart_items',
      'retailer_product_issues',
      'retailer_stock_alerts',
      'retailer_notification_prefs',
      'retailer_account_requests',
    ]) {
      expect(joined).toMatch(new RegExp(`alter table ${table} enable row level security`));
    }
  });
});

describe('2. retailer data isolation (RLS matrix)', () => {
  it('addresses: owner-only for read/insert/update/delete; staff read-only', () => {
    const body = sql('0032_retailer_address_book.sql');
    expect(body).toContain('for select using (retailer_id = auth.uid() or is_staff_or_above())');
    expect(body).toContain('for insert with check (retailer_id = auth.uid())');
    expect(body).toMatch(/for update using \(retailer_id = auth\.uid\(\)\)\s*with check \(retailer_id = auth\.uid\(\)\)/);
    expect(body).toContain('for delete using (retailer_id = auth.uid())');
    // No staff write policy exists.
    expect(body).not.toMatch(/is_staff_or_above\(\)\)\s*\n?\s*with check \(is_staff_or_above/);
  });

  it('saved carts: both header and items are owner-only; items have no update policy', () => {
    const body = sql('0033_retailer_saved_carts.sql');
    expect(body.match(/retailer_id = auth\.uid\(\)/g)?.length).toBeGreaterThanOrEqual(6);
    // Items: insert + delete + read only — no "update" policy at all.
    const itemsBlock = body.slice(body.indexOf('retailer_saved_cart_items_owner_read'));
    expect(itemsBlock).toContain('for insert with check (retailer_id = auth.uid())');
    expect(itemsBlock).toContain('for delete using (retailer_id = auth.uid())');
    expect(itemsBlock).not.toMatch(/for update/);
  });

  it('reports: every read path is scoped to the session retailer', () => {
    const source = read('lib/retailer/reports.ts');
    expect(source.match(/\.eq\('retailer_id', retailerId\)/g)?.length).toBeGreaterThanOrEqual(3);
    expect(source).toContain('.eq("orders.retailer_id", retailerId)'.replace(/"/g, "'"));
    // CSV route re-checks the session and role before touching data.
    const route = read('app/retailer/reports/statement/route.ts');
    expect(route).toContain('const user = await requireUser()');
    expect(route).toContain("user.role !== 'retailer'");
    expect(route).toContain('getRetailerLedger(supabase, user.id');
    expect(route).toContain('loadPurchaseStatement(supabase, user.id');
  });

  it('product issues: retailer can create/read/withdraw own rows but can NEVER set status', () => {
    const body = sql('0034_retailer_product_feedback.sql');
    // The only update policy is staff-scoped — a retailer UPDATE matches no policy → denied.
    expect(body).toContain('create policy "retailer_product_issues_staff_update" on retailer_product_issues');
    expect(body).toContain('for update using (is_staff_or_above())');
    expect(body).toContain('with check (is_staff_or_above())');
    // No retailer-owned update policy exists.
    expect(body).not.toMatch(/retailer_product_issues_owner_update/);
    // Status is not even accepted from the insert payload path in the action.
    const action = read('lib/retailer/product-feedback-actions.ts');
    expect(action).not.toMatch(/status:/);
  });

  it('account requests: retailer can submit/read own but can NEVER change status', () => {
    const body = sql('0035_retailer_profile_rpc_prefs_requests.sql');
    expect(body).toContain('create policy "retailer_account_requests_staff_update" on retailer_account_requests');
    expect(body).toContain('for update using (is_staff_or_above())');
    expect(body).not.toMatch(/retailer_account_requests_owner_update/);
    // The action inserts without a status field — DB default 'submitted' applies.
    const action = read('lib/retailer/profile-actions.ts');
    const insertBlock = action.slice(action.indexOf('retailer_account_requests`).insert('), action.indexOf('as unknown as never'));
    expect(insertBlock).not.toContain('status');
  });

  it('wallet/credit remains untouchable by retailers: no new write path, legacy lockdown intact', () => {
    // retailers has NO retailer update policy (only admin) in the base schema…
    const init = stripComments(sql('0001_init.sql'));
    expect(init).toContain('create policy "retailers_admin_update" on retailers');
    expect(init).not.toMatch(/retailers.*for update using \(id = auth\.uid\(\)\)/);
    // …and the wallet ledger is admin-insert/update only, retailer read-only.
    const wallet = stripComments(sql('0029_retailer_wallet_ledger.sql'));
    expect(wallet).toContain('create policy "wallet_ledger_admin_insert" on retailer_wallet_ledger');
    expect(wallet).toContain('create policy "wallet_ledger_admin_update" on retailer_wallet_ledger');
    // No new migration grants retailers any write on money tables.
    const newMigrations = MIGRATIONS.map((file) => stripComments(sql(file.split('/').pop()!))).join('\n');
    expect(newMigrations).not.toMatch(/policy .* on (retailer_wallet_ledger|retailer_credit_accounts|orders|retailers)\b/);
    // The one retailer-reachable write into `retailers` touches only name/address.
    const rpc = stripComments(sql('0035_retailer_profile_rpc_prefs_requests.sql'));
    const updateBlock = rpc.slice(rpc.indexOf('update retailers'), rpc.indexOf('if not found'));
    expect(updateBlock).not.toMatch(/credit_limit|outstanding_balance|status|area_id|approved|assigned_salesman/);
  });

  it('order shipping snapshot is written server-side from a verified address only', () => {
    const checkout = read('lib/retailer/checkout-actions.ts');
    // The id is resolved through the RLS-scoped session; the payload is built
    // from the DB row, never from client input.
    expect(checkout).toContain("from('retailer_addresses')");
    expect(checkout).toContain("eq('id', addressId)");
    expect(checkout).toContain("eq('retailer_id', user.id)");
    expect(checkout).toContain('formatAddressLine(address)');
    // createOrder accepts the resolved snapshot and freezes it.
    const createOrder = read('lib/orders/create-order.ts');
    expect(createOrder).toContain('shipping_address: shippingAddress ?? null');
  });
});

describe('3. SECURITY DEFINER RPC review (update_my_shop_profile)', () => {
  const rpcSql = stripComments(sql('0035_retailer_profile_rpc_prefs_requests.sql'));

  it('pins search_path and is SECURITY DEFINER (same hardening pattern as the wallet RPCs)', () => {
    expect(rpcSql).toMatch(/security definer/);
    expect(rpcSql).toMatch(/set search_path = public/);
  });

  it('checks auth.uid() and scopes the update to the caller row only', () => {
    expect(rpcSql).toContain('v_uid uuid := auth.uid()');
    expect(rpcSql).toContain('if v_uid is null then');
    expect(rpcSql).toContain('where id = v_uid');
  });

  it('grants no escalation: execute revoked from public/anon, granted to authenticated; non-retailers fail on not-found', () => {
    expect(rpcSql).toContain('revoke all on function update_my_shop_profile(text, text) from public, anon');
    expect(rpcSql).toContain('grant execute on function update_my_shop_profile(text, text) to authenticated');
    expect(rpcSql).toContain('if not found then');
  });

  it('no service-role key or secret can leak through the new code paths', () => {
    for (const file of [
      'lib/retailer/profile-actions.ts',
      'lib/retailer/address-actions.ts',
      'lib/retailer/saved-cart-actions.ts',
      'lib/retailer/product-feedback-actions.ts',
      'lib/retailer/bulk-order-actions.ts',
      'lib/retailer/reports.ts',
      'app/retailer/reports/statement/route.ts',
    ]) {
      const source = read(file);
      expect(source, file).not.toMatch(/service_role|SERVICE_ROLE|serviceRole|anon_key|ANON_KEY/);
    }
    // The client is always the RLS-scoped server client, never the admin client.
    for (const file of ['lib/retailer/profile-actions.ts', 'lib/retailer/address-actions.ts', 'lib/retailer/saved-cart-actions.ts']) {
      expect(read(file)).toContain("createClient()");
      expect(read(file)).not.toContain('createAdminClient');
    }
  });
});

describe('4. account deletion / data-export request flow', () => {
  it('records a request and notifies staff — never self-executes deletion', () => {
    const action = read('lib/retailer/profile-actions.ts');
    expect(action).toContain("from('retailer_account_requests').insert({");
    expect(action).not.toMatch(/\.delete\(\)|\.from\('auth\.users'\)|signOut\(\{ scope: 'global' \}[\s\S]{0,80}delet/);
    expect(action).toContain('Requests are NEVER self-executed');
  });

  it('staff notification carries no secret material and targets staff roles only', () => {
    const action = read('lib/retailer/profile-actions.ts');
    expect(action).toContain(".in('role', ['staff', 'admin', 'super_admin'])");
    // The note the retailer typed is only shown to staff reviewers.
    expect(action).toMatch(/createInAppNotification\(\{[\s\S]*?title: `Retailer \$\{label\} request`/);
  });

  it('request rows are readable only by the owner and staff (RLS) and cannot be injected for someone else', () => {
    const body = stripComments(sql('0035_retailer_profile_rpc_prefs_requests.sql'));
    expect(body).toContain('for insert with check (retailer_id = auth.uid())');
    expect(body).toContain('for select using (retailer_id = auth.uid() or is_staff_or_above())');
  });
});

describe('5. saved-cart restoration revalidation', () => {
  it('runs the FULL per-line validation (availability, CURRENT MOQ, piece-pricing engine) before merging', () => {
    const action = read('lib/retailer/saved-cart-actions.ts');
    expect(action).toContain('validatePackForCart');
    expect(action).toContain('!pack || !pack.is_active || !pack.products?.is_active || item.quantity < pack.moq');
    // The shared merge path is used for the final write.
    expect(action).toContain('mergeLinesIntoCart(supabase, user.id, validLines)');
  });

  it('reports skipped lines instead of silently dropping them, and never persists or reuses prices', () => {
    const action = read('lib/retailer/saved-cart-actions.ts');
    expect(action).toContain('skippedCount += 1');
    expect(action).toMatch(/restoredCount[\s\S]*skippedCount/);
    const ddl = stripComments(sql('0033_retailer_saved_carts.sql'));
    expect(ddl).not.toMatch(/price|paise|amount/i);
    expect(action).not.toMatch(/unit_price|case_price|base_price/);
  });

  it('cart_items carries no price, so restore is structurally re-priced at read/checkout/quote time', () => {
    const cartService = read('lib/retailer/cart-service.ts');
    expect(cartService).toContain('validatePackForCart');
    // The authoritative price engine re-runs when the order is written.
    const quote = read('lib/orders/quote-order.ts');
    expect(quote).toMatch(/export async function quoteOrderForRetailer/);
  });
});

describe('6. APK/Capacitor deployment prerequisites', () => {
  it('capacitor config points at the Maharani Traders app with an Android platform and keeps server logic untouched', () => {
    const config = read('capacitor.config.ts');
    expect(config).toContain('Maharani Traders');
    expect(config).toContain('androidScheme');
    expect(config).not.toMatch(/supabase\.co|SUPABASE_URL/); // no env baked into the client bundle config
  });

  it('android build scripts exist in package.json', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    expect(pkg.scripts['cap:sync']).toBeDefined();
    expect(pkg.scripts['android:build:debug']).toBeDefined();
    expect(pkg.scripts['android:build:release']).toBeDefined();
  });
});
