import 'server-only';

import type { createClient } from '@/lib/supabase/server';

/**
 * Admin-only purchase-cost reads.
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * Row Level Security restricts rows, not columns. Migration
 * `0025_cost_price_column_lockdown.sql` therefore REVOKES direct
 * `SELECT (cost_price)` on `products` and `product_packs` from the `anon` and
 * `authenticated` roles, so a retailer session can never ask PostgREST for
 * purchase cost and see a distributor margin.
 *
 * The admin product screens still need the value, so 0025 adds three
 * `SECURITY DEFINER` SQL functions gated on `is_admin_or_above()`. This module
 * is the ONLY place in the application that calls them, which keeps the
 * privileged path in one auditable file instead of scattered `.rpc()` calls.
 *
 * SAFETY
 * ------
 * - `server-only`: importing this from a Client Component fails the build, so
 *   a cost value can never be bundled into browser JavaScript by accident.
 * - The gate lives in the database, not here. If a non-admin somehow reaches
 *   one of these helpers the function returns NULL — it never leaks.
 * - Writes are unaffected: INSERT/UPDATE privileges on `cost_price` were not
 *   revoked, so the product/pack forms keep saving cost exactly as before.
 *
 * Reachability: `/admin/**` is restricted to super_admin + admin by
 * `lib/auth/roles.ts`, which is why `is_admin_or_above()` (and not
 * `is_staff_or_above()`) is the right gate — staff never had a route to these
 * reads, so no role loses an existing capability.
 */

type SupabaseClient = ReturnType<typeof createClient>;

/** Purchase cost of one product, or null when unset / caller is below admin. */
export async function loadProductCost(
  supabase: SupabaseClient,
  productId: string
): Promise<number | null> {
  if (!productId) return null;
  // The `as never` casts follow the established convention in this repository
  // (see lib/admin/pricing-actions.ts, team-actions.ts): the installed
  // @supabase/supabase-js `rpc` overload does not resolve the Database
  // Functions generic, so the call is typed at the boundary instead.
  const { data } = await supabase.rpc('admin_product_cost' as never, {
    p_product_id: productId,
  } as never);
  return typeof data === 'number' ? data : null;
}

/** Purchase cost of one pack, or null when unset / caller is below admin. */
export async function loadPackCost(
  supabase: SupabaseClient,
  packId: string
): Promise<number | null> {
  if (!packId) return null;
  const { data } = await supabase.rpc('admin_pack_cost' as never, {
    p_pack_id: packId,
  } as never);
  return typeof data === 'number' ? data : null;
}

/** Purchase cost of every pack of a product, keyed by pack id. */
export async function loadPackCosts(
  supabase: SupabaseClient,
  productId: string
): Promise<Map<string, number | null>> {
  const costs = new Map<string, number | null>();
  if (!productId) return costs;
  const { data } = await supabase.rpc('admin_pack_costs' as never, {
    p_product_id: productId,
  } as never);
  for (const row of (data ?? []) as { pack_id: string; cost_price: number | null }[]) {
    costs.set(row.pack_id, row.cost_price);
  }
  return costs;
}
