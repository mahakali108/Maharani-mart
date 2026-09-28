/**
 * SINGLE-WAREHOUSE CONFIGURATION — pure rules.
 *
 * Maharani Traders operates exactly ONE active warehouse. The database keeps
 * the full `warehouses` / `warehouse_id` structure (so a second depot is a data
 * change, not a migration), but the application resolves the ONE active
 * warehouse centrally and refuses to guess:
 *
 *   0 active warehouses  → configuration error
 *   1 active warehouse   → use it
 *   2 or more            → configuration error (never pick one at random)
 *
 * This module is PURE — it turns a list of rows into a resolution, so the
 * "one / zero / many" contract is unit-testable without Supabase. The I/O half
 * lives in lib/warehouse/resolver.ts.
 */

/** Minimal shape the rules need from a warehouse row. */
export interface WarehouseLike {
  id: string;
  name: string;
}

export type WarehouseConfigReason = 'none' | 'multiple';

export type WarehouseResolution<T extends WarehouseLike> =
  | { ok: true; warehouse: T; count: 1 }
  | { ok: false; reason: WarehouseConfigReason; count: number; message: string };

/** How the current warehouse master data reads: configured, none, or many. */
export function classifyWarehouseConfig(count: number): 'configured' | 'none' | 'multiple' {
  if (count === 1) return 'configured';
  return count === 0 ? 'none' : 'multiple';
}

/** Operator-facing explanation of a configuration error (admin/staff copy). */
export function warehouseConfigMessage(count: number): string {
  if (count === 0) {
    return 'Configuration error: no active warehouse. Activate exactly one warehouse in Admin → Warehouses before taking orders or moving stock.';
  }
  if (count > 1) {
    return `Configuration error: ${count} active warehouses. This business runs one warehouse — deactivate all but one in Admin → Warehouses.`;
  }
  return 'Warehouse is configured.';
}

/** Customer-facing copy that never leaks internal configuration detail. */
export function warehouseConfigCustomerMessage(count: number): string {
  if (count === 0) {
    return 'Ordering is paused while the distributor finishes setting up despatch. Please try again shortly.';
  }
  return 'Ordering is paused while the distributor fixes a despatch configuration issue. Please try again shortly.';
}

/**
 * The single source of truth for "which warehouse does the app use".
 *
 * Given the ACTIVE warehouses, returns the one to operate against — or a
 * configuration error. It never returns the first row, never sorts by created
 * date, and never falls back: an ambiguous configuration is reported, not
 * resolved by luck.
 */
export function resolveSingleWarehouse<T extends WarehouseLike>(activeWarehouses: T[]): WarehouseResolution<T> {
  const count = activeWarehouses.length;
  if (count === 1) {
    const warehouse = activeWarehouses[0]!;
    return { ok: true, warehouse, count: 1 };
  }
  return {
    ok: false,
    reason: count === 0 ? 'none' : 'multiple',
    count,
    message: warehouseConfigMessage(count),
  };
}
