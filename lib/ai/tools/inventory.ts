import 'server-only';

import { z } from 'zod';
import type { AICard, AIToolContext, AIToolDefinition } from '@/lib/ai/types';
import { dbFailure, inr, verified } from '@/lib/ai/tools/helpers';
import type { ProductTotalsViewRow, ExpiryReportViewRow } from '@/types/inventory.types';

const inventoryRoles = ['staff', 'admin', 'super_admin'] as const;
const inventorySurfaces = ['staff', 'admin'] as const;
const listSchema = z.object({ productId: z.string().uuid().optional(), warehouseId: z.string().uuid().optional(), limit: z.number().int().min(1).max(50).optional() });
const listJson = { type: 'object', additionalProperties: false, properties: { productId: { type: 'string', format: 'uuid' }, warehouseId: { type: 'string', format: 'uuid' }, limit: { type: 'integer', minimum: 1, maximum: 50 } } };

function stockCards(rows: ProductTotalsViewRow[]): AICard[] {
  return rows.slice(0, 30).map((row) => ({
    type: 'inventory', id: row.product_id, title: row.product_name, subtitle: row.sku_code, badge: row.stock_status.replaceAll('_', ' '), quality: 'verified', source: 'Authorized inventory product totals view',
    metrics: [
      { label: 'On hand', value: String(row.quantity_on_hand), quality: 'verified' },
      { label: 'Reserved', value: String(row.reserved_quantity), quality: 'verified' },
      { label: 'Available', value: String(row.available_quantity), quality: 'verified' },
      { label: 'Value', value: inr(row.estimated_value), quality: 'verified' },
    ],
  }));
}

async function inventoryTotals(input: z.infer<typeof listSchema>, context: AIToolContext, lowOnly = false) {
  if (input.warehouseId) {
    let warehouseQuery = context.supabase.from('inventory_stock').select('id, product_id, warehouse_id, quantity, reserved_quantity, products ( name, sku_code, reorder_level ), warehouses ( name )').eq('warehouse_id', input.warehouseId).limit(input.limit ?? 30);
    if (input.productId) warehouseQuery = warehouseQuery.eq('product_id', input.productId);
    const { data, error } = await warehouseQuery.order('quantity', { ascending: true });
    if (error) return dbFailure();
    const rows = (data ?? []) as unknown as Array<{ id: string; product_id: string; quantity: number; reserved_quantity: number; products: { name: string; sku_code: string; reorder_level: number } | null; warehouses: { name: string } | null }>;
    const filtered = lowOnly ? rows.filter((row) => row.quantity - row.reserved_quantity <= (row.products?.reorder_level ?? 0)) : rows;
    return verified({ warehouseStock: filtered }, filtered.map((row) => ({ type: 'inventory', id: row.id, title: row.products?.name ?? 'Product', subtitle: `${row.products?.sku_code ?? ''} · ${row.warehouses?.name ?? 'Warehouse'}`, quality: 'verified' as const, source: 'Authorized product × warehouse inventory stock row', metrics: [{ label: 'On hand', value: String(row.quantity), quality: 'verified' as const }, { label: 'Reserved', value: String(row.reserved_quantity), quality: 'verified' as const }, { label: 'Available', value: String(row.quantity - row.reserved_quantity), quality: 'verified' as const }] })));
  }
  let query = context.supabase.from('inventory_product_totals').select('*').limit(input.limit ?? 30);
  if (input.productId) query = query.eq('product_id', input.productId);
  if (lowOnly) query = query.in('stock_status', ['low_stock', 'out_of_stock']);
  const { data, error } = await query.order('available_quantity', { ascending: true });
  if (error) return dbFailure();
  const rows = (data ?? []) as ProductTotalsViewRow[];
  return verified({ products: rows }, stockCards(rows));
}

async function expiryReport(input: { productId?: string; warehouseId?: string; days?: number; limit?: number }, context: AIToolContext) {
  const days = input.days ?? 30;
  let query = context.supabase.from('inventory_expiry_report').select('*').not('expiry_date', 'is', null).lte('days_remaining', days).limit(input.limit ?? 30);
  if (input.productId) query = query.eq('product_id', input.productId);
  if (input.warehouseId) query = query.eq('warehouse_id', input.warehouseId);
  const { data, error } = await query.order('days_remaining', { ascending: true });
  if (error) return dbFailure();
  const rows = (data ?? []) as ExpiryReportViewRow[];
  const cards: AICard[] = rows.map((row) => ({ type: 'inventory', id: row.batch_id, title: row.product_name, subtitle: `Batch ${row.batch_number} · ${row.warehouse_name}`, badge: row.expiry_status, quality: 'verified', source: 'Authorized FEFO batch expiry report', metrics: [{ label: 'Available', value: String(row.available_quantity), quality: 'verified' }, { label: 'Expiry', value: row.expiry_date ?? 'Not recorded', quality: row.expiry_date ? 'verified' : 'unavailable' }, { label: 'Days left', value: row.days_remaining === null ? 'Not available' : String(row.days_remaining), quality: row.days_remaining === null ? 'unavailable' : 'verified' }, { label: 'Value at risk', value: inr(row.estimated_value), quality: 'verified' }] }));
  return verified({ batches: rows, windowDays: days }, cards);
}

async function batchStock(input: z.infer<typeof listSchema>, context: AIToolContext) {
  let query = context.supabase.from('inventory_batches').select('id, product_id, warehouse_id, batch_number, manufacturing_date, expiry_date, current_quantity, reserved_quantity, unit_cost, products ( name, sku_code ), warehouses ( name )').gt('current_quantity', 0).limit(input.limit ?? 30);
  if (input.productId) query = query.eq('product_id', input.productId);
  if (input.warehouseId) query = query.eq('warehouse_id', input.warehouseId);
  const { data, error } = await query.order('expiry_date', { ascending: true });
  if (error) return dbFailure();
  const rows = (data ?? []) as unknown as Array<{ id: string; product_id: string; batch_number: string; manufacturing_date: string | null; expiry_date: string | null; current_quantity: number; reserved_quantity: number; unit_cost: number | null; products: { name: string; sku_code: string } | null; warehouses: { name: string } | null }>;
  return verified({ batches: rows }, rows.map((row) => ({ type: 'inventory', id: row.id, title: row.products?.name ?? 'Product', subtitle: `Batch ${row.batch_number} · ${row.warehouses?.name ?? 'Warehouse'}`, quality: 'verified', source: 'Authorized inventory batch ledger', metrics: [{ label: 'On hand', value: String(row.current_quantity), quality: 'verified' }, { label: 'Reserved', value: String(row.reserved_quantity), quality: 'verified' }, { label: 'Expiry', value: row.expiry_date ?? 'Not recorded', quality: row.expiry_date ? 'verified' : 'unavailable' }] })));
}

async function inventorySummary(context: AIToolContext) {
  const { data, error } = await context.supabase.from('inventory_product_totals').select('*').limit(1000);
  if (error) return dbFailure();
  const rows = (data ?? []) as ProductTotalsViewRow[];
  const summary = {
    products: rows.length,
    availableUnits: rows.reduce((sum, row) => sum + row.available_quantity, 0),
    reservedUnits: rows.reduce((sum, row) => sum + row.reserved_quantity, 0),
    stockValue: rows.reduce((sum, row) => sum + Number(row.estimated_value), 0),
    lowStock: rows.filter((row) => row.stock_status === 'low_stock').length,
    outOfStock: rows.filter((row) => row.stock_status === 'out_of_stock').length,
  };
  return verified(summary, [{ type: 'insight', title: 'Inventory health', quality: 'verified', source: `${rows.length} authorized inventory product total rows`, metrics: [{ label: 'Products', value: String(summary.products), quality: 'verified' }, { label: 'Available units', value: String(summary.availableUnits), quality: 'verified' }, { label: 'Stock value', value: inr(summary.stockValue), quality: 'verified' }, { label: 'Low stock', value: String(summary.lowStock), quality: 'verified' }, { label: 'Out of stock', value: String(summary.outOfStock), quality: 'verified' }], actions: [{ type: 'link', label: 'Open inventory', href: '/admin/inventory' }] }]);
}

async function reorderRecommendations(context: AIToolContext) {
  const result = await inventoryTotals({ limit: 50 }, context, true);
  if (!result.ok || !result.data) return result;
  const products = (result.data as { products: ProductTotalsViewRow[] }).products;
  const recommendations = products.map((row) => ({
    productId: row.product_id, productName: row.product_name, available: row.available_quantity,
    reorderLevel: row.reorder_level,
    recommendedQuantity: row.max_stock > 0 ? Math.max(0, row.max_stock - row.available_quantity) : null,
    basis: row.max_stock > 0 ? 'Configured max stock minus current available' : 'No max-stock target configured',
  }));
  return verified({ recommendations, prediction: false }, recommendations.map((row) => ({ type: 'insight', id: row.productId, title: row.productName, subtitle: row.basis, badge: row.available <= 0 ? 'Out of stock' : 'Low stock', quality: row.recommendedQuantity === null ? 'unavailable' : 'verified', source: 'Configured stock thresholds; not an AI demand forecast', metrics: [{ label: 'Available', value: String(row.available), quality: 'verified' }, { label: 'Reorder level', value: String(row.reorderLevel), quality: 'verified' }, { label: 'Suggested qty', value: row.recommendedQuantity === null ? 'Configure max stock' : String(row.recommendedQuantity), quality: row.recommendedQuantity === null ? 'unavailable' : 'verified' }] })));
}

export const inventoryTools: AIToolDefinition[] = [
  { name: 'get_stock_status', description: 'Get authorized aggregate inventory status and valuation.', actionClass: 'READ', roles: [...inventoryRoles], surfaces: [...inventorySurfaces], inputSchema: listSchema, inputJsonSchema: listJson, execute: async (input, context) => inventoryTotals(input, context) },
  { name: 'get_product_stock_admin', description: 'Get authorized staff/admin aggregate product stock.', actionClass: 'READ', roles: [...inventoryRoles], surfaces: [...inventorySurfaces], inputSchema: listSchema, inputJsonSchema: listJson, execute: async (input, context) => inventoryTotals(input, context) },
  { name: 'get_batch_stock', description: 'Get authorized warehouse batch quantities and expiry data.', actionClass: 'READ', roles: [...inventoryRoles], surfaces: [...inventorySurfaces], inputSchema: listSchema, inputJsonSchema: listJson, execute: batchStock },
  { name: 'get_low_stock_products', description: 'Get products at/below configured reorder levels from the existing inventory view.', actionClass: 'READ', roles: [...inventoryRoles], surfaces: [...inventorySurfaces], inputSchema: listSchema, inputJsonSchema: listJson, execute: async (input, context) => inventoryTotals(input, context, true) },
  { name: 'get_expiring_batches', description: 'Get authorized batches expiring inside a specified day window.', actionClass: 'READ', roles: [...inventoryRoles], surfaces: [...inventorySurfaces], inputSchema: z.object({ productId: z.string().uuid().optional(), warehouseId: z.string().uuid().optional(), days: z.number().int().min(0).max(3650).optional(), limit: z.number().int().min(1).max(50).optional() }), inputJsonSchema: { type: 'object', additionalProperties: false, properties: { productId: { type: 'string', format: 'uuid' }, warehouseId: { type: 'string', format: 'uuid' }, days: { type: 'integer', minimum: 0, maximum: 3650 }, limit: { type: 'integer', maximum: 50 } } }, execute: expiryReport },
  { name: 'get_expiry_report', description: 'Get authorized FEFO expiry-risk report.', actionClass: 'READ', roles: [...inventoryRoles], surfaces: [...inventorySurfaces], inputSchema: z.object({ productId: z.string().uuid().optional(), warehouseId: z.string().uuid().optional(), days: z.number().int().min(0).max(3650).optional(), limit: z.number().int().min(1).max(50).optional() }), inputJsonSchema: { type: 'object', additionalProperties: false, properties: { productId: { type: 'string', format: 'uuid' }, warehouseId: { type: 'string', format: 'uuid' }, days: { type: 'integer' }, limit: { type: 'integer' } } }, execute: expiryReport },
  { name: 'get_inventory_summary', description: 'Get an authorized current inventory health and valuation summary.', actionClass: 'READ', roles: [...inventoryRoles], surfaces: [...inventorySurfaces], inputSchema: z.object({}), inputJsonSchema: { type: 'object', additionalProperties: false }, execute: async (_, context) => inventorySummary(context) },
  { name: 'get_reorder_recommendations', description: 'Get threshold-based inventory reorder recommendations. Does not invent demand predictions.', actionClass: 'READ', roles: [...inventoryRoles], surfaces: [...inventorySurfaces], inputSchema: z.object({}), inputJsonSchema: { type: 'object', additionalProperties: false }, execute: async (_, context) => reorderRecommendations(context) },
  { name: 'get_grns', description: 'List authorized goods receipt notes without modifying inventory.', actionClass: 'READ', roles: [...inventoryRoles], surfaces: [...inventorySurfaces], inputSchema: z.object({ status: z.enum(['draft', 'confirmed', 'cancelled']).optional(), limit: z.number().int().min(1).max(30).optional() }), inputJsonSchema: { type: 'object', additionalProperties: false, properties: { status: { type: 'string' }, limit: { type: 'integer', maximum: 30 } } }, execute: async ({ status, limit }, context) => { let query = context.supabase.from('grns').select('id, grn_number, status, supplier_name, invoice_reference, created_at, confirmed_at, warehouses ( name )').order('created_at', { ascending: false }).limit(limit ?? 20); if (status) query = query.eq('status', status); const { data, error } = await query; return error ? dbFailure() : verified({ grns: data ?? [] }); } },
  { name: 'get_stock_transfers', description: 'List authorized stock transfers without changing them.', actionClass: 'READ', roles: [...inventoryRoles], surfaces: [...inventorySurfaces], inputSchema: z.object({ limit: z.number().int().min(1).max(30).optional() }), inputJsonSchema: { type: 'object', additionalProperties: false, properties: { limit: { type: 'integer', maximum: 30 } } }, execute: async ({ limit }, context) => { const { data, error } = await context.supabase.from('stock_transfers').select('id, transfer_number, status, created_at, source:warehouses!stock_transfers_source_warehouse_id_fkey ( name ), destination:warehouses!stock_transfers_destination_warehouse_id_fkey ( name )').order('created_at', { ascending: false }).limit(limit ?? 20); return error ? dbFailure() : verified({ transfers: data ?? [] }); } },
];

export { inventoryTotals, expiryReport, batchStock, inventorySummary, reorderRecommendations };
