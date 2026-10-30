import 'server-only';

import { createClient } from '@/lib/supabase/server';

/** The only product scopes that Phase 2D permits for new retail sale. */
export const ALLOWED_CATALOG_SCOPES = ['cosmetics', 'fmcg'] as const;
export type AllowedCatalogScope = (typeof ALLOWED_CATALOG_SCOPES)[number];

type CategoryComplianceRow = {
  id: string;
  is_active: boolean;
  compliance_scope: string;
};

type ComplianceGate = { ok: true; scope: AllowedCatalogScope } | { ok: false; error: string };

/**
 * Friendly server-action guard for product form/import callers. Database
 * triggers/RLS in 0086 are the final authority; this prevents a crafted form
 * from yielding a vague Postgres error and deliberately never infers scope
 * from category/product names.
 */
export async function checkAllowedCatalogCategory(
  supabase: ReturnType<typeof createClient>,
  categoryId: string
): Promise<ComplianceGate> {
  if (!categoryId) return { ok: false, error: 'Select an owner-classified Cosmetics or FMCG category.' };

  const { data, error } = await supabase
    .from('categories' as never)
    .select('id, is_active, compliance_scope')
    .eq('id', categoryId)
    .maybeSingle<CategoryComplianceRow>();

  if (error || !data) {
    return { ok: false, error: 'The selected category could not be verified for compliance.' };
  }
  if (!data.is_active) return { ok: false, error: 'The selected category is inactive.' };
  if (data.compliance_scope === 'food_blocked') {
    return { ok: false, error: 'Food categories are not supported by this marketplace.' };
  }
  if (!ALLOWED_CATALOG_SCOPES.includes(data.compliance_scope as AllowedCatalogScope)) {
    return { ok: false, error: 'Only Super Admin-classified Cosmetics and FMCG categories can contain products.' };
  }
  return { ok: true, scope: data.compliance_scope as AllowedCatalogScope };
}

/**
 * A publication preflight only. It is intentionally duplicated by the product
 * trigger so direct PostgREST, import, mobile, service-role and future APIs
 * cannot bypass it.
 */
export async function checkProductCanBeSold(
  supabase: ReturnType<typeof createClient>,
  productId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc(
    'product_is_sale_eligible' as never,
    { p_product_id: productId } as never
  );
  if (error || data !== true) {
    return { ok: false, error: 'This product needs an approved, unexpired Cosmetics/FMCG compliance review before it can be published or sold.' };
  }
  return { ok: true };
}

/** Same preflight for offer writers; activation/moderation/order triggers remain authoritative. */
export async function checkSellerCanTrade(
  supabase: ReturnType<typeof createClient>,
  sellerId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc(
    'seller_is_trade_eligible' as never,
    { p_seller_id: sellerId } as never
  );
  if (error || data !== true) {
    return { ok: false, error: 'This seller needs an approved, unexpired compliance review before publishing or fulfilling new marketplace offers.' };
  }
  return { ok: true };
}
