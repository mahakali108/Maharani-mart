import 'server-only';

import type { createClient } from '@/lib/supabase/server';

export interface MarketplaceOfferQuote {
  offerId: string;
  sellerId: string;
  sellerBusinessName: string;
  sellerGstin: string | null;
  productId: string;
  packId: string;
  fulfilmentType: 'seller' | 'maharani';
  unitPricePaise: number;
  moq: number;
  stockQuantity: number | null;
  inStock: boolean;
}

export interface MarketplaceProductOffer extends Omit<MarketplaceOfferQuote, 'productId' | 'stockQuantity'> {
  packName: string;
}

interface RpcError {
  message: string;
  code?: string;
}

interface OfferQuoteRpcRow {
  offer_id: string;
  seller_id: string;
  seller_business_name: string;
  seller_gstin: string | null;
  product_id: string;
  pack_id: string;
  fulfilment_type: string;
  unit_price_paise: number | string;
  moq: number;
  stock_quantity: number | null;
  in_stock: boolean;
}

interface ProductOfferRpcRow {
  offer_id: string;
  seller_id: string;
  seller_business_name: string;
  seller_gstin: string | null;
  pack_id: string;
  pack_name: string;
  fulfilment_type: string;
  unit_price_paise: number | string;
  moq: number;
  in_stock: boolean;
}

function isFulfilmentType(value: string): value is 'seller' | 'maharani' {
  return value === 'seller' || value === 'maharani';
}

/**
 * Reads the narrow 0069 retailer projection for offer identities already held
 * by the caller's cart/order intent. The base seller and seller_offers tables
 * remain hidden by RLS; PAN, contacts and private addresses never cross this
 * boundary.
 */
export async function loadMarketplaceOfferQuotes(
  supabase: ReturnType<typeof createClient>,
  offerIds: string[]
): Promise<{ offers: MarketplaceOfferQuote[]; error: RpcError | null }> {
  const ids = [...new Set(offerIds.filter(Boolean))];
  if (ids.length === 0) return { offers: [], error: null };
  if (ids.length > 200) return { offers: [], error: { message: 'Too many marketplace offers were requested.' } };

  const caller = supabase as unknown as {
    rpc: (
      name: 'marketplace_offer_quotes',
      args: { p_offer_ids: string[] }
    ) => PromiseLike<{ data: OfferQuoteRpcRow[] | null; error: RpcError | null }>;
  };
  const { data, error } = await caller.rpc('marketplace_offer_quotes', { p_offer_ids: ids });
  if (error) return { offers: [], error };

  const offers: MarketplaceOfferQuote[] = [];
  for (const row of data ?? []) {
    const unitPricePaise = Number(row.unit_price_paise);
    if (!isFulfilmentType(row.fulfilment_type)
        || !Number.isSafeInteger(unitPricePaise) || unitPricePaise <= 0
        || !Number.isInteger(row.moq) || row.moq < 1) continue;
    offers.push({
      offerId: row.offer_id,
      sellerId: row.seller_id,
      sellerBusinessName: row.seller_business_name,
      sellerGstin: row.seller_gstin,
      productId: row.product_id,
      packId: row.pack_id,
      fulfilmentType: row.fulfilment_type,
      unitPricePaise,
      moq: row.moq,
      stockQuantity: row.stock_quantity,
      inStock: row.in_stock,
    });
  }
  return { offers, error: null };
}

/** Live, approved offers for one catalogue product, for retailer PDP choice. */
export async function loadMarketplaceOffersForProduct(
  supabase: ReturnType<typeof createClient>,
  productId: string
): Promise<{ offers: MarketplaceProductOffer[]; error: RpcError | null }> {
  const caller = supabase as unknown as {
    rpc: (
      name: 'marketplace_offers_for_product',
      args: { p_product_id: string }
    ) => PromiseLike<{ data: ProductOfferRpcRow[] | null; error: RpcError | null }>;
  };
  const { data, error } = await caller.rpc('marketplace_offers_for_product', { p_product_id: productId });
  if (error) return { offers: [], error };

  const offers: MarketplaceProductOffer[] = [];
  for (const row of data ?? []) {
    const unitPricePaise = Number(row.unit_price_paise);
    if (!isFulfilmentType(row.fulfilment_type)
        || !Number.isSafeInteger(unitPricePaise) || unitPricePaise <= 0
        || !Number.isInteger(row.moq) || row.moq < 1) continue;
    offers.push({
      offerId: row.offer_id,
      sellerId: row.seller_id,
      sellerBusinessName: row.seller_business_name,
      sellerGstin: row.seller_gstin,
      packId: row.pack_id,
      packName: row.pack_name,
      fulfilmentType: row.fulfilment_type,
      unitPricePaise,
      moq: row.moq,
      inStock: row.in_stock,
    });
  }
  return { offers, error: null };
}
