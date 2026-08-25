import { describe, expect, it } from 'vitest';
import { allBusinessTools, executeBusinessTool, toolsForContext } from '@/lib/ai/tools';
import type { AIToolContext } from '@/lib/ai/types';

const actor = { id: '00000000-0000-4000-8000-000000000001', role: 'retailer' as const, fullName: 'R', surface: 'retailer' as const };

function logOnlySupabase() {
  return { from: () => ({ insert: async () => ({ error: null }) }) } as never;
}

function productSupabase(error: boolean) {
  const productsQuery: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'or', 'order', 'range', 'in']) productsQuery[method] = () => productsQuery;
  productsQuery.returns = async () => ({ data: error ? null : [], error: error ? { message: 'down' } : null });
  const retailerQuery: Record<string, unknown> = {};
  for (const method of ['select', 'eq']) retailerQuery[method] = () => retailerQuery;
  retailerQuery.maybeSingle = async () => ({ data: { area_id: null }, error: null });
  const audit = { insert: async () => ({ error: null }) };
  return { from: (table: string) => table === 'products' ? productsQuery : table === 'retailers' ? retailerQuery : audit } as never;
}

function context(supabase = logOnlySupabase()): AIToolContext {
  return { actor, supabase, requestId: '00000000-0000-4000-8000-000000000011', confirmed: false };
}

describe('typed business tool registry', () => {
  it('contains required product, scheme, cart, order, credit, invoice, inventory and analytics tools', () => {
    const names = new Set(allBusinessTools.map((tool) => tool.name));
    for (const name of ['search_products', 'get_product', 'search_categories', 'search_brands', 'get_product_stock', 'get_batch_stock', 'get_expiry_report', 'get_low_stock_products', 'search_schemes', 'get_best_scheme', 'get_retailer_credit', 'get_retailer_orders', 'get_order_details', 'get_reorder_suggestions', 'prepare_cart', 'add_cart_item', 'update_cart_quantity', 'remove_cart_item', 'get_cart', 'calculate_order_preview']) {
      expect(names.has(name), name).toBe(true);
    }
  });

  it('isolates admin inventory tools from retailer and retailer cart tools from admin', () => {
    const retailerNames = new Set(toolsForContext(context()).map((tool) => tool.name));
    expect(retailerNames.has('get_batch_stock')).toBe(false);
    const adminContext = { ...context(), actor: { ...actor, role: 'admin' as const, surface: 'admin' as const } };
    const adminNames = new Set(toolsForContext(adminContext).map((tool) => tool.name));
    expect(adminNames.has('get_batch_stock')).toBe(true);
    expect(adminNames.has('add_cart_item')).toBe(false);
  });

  it('rejects invalid tool arguments before a handler runs', async () => {
    const execution = await executeBusinessTool('search_products', { minPrice: -1 }, context());
    expect(execution.result.ok).toBe(false);
    expect(execution.result.message).toBe('Invalid tool arguments.');
  });

  it('requires confirmation for a valid cart write', async () => {
    process.env.AI_ACTION_SIGNING_SECRET = 'test-secret-that-is-at-least-thirty-two-characters';
    const execution = await executeBusinessTool('add_cart_item', { packId: actor.id, quantity: 10 }, context());
    expect(execution.result.confirmationRequired).toBe(true);
    expect(execution.result.confirmationToken).toBeTruthy();
  });

  it('returns a verified empty product search without hallucinating products', async () => {
    const execution = await executeBusinessTool('search_products', { query: 'does-not-exist' }, context(productSupabase(false)));
    expect(execution.result.ok).toBe(true);
    expect(execution.result.data).toMatchObject({ products: [] });
  });

  it('converts a Supabase product-search failure into an unverified result', async () => {
    const execution = await executeBusinessTool('search_products', { query: 'colgate' }, context(productSupabase(true)));
    expect(execution.result.ok).toBe(false);
    expect(execution.result.message).toContain("I couldn't verify");
  });

  it('classifies preparation separately from cart writes and never exposes order placement', () => {
    expect(allBusinessTools.find((tool) => tool.name === 'prepare_ai_cart')?.actionClass).toBe('PREPARE');
    expect(allBusinessTools.find((tool) => tool.name === 'add_to_cart')?.actionClass).toBe('WRITE');
    expect(allBusinessTools.some((tool) => /place.*order|approve.*order|inventory.*adjust/i.test(tool.name))).toBe(false);
  });
});
