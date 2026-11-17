import 'server-only';
import { createClient } from '@/lib/supabase/server';
import {
  DEFAULT_GLOBAL_WHOLESALE_RULES,
  type ProductWholesaleLimit,
  type SellerPricingPermission,
  type WholesaleGlobalRules,
} from '@/lib/admin/wholesale-pricing-rules';

export interface SellerPermissionRow extends SellerPricingPermission {
  business_name: string;
  seller_status: string;
}

export interface ProductLimitRow extends ProductWholesaleLimit {
  product_name: string;
  pack_name: string;
  base_price: number;
}

export interface WholesalePricingOverview {
  globalRules: WholesaleGlobalRules;
  sellerPermissions: SellerPermissionRow[];
  productLimits: ProductLimitRow[];
  sellers: Array<{ id: string; business_name: string; status: string }>;
  packs: Array<{ id: string; label: string; base_price: number }>;
  failed: boolean;
  failureMessage: string | null;
}

export async function getWholesalePricingOverview(): Promise<WholesalePricingOverview> {
  const supabase = await createClient();

  const [globalRes, sellerPermsRes, packLimitsRes, sellersRes, packsRes] = await Promise.all([
    supabase
      .from('wholesale_pricing_rules' as never)
      .select(
        'default_min_order_qty, max_discount_percent, allow_seller_custom_slabs, allow_seller_price_override, enforce_pack_floor, min_order_value_paise, notes, updated_at'
      )
      .eq('id', 1)
      .maybeSingle<WholesaleGlobalRules>(),
    supabase
      .from('seller_pricing_permissions' as never)
      .select('seller_id, can_set_custom_slabs, can_apply_discounts, max_discount_percent, min_moq_override, notes, updated_at')
      .order('updated_at', { ascending: false }),
    supabase
      .from('product_wholesale_limits' as never)
      .select('pack_id, min_order_qty, max_discount_percent, allow_seller_slabs, notes, updated_at')
      .order('updated_at', { ascending: false }),
    supabase
      .from('sellers' as never)
      .select('id, business_name, status')
      .order('business_name', { ascending: true })
      .limit(300),
    supabase
      .from('product_packs')
      .select('id, pack_name, base_price, is_active, products ( name )')
      .eq('is_active', true)
      .order('pack_name', { ascending: true })
      .limit(400),
  ]);

  if (globalRes.error) {
    return {
      globalRules: DEFAULT_GLOBAL_WHOLESALE_RULES,
      sellerPermissions: [],
      productLimits: [],
      sellers: [],
      packs: [],
      failed: true,
      failureMessage: globalRes.error.message,
    };
  }

  const sellers = ((sellersRes.data ?? []) as unknown as Array<{
    id: string;
    business_name: string;
    status: string;
  }>);
  const sellerMap = new Map(sellers.map((s) => [s.id, s]));

  const packRows = ((packsRes.data ?? []) as unknown as Array<{
    id: string;
    pack_name: string;
    base_price: number;
    products: { name: string } | null;
  }>);
  const packMap = new Map(
    packRows.map((p) => [
      p.id,
      {
        product_name: p.products?.name ?? 'Product',
        pack_name: p.pack_name,
        base_price: Number(p.base_price ?? 0),
      },
    ])
  );

  const sellerPermissions: SellerPermissionRow[] = (
    (sellerPermsRes.data ?? []) as unknown as SellerPricingPermission[]
  ).map((row) => {
    const seller = sellerMap.get(row.seller_id);
    return {
      ...row,
      max_discount_percent: Number(row.max_discount_percent),
      business_name: seller?.business_name ?? row.seller_id,
      seller_status: seller?.status ?? 'unknown',
    };
  });

  const productLimits: ProductLimitRow[] = (
    (packLimitsRes.data ?? []) as unknown as ProductWholesaleLimit[]
  ).map((row) => {
    const pack = packMap.get(row.pack_id);
    return {
      ...row,
      max_discount_percent: Number(row.max_discount_percent),
      product_name: pack?.product_name ?? 'Product',
      pack_name: pack?.pack_name ?? row.pack_id,
      base_price: pack?.base_price ?? 0,
    };
  });

  return {
    globalRules: globalRes.data
      ? {
          ...globalRes.data,
          max_discount_percent: Number(globalRes.data.max_discount_percent),
          min_order_value_paise: Number(globalRes.data.min_order_value_paise),
        }
      : DEFAULT_GLOBAL_WHOLESALE_RULES,
    sellerPermissions,
    productLimits,
    sellers,
    packs: packRows.map((p) => ({
      id: p.id,
      label: `${p.products?.name ?? 'Product'} · ${p.pack_name}`,
      base_price: Number(p.base_price ?? 0),
    })),
    failed: false,
    failureMessage: null,
  };
}
