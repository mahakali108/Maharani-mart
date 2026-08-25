import 'server-only';

import { z } from 'zod';
import type { AICard, AIToolContext, AIToolDefinition } from '@/lib/ai/types';
import { sanitizeSearchTerm } from '@/lib/retailer/catalog-params';
import { dbFailure, unavailable, verified } from '@/lib/ai/tools/helpers';
import { mapProducts, productCards, type ProductRow } from '@/lib/ai/tools/products';

const roles = ['retailer', 'salesman', 'staff', 'admin', 'super_admin'] as const;
const surfaces = ['retailer', 'salesman', 'staff', 'admin'] as const;
const PRODUCT_SELECT = 'id, name, sku_code, category_id, gst_percent, is_new_launch, created_at, brands ( name ), categories ( name ), product_images ( image_url, sort_order ), product_packs ( id, pack_name, ptr, base_price, mrp, moq, is_active, sort_order )';

async function taxonomy(kind: 'categories' | 'brands', query: string | undefined, context: AIToolContext) {
  let request = context.supabase.from(kind).select('id, name').eq('is_active', true).order('name').limit(30);
  if (query) request = request.ilike('name', `%${sanitizeSearchTerm(query)}%`);
  const { data, error } = await request;
  return error ? dbFailure() : verified({ [kind]: data ?? [] });
}

async function compare(productIds: string[], context: AIToolContext) {
  const { data, error } = await context.supabase.from('products').select(PRODUCT_SELECT).in('id', productIds).eq('is_active', true).returns<ProductRow[]>();
  if (error) return dbFailure();
  const products = await mapProducts(context, data ?? []);
  if (products.length === 0) return unavailable('None of those products exist in the authorized active catalog.');
  return verified({ products, comparisonBasis: ['effective price', 'MOQ', 'GST', 'authorized availability'] }, productCards(products, context));
}

async function alternatives(productId: string, context: AIToolContext) {
  const { data: seed, error } = await context.supabase.from('products').select('id, category_id, brand_id').eq('id', productId).eq('is_active', true).maybeSingle<{ id: string; category_id: string | null; brand_id: string | null }>();
  if (error) return dbFailure();
  if (!seed) return unavailable('The selected product was not found.');
  if (!seed.category_id) return unavailable('No category is recorded, so comparable alternatives cannot be verified.');
  const { data, error: altError } = await context.supabase.from('products').select(PRODUCT_SELECT).eq('category_id', seed.category_id).neq('id', seed.id).eq('is_active', true).limit(20).returns<ProductRow[]>();
  if (altError) return dbFailure();
  const products = (await mapProducts(context, data ?? [])).sort((a, b) => (a.price ?? Number.MAX_SAFE_INTEGER) - (b.price ?? Number.MAX_SAFE_INTEGER)).slice(0, 8);
  return verified({ alternatives: products, basis: 'same active category, sorted by current effective price' }, productCards(products, context));
}

async function frequent(context: AIToolContext) {
  if (context.actor.role !== 'retailer') return unavailable('Frequently purchased products require a retailer purchase context.');
  const { data: orders, error } = await context.supabase.from('orders').select('id').eq('retailer_id', context.actor.id).neq('status', 'cancelled').order('placed_at', { ascending: false }).limit(40).returns<{ id: string }[]>();
  if (error) return dbFailure();
  if (!orders?.length) return verified({ products: [], sourceOrders: 0 }, [], 'No purchase history');
  const { data: items, error: itemError } = await context.supabase.from('order_items').select('product_id, quantity').in('order_id', orders.map((o) => o.id)).limit(800).returns<{ product_id: string; quantity: number }[]>();
  if (itemError) return dbFailure();
  const counts = new Map<string, { occurrences: number; quantity: number }>();
  for (const item of items ?? []) { const value = counts.get(item.product_id) ?? { occurrences: 0, quantity: 0 }; value.occurrences += 1; value.quantity += item.quantity; counts.set(item.product_id, value); }
  const ids = [...counts.entries()].sort((a, b) => b[1].occurrences - a[1].occurrences).slice(0, 12).map(([id]) => id);
  const { data: rows, error: productError } = await context.supabase.from('products').select(PRODUCT_SELECT).in('id', ids).eq('is_active', true).returns<ProductRow[]>();
  if (productError) return dbFailure();
  const products = await mapProducts(context, rows ?? []);
  const cards = productCards(products, context).map((card) => {
    const count = card.id ? counts.get(card.id) : undefined;
    return { ...card, badge: `${count?.occurrences ?? 0} recent purchases`, source: `${orders.length} recent non-cancelled orders` } as AICard;
  });
  return verified({ products: products.map((p) => ({ ...p, ...counts.get(p.id) })), sourceOrders: orders.length }, cards);
}

export const discoveryTools: AIToolDefinition[] = [
  { name: 'get_product', description: 'Get one verified active catalog product.', actionClass: 'READ', roles: [...roles], surfaces: [...surfaces], inputSchema: z.object({ productId: z.string().uuid() }), inputJsonSchema: { type: 'object', additionalProperties: false, required: ['productId'], properties: { productId: { type: 'string', format: 'uuid' } } }, execute: async ({ productId }, context) => compare([productId], context) },
  { name: 'search_categories', description: 'Search active product categories.', actionClass: 'READ', roles: [...roles], surfaces: [...surfaces], inputSchema: z.object({ query: z.string().trim().max(80).optional() }), inputJsonSchema: { type: 'object', additionalProperties: false, properties: { query: { type: 'string' } } }, execute: async ({ query }, context) => taxonomy('categories', query, context) },
  { name: 'search_brands', description: 'Search active product brands.', actionClass: 'READ', roles: [...roles], surfaces: [...surfaces], inputSchema: z.object({ query: z.string().trim().max(80).optional() }), inputJsonSchema: { type: 'object', additionalProperties: false, properties: { query: { type: 'string' } } }, execute: async ({ query }, context) => taxonomy('brands', query, context) },
  { name: 'compare_products', description: 'Compare 2-5 active products using verified current price, MOQ, GST and availability.', actionClass: 'READ', roles: [...roles], surfaces: [...surfaces], inputSchema: z.object({ productIds: z.array(z.string().uuid()).min(2).max(5) }), inputJsonSchema: { type: 'object', additionalProperties: false, required: ['productIds'], properties: { productIds: { type: 'array', minItems: 2, maxItems: 5, items: { type: 'string', format: 'uuid' } } } }, execute: async ({ productIds }, context) => compare(productIds, context) },
  { name: 'get_alternative_products', description: 'Recommend verified active alternatives in the same category, sorted by current price.', actionClass: 'READ', roles: [...roles], surfaces: [...surfaces], inputSchema: z.object({ productId: z.string().uuid() }), inputJsonSchema: { type: 'object', additionalProperties: false, required: ['productId'], properties: { productId: { type: 'string', format: 'uuid' } } }, execute: async ({ productId }, context) => alternatives(productId, context) },
  { name: 'get_frequently_purchased_products', description: 'Get products frequently purchased by the authenticated retailer using actual order history.', actionClass: 'READ', roles: ['retailer'], surfaces: ['retailer'], inputSchema: z.object({}), inputJsonSchema: { type: 'object', additionalProperties: false }, execute: async (_, context) => frequent(context) },
];
