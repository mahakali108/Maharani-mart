import 'server-only';

import { z } from 'zod';
import type { AIToolDefinition } from '@/lib/ai/types';
import { dbFailure, unavailable, verified } from '@/lib/ai/tools/helpers';

const roles = ['retailer', 'salesman', 'staff', 'admin', 'super_admin'] as const;
const surfaces = ['retailer', 'salesman', 'staff', 'admin'] as const;
const schema = z.object({ query: z.string().trim().max(80).optional(), productId: z.string().uuid().optional(), limit: z.number().int().min(1).max(30).optional() });
const json = { type: 'object', additionalProperties: false, properties: { query: { type: 'string' }, productId: { type: 'string', format: 'uuid' }, limit: { type: 'integer', maximum: 30 } } };

async function search(input: z.infer<typeof schema>, context: Parameters<AIToolDefinition['execute']>[1]) {
  const now = new Date().toISOString();
  let request = context.supabase.from('schemes').select('id, name, description, is_festival, starts_at, ends_at').eq('is_active', true).lte('starts_at', now).gte('ends_at', now).order('ends_at').limit(input.limit ?? 20);
  if (input.query) request = request.ilike('name', `%${input.query.replace(/[%_,.*()'"\\]/g, ' ').trim()}%`);
  const { data, error } = await request;
  if (error) return dbFailure();
  let schemes = (data ?? []) as { id: string; name: string; description: string | null; is_festival: boolean; starts_at: string; ends_at: string }[];
  if (input.productId && schemes.length) {
    const { data: prices, error: priceError } = await context.supabase.from('price_lists').select('scheme_id').eq('product_id', input.productId).in('scope', ['scheme', 'festival']).eq('is_active', true).lte('valid_from', now).or(`valid_to.is.null,valid_to.gte.${now}`);
    if (priceError) return dbFailure();
    const ids = new Set(((prices ?? []) as { scheme_id: string | null }[]).map((row) => row.scheme_id).filter(Boolean));
    schemes = schemes.filter((item) => ids.has(item.id));
  }
  return verified({ schemes }, schemes.map((item) => ({ type: 'scheme', id: item.id, title: item.name, subtitle: item.description ?? 'No benefit formula is recorded.', badge: item.is_festival ? 'Festival' : 'Active', quality: 'verified' as const, source: 'Current authorized scheme records', metrics: [{ label: 'Ends', value: new Date(item.ends_at).toLocaleDateString('en-IN'), quality: 'verified' as const }] })));
}

export const schemeDiscoveryTools: AIToolDefinition[] = [
  { name: 'search_schemes', description: 'Search currently active authorized schemes by name or product.', actionClass: 'READ', roles: [...roles], surfaces: [...surfaces], inputSchema: schema, inputJsonSchema: json, execute: search },
  { name: 'get_best_scheme', description: 'Find eligible active schemes for a product; returns no invented ranking when benefit formulas are absent.', actionClass: 'READ', roles: [...roles], surfaces: [...surfaces], inputSchema: schema, inputJsonSchema: json, execute: async (input, context) => { const result = await search(input, context); if (!result.ok) return result; const schemes = (result.data as { schemes: unknown[] }).schemes; if (!schemes.length) return unavailable('No eligible active scheme was found for the requested product.'); return { ...result, message: schemes.length === 1 ? 'One active configured scheme was found.' : 'Multiple schemes were found, but “best” cannot be ranked because no comparable benefit formula is recorded.' }; } },
];
