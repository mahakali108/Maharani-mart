import { createClient } from '@/lib/supabase/server';

export interface SellerOfferTierRow {
  id: string;
  seller_offer_id: string;
  min_quantity: number;
  max_quantity: number | null;
  unit_price_paise: number;
  is_active: boolean;
}

export interface SellerPortalOfferRow {
  id: string;
  seller_id: string;
  product_id: string;
  pack_id: string;
  product_name: string;
  pack_name: string;
  pack_sku_code: string | null;
  fulfilment_type: 'seller' | 'maharani';
  seller_sku: string | null;
  unit_price_paise: number;
  moq: number;
  stock_quantity: number | null;
  is_active: boolean;
  moderation_status: 'pending' | 'approved' | 'rejected';
  moderation_reason: string | null;
  updated_at: string;
  tiers: SellerOfferTierRow[];
}

export interface SellerOrderHeaderRow {
  sub_order_id: string;
  parent_order_id: string;
  order_number: string;
  placed_at: string;
  status: string;
  fulfilment_type: 'seller' | 'maharani';
  gross_paise: number;
  gst_paise: number;
  payable_paise: number;
  shipping_address: {
    line?: string;
    label?: string;
    receiverName?: string;
    phone?: string;
  } | null;
  updated_at: string;
  shipment: {
    status: string;
    courier: string | null;
    awb: string | null;
    packed_at: string | null;
    dispatched_at: string | null;
    delivered_at: string | null;
    cancelled_at: string | null;
  } | null;
  items: {
    id: string;
    product_name: string;
    pack_name: string;
    quantity: number;
    unit_price: number;
    line_total: number;
  }[];
}

export interface CataloguePackOption {
  packId: string;
  productId: string;
  label: string;
  moq: number;
}

export async function listSellerOffers(sellerId: string): Promise<SellerPortalOfferRow[]> {
  const supabase = createClient();
  const { data: rawOffers } = await supabase
    .from('seller_offers' as never)
    .select(
      'id, seller_id, product_id, pack_id, fulfilment_type, seller_sku, unit_price_paise, moq, stock_quantity, is_active, moderation_status, moderation_reason, updated_at'
    )
    .eq('seller_id', sellerId)
    .order('updated_at', { ascending: false });

  const offers = (rawOffers ?? []) as unknown as Omit<
    SellerPortalOfferRow,
    'product_name' | 'pack_name' | 'pack_sku_code' | 'tiers'
  >[];

  if (offers.length === 0) return [];

  const packIds = [...new Set(offers.map((o) => o.pack_id))];
  const offerIds = offers.map((o) => o.id);

  const [{ data: packRows }, { data: tierRows }] = await Promise.all([
    supabase
      .from('product_packs')
      .select('id, pack_name, pack_sku_code, products ( name )')
      .in('id', packIds),
    supabase
      .from('seller_offer_tiers' as never)
      .select('id, seller_offer_id, min_quantity, max_quantity, unit_price_paise, is_active')
      .in('seller_offer_id', offerIds)
      .eq('is_active', true)
      .order('min_quantity', { ascending: true }),
  ]);

  const packById = new Map(
    ((packRows ?? []) as unknown as {
      id: string;
      pack_name: string;
      pack_sku_code: string | null;
      products: { name: string } | null;
    }[]).map((row) => [row.id, row])
  );

  const tiersByOffer = new Map<string, SellerOfferTierRow[]>();
  for (const tier of (tierRows ?? []) as unknown as SellerOfferTierRow[]) {
    const list = tiersByOffer.get(tier.seller_offer_id) ?? [];
    list.push({
      ...tier,
      min_quantity: Number(tier.min_quantity),
      max_quantity: tier.max_quantity === null ? null : Number(tier.max_quantity),
      unit_price_paise: Number(tier.unit_price_paise),
    });
    tiersByOffer.set(tier.seller_offer_id, list);
  }

  return offers.map((offer) => {
    const pack = packById.get(offer.pack_id);
    return {
      ...offer,
      unit_price_paise: Number(offer.unit_price_paise),
      moq: Number(offer.moq),
      stock_quantity: offer.stock_quantity === null ? null : Number(offer.stock_quantity),
      product_name: pack?.products?.name ?? 'Product',
      pack_name: pack?.pack_name ?? 'Pack',
      pack_sku_code: pack?.pack_sku_code ?? null,
      tiers: tiersByOffer.get(offer.id) ?? [],
    };
  });
}

export async function listCataloguePacksForSeller(): Promise<CataloguePackOption[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from('product_packs')
    .select('id, product_id, pack_name, pack_sku_code, moq, is_active, products!inner ( name, is_active )')
    .eq('is_active', true)
    .eq('products.is_active', true)
    .order('pack_name')
    .limit(300);

  return ((data ?? []) as unknown as {
    id: string;
    product_id: string;
    pack_name: string;
    pack_sku_code: string | null;
    moq: number;
    products: { name: string } | null;
  }[]).map((row) => ({
    packId: row.id,
    productId: row.product_id,
    label: `${row.products?.name ?? 'Product'} — ${row.pack_name}${row.pack_sku_code ? ` (${row.pack_sku_code})` : ''}`,
    moq: Number(row.moq ?? 1),
  }));
}

export async function listSellerOrders(sellerId: string, isSellerActive: boolean): Promise<SellerOrderHeaderRow[]> {
  if (!isSellerActive) return [];
  const supabase = createClient();
  const { data: headerData, error } = await supabase.rpc('seller_order_headers' as never);
  const rawHeaders = (headerData ?? []) as unknown[];
  if (error || !Array.isArray(rawHeaders) || rawHeaders.length === 0) {
    return [];
  }

  const headers = rawHeaders as {
    sub_order_id: string;
    parent_order_id: string;
    order_number: string;
    placed_at: string;
    status: string;
    fulfilment_type: 'seller' | 'maharani';
    gross_paise: number | string;
    gst_paise: number | string;
    payable_paise: number | string;
    shipping_address: SellerOrderHeaderRow['shipping_address'];
    updated_at: string;
  }[];

  const subOrderIds = headers.map((h) => h.sub_order_id);
  const [{ data: itemRows }, { data: shipmentRows }] = await Promise.all([
    supabase
      .from('order_items')
      .select('id, sub_order_id, quantity, unit_price, line_total, products ( name ), product_packs ( pack_name )')
      .in('sub_order_id' as never, subOrderIds),
    supabase
      .from('seller_shipments' as never)
      .select('sub_order_id, status, courier, awb, packed_at, dispatched_at, delivered_at, cancelled_at')
      .eq('seller_id', sellerId)
      .in('sub_order_id', subOrderIds),
  ]);

  const itemsBySubOrder = new Map<string, SellerOrderHeaderRow['items']>();
  for (const row of (itemRows ?? []) as unknown as {
    id: string;
    sub_order_id: string | null;
    quantity: number;
    unit_price: number;
    line_total: number;
    products: { name: string } | null;
    product_packs: { pack_name: string } | null;
  }[]) {
    if (!row.sub_order_id) continue;
    const list = itemsBySubOrder.get(row.sub_order_id) ?? [];
    list.push({
      id: row.id,
      product_name: row.products?.name ?? 'Product',
      pack_name: row.product_packs?.pack_name ?? 'Pack',
      quantity: Number(row.quantity),
      unit_price: Number(row.unit_price),
      line_total: Number(row.line_total),
    });
    itemsBySubOrder.set(row.sub_order_id, list);
  }

  const shipmentBySubOrder = new Map<string, NonNullable<SellerOrderHeaderRow['shipment']>>();
  for (const sh of (shipmentRows ?? []) as unknown as ({ sub_order_id: string } & NonNullable<
    SellerOrderHeaderRow['shipment']
  >)[]) {
    shipmentBySubOrder.set(sh.sub_order_id, {
      status: sh.status,
      courier: sh.courier,
      awb: sh.awb,
      packed_at: sh.packed_at,
      dispatched_at: sh.dispatched_at,
      delivered_at: sh.delivered_at,
      cancelled_at: sh.cancelled_at,
    });
  }

  return headers.map((h) => ({
    sub_order_id: h.sub_order_id,
    parent_order_id: h.parent_order_id,
    order_number: h.order_number,
    placed_at: h.placed_at,
    status: h.status,
    fulfilment_type: h.fulfilment_type,
    gross_paise: Number(h.gross_paise),
    gst_paise: Number(h.gst_paise),
    payable_paise: Number(h.payable_paise),
    shipping_address: h.shipping_address ?? null,
    updated_at: h.updated_at,
    shipment: shipmentBySubOrder.get(h.sub_order_id) ?? null,
    items: itemsBySubOrder.get(h.sub_order_id) ?? [],
  }));
}
