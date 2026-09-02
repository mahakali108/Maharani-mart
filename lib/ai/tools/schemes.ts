import 'server-only';

import { z } from 'zod';
import type { AICard, AIToolContext, AIToolDefinition } from '@/lib/ai/types';
import { dbFailure, internalCode, inr, unavailable, verified } from '@/lib/ai/tools/helpers';

interface SchemeRow { id: string; name: string; description: string | null; is_festival: boolean; starts_at: string; ends_at: string; }
interface SchemePriceRow { scheme_id: string | null; product_id: string; price: number; products: { name: string; sku_code: string } | null; }
interface EligibleScheme extends SchemeRow {
  products: { id: string; name: string; skuCode: string | null; configuredSchemePrice: number }[];
}

async function eligibleSchemes(context: AIToolContext, limit = 20) {
  const now = new Date().toISOString();
  const [{ data: schemes, error }, { data: prices, error: priceError }] = await Promise.all([
    context.supabase.from('schemes').select('id, name, description, is_festival, starts_at, ends_at').eq('is_active', true).lte('starts_at', now).gte('ends_at', now).order('ends_at').limit(limit).returns<SchemeRow[]>(),
    context.supabase.from('price_lists').select('scheme_id, product_id, price, products ( name, sku_code )').in('scope', ['scheme', 'festival']).eq('is_active', true).lte('valid_from', now).or(`valid_to.is.null,valid_to.gte.${now}`).limit(300).returns<SchemePriceRow[]>(),
  ]);
  if (error || priceError) return { error: true as const };
  const rows = (schemes ?? []).map((scheme) => ({
    ...scheme,
    products: (prices ?? []).filter((row) => row.scheme_id === scheme.id).map((row) => ({ id: row.product_id, name: row.products?.name ?? 'Product', skuCode: row.products?.sku_code ?? null, configuredSchemePrice: row.price })),
  })).filter((scheme) => context.actor.role !== 'retailer' || scheme.products.length > 0);
  return { error: false as const, rows };
}

function schemeCards(rows: EligibleScheme[], context: AIToolContext): AICard[] {
  return rows.map((scheme) => ({
    type: 'scheme', id: scheme.id, title: scheme.name, subtitle: scheme.description ?? 'No additional scheme description is recorded.',
    badge: scheme.is_festival ? 'Festival offer' : 'Active scheme', quality: 'verified', source: 'Active scheme and authorized visible scheme-price rows',
    metrics: [
      { label: 'Ends', value: new Date(scheme.ends_at).toLocaleDateString('en-IN'), quality: 'verified' },
      { label: 'Products', value: String(scheme.products.length), quality: 'verified' },
      { label: 'Minimum', value: 'Not recorded', quality: 'unavailable' },
    ],
    actions: context.actor.surface === 'retailer' ? [{ type: 'link', label: 'View products', href: '/retailer/catalog?offers=1', tone: 'primary' }] : undefined,
  }));
}

const noInput = z.object({ limit: z.number().int().min(1).max(30).optional() });
const schemeId = z.object({ schemeId: z.string().uuid() });

export const schemeTools: AIToolDefinition[] = [
  {
    name: 'get_active_schemes', description: 'Get currently active schemes. For retailers this is restricted to schemes with authorized visible product price rows.', actionClass: 'READ', roles: ['retailer', 'salesman', 'staff', 'admin', 'super_admin'], surfaces: ['retailer', 'salesman', 'staff', 'admin'], inputSchema: noInput,
    inputJsonSchema: { type: 'object', additionalProperties: false, properties: { limit: { type: 'integer', minimum: 1, maximum: 30 } } },
    execute: async ({ limit }, context) => { const result = await eligibleSchemes(context, limit); return result.error ? dbFailure() : verified({ schemes: result.rows }, schemeCards(result.rows, context)); },
  },
  {
    name: 'get_eligible_schemes', description: 'Get only schemes that the authenticated retailer can currently see and that have authorized scheme products.', actionClass: 'READ', roles: ['retailer'], surfaces: ['retailer'], inputSchema: noInput,
    inputJsonSchema: { type: 'object', additionalProperties: false, properties: { limit: { type: 'integer', maximum: 30 } } },
    execute: async ({ limit }, context) => { const result = await eligibleSchemes(context, limit); return result.error ? dbFailure() : verified({ schemes: result.rows }, schemeCards(result.rows, context)); },
  },
  {
    name: 'get_scheme_products', description: 'Get products linked to one current authorized scheme and their configured scheme price rows.', actionClass: 'READ', roles: ['retailer', 'salesman', 'staff', 'admin', 'super_admin'], surfaces: ['retailer', 'salesman', 'staff', 'admin'], inputSchema: schemeId,
    inputJsonSchema: { type: 'object', additionalProperties: false, required: ['schemeId'], properties: { schemeId: { type: 'string', format: 'uuid' } } },
    execute: async ({ schemeId }, context) => {
      const result = await eligibleSchemes(context, 30);
      if (result.error) return dbFailure();
      const scheme = result.rows.find((row) => row.id === schemeId);
      if (!scheme) return unavailable('This scheme is not active or eligible for the current user.');
      const cards: AICard[] = scheme.products.slice(0, 20).map((p) => ({ type: 'product', id: p.id, title: p.name, subtitle: internalCode(context, p.skuCode) ?? undefined, metrics: [{ label: 'Configured scheme price', value: inr(p.configuredSchemePrice), quality: 'verified' }], quality: 'verified', source: 'Authorized scheme price row', actions: context.actor.surface === 'retailer' ? [{ type: 'link', label: 'View product', href: `/retailer/catalog/${p.id}` }] : context.actor.surface === 'admin' ? [{ type: 'link', label: 'View product', href: `/admin/products/${p.id}` }] : undefined }));
      return verified({ scheme, products: scheme.products }, cards);
    },
  },
  {
    name: 'calculate_scheme_benefit', description: 'Verify whether numeric savings can be calculated from current scheme data. Never infers minimums or benefits from marketing text.', actionClass: 'READ', roles: ['retailer', 'salesman', 'staff', 'admin', 'super_admin'], surfaces: ['retailer', 'salesman', 'staff', 'admin'],
    inputSchema: z.object({ schemeId: z.string().uuid(), productId: z.string().uuid(), quantity: z.number().int().positive().max(100000) }),
    inputJsonSchema: { type: 'object', additionalProperties: false, required: ['schemeId', 'productId', 'quantity'], properties: { schemeId: { type: 'string', format: 'uuid' }, productId: { type: 'string', format: 'uuid' }, quantity: { type: 'integer', minimum: 1 } } },
    execute: async ({ schemeId, productId, quantity }, context) => {
      const result = await eligibleSchemes(context, 30);
      if (result.error) return dbFailure();
      const scheme = result.rows.find((row) => row.id === schemeId);
      const product = scheme?.products.find((row) => row.id === productId);
      if (!scheme || !product) return unavailable('No eligible active scheme price row exists for that product.');
      // Existing schema stores a price row but no quantity/value threshold or benefit formula.
      // Reporting a savings figure would therefore be an invention.
      return verified({ schemeId, productId, quantity, configuredSchemePrice: product.configuredSchemePrice, estimatedSavings: null, reason: 'The current scheme schema has no minimum or benefit formula, so savings cannot be verified.' }, [{ type: 'scheme', title: scheme.name, subtitle: 'Configured price is verified; numeric benefit is unavailable because no benefit formula is recorded.', metrics: [{ label: 'Configured price', value: inr(product.configuredSchemePrice), quality: 'verified' }, { label: 'Estimated savings', value: 'Cannot verify', quality: 'unavailable' }], quality: 'unavailable', source: 'Current scheme schema' }]);
    },
  },
];
