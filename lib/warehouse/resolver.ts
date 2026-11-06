import 'server-only';

import type { createClient } from '@/lib/supabase/server';
import { resolveSingleWarehouse, type WarehouseResolution } from '@/lib/warehouse/config';

/**
 * THE centralized server-side warehouse resolver.
 *
 * Every server path that needs "the warehouse" — order placement, stock
 * adjustments, GRN receiving, dispatch, staff operations — asks THIS module.
 * No warehouse UUID is ever hardcoded, and nothing is ever picked at random:
 * the database is read, and 0 or 2+ active warehouses is a configuration error
 * that is surfaced (never silently resolved).
 *
 * `warehouses` is master data (RLS: active rows readable by any authenticated
 * user, writes admin-only), so this read works for retailers, staff and admins
 * alike.
 */

export interface ActiveWarehouse {
  id: string;
  name: string;
  area_id: string | null;
  address: string | null;
}

/** All ACTIVE warehouses. Inactive rows are never candidates. */
export async function loadActiveWarehouses(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<{ warehouses: ActiveWarehouse[]; error: string | null }> {
  const { data, error } = await supabase
    .from('warehouses')
    .select('id, name, area_id, address')
    .eq('is_active', true)
    .order('name', { ascending: true })
    .returns<ActiveWarehouse[]>();
  if (error) return { warehouses: [], error: error.message };
  return { warehouses: data ?? [], error: null };
}

export type ActiveWarehouseResolution = WarehouseResolution<ActiveWarehouse> | {
  ok: false;
  reason: 'unavailable';
  count: number;
  message: string;
};

/**
 * Resolve the business's single active warehouse.
 *
 * 1 active  → `{ ok: true, warehouse }`
 * 0 or 2+   → `{ ok: false, reason: 'none' | 'multiple', message }`
 * DB error  → `{ ok: false, reason: 'unavailable', message }`
 */
export async function resolveActiveWarehouse(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<ActiveWarehouseResolution> {
  const { warehouses, error } = await loadActiveWarehouses(supabase);
  if (error) {
    return {
      ok: false,
      reason: 'unavailable',
      count: 0,
      message: 'The warehouse configuration could not be read. Please try again.',
    };
  }
  return resolveSingleWarehouse(warehouses);
}

/**
 * Warehouse id for a write path that must be assigned one.
 * Returns `null` on any configuration problem — callers decide whether that is
 * fatal (GRN, stock adjustment) or best-effort (order auto-assignment).
 */
export async function resolveActiveWarehouseId(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<string | null> {
  const resolved = await resolveActiveWarehouse(supabase);
  return resolved.ok ? resolved.warehouse.id : null;
}

/**
 * Guard for a server action that MUST have a warehouse to write against.
 * Any client-supplied warehouse id is verified against the single active
 * warehouse — a stale or forged id can never move stock into another depot.
 */
export async function requireActiveWarehouse(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<{ ok: true; warehouse: ActiveWarehouse } | { ok: false; error: string }> {
  const resolved = await resolveActiveWarehouse(supabase);
  if (!resolved.ok) {
    return { ok: false, error: resolved.message ?? 'Warehouse configuration error.' };
  }
  return { ok: true, warehouse: resolved.warehouse };
}

/**
 * Verify a client-supplied warehouse id against the resolved active warehouse.
 * Used where a form still posts an id (legacy field): matching is required, so
 * the value is validated rather than trusted.
 */
export async function requireWarehouseId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  submittedId: string | null | undefined
): Promise<{ ok: true; warehouseId: string } | { ok: false; error: string }> {
  const resolved = await resolveActiveWarehouse(supabase);
  if (!resolved.ok) return { ok: false, error: resolved.message ?? 'Warehouse configuration error.' };
  if (submittedId && submittedId !== resolved.warehouse.id) {
    return {
      ok: false,
      error: 'This action must run against the active warehouse. Reload the page and try again.',
    };
  }
  return { ok: true, warehouseId: resolved.warehouse.id };
}

export { warehouseConfigMessage, warehouseConfigCustomerMessage, classifyWarehouseConfig } from '@/lib/warehouse/config';
