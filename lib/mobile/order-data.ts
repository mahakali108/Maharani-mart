import { toPaise } from '@/lib/retailer/case-pricing';

export interface MobileOrderItemRow {
  id: string;
  product_id: string;
  pack_id: string | null;
  quantity: number;
  quantity_unit: 'packs' | 'cases' | 'pieces' | null;
  quantity_pieces: number | null;
  units_per_case: number | null;
  unit_price: number;
  gst_percent: number;
  line_total: number;
  products: { name: string } | null;
  product_packs: { pack_name: string } | null;
}

export interface MobileOrderRow {
  id: string;
  order_number: string;
  status: string;
  subtotal: number;
  gst_total: number;
  discount_total: number;
  grand_total: number;
  placed_at: string;
  updated_at: string;
  notes: string | null;
  shipping_address: unknown;
  request_completed_at?: string | null;
  coins_balance_after_paise?: number | null;
  order_items: MobileOrderItemRow[] | null;
}

/** Convert database truth to a stable, money-safe native API representation. */
export function serializeMobileOrder(row: MobileOrderRow) {
  const balanceAfterCoinsPaise = row.coins_balance_after_paise == null
    ? null
    : Number(row.coins_balance_after_paise);
  if (balanceAfterCoinsPaise !== null && (!Number.isSafeInteger(balanceAfterCoinsPaise) || balanceAfterCoinsPaise < 0)) {
    throw new Error('Order Coins balance snapshot is invalid.');
  }
  return {
    id: row.id,
    orderNumber: row.order_number,
    status: row.status,
    subtotalPaise: toPaise(Number(row.subtotal)),
    gstTotalPaise: toPaise(Number(row.gst_total)),
    discountTotalPaise: toPaise(Number(row.discount_total)),
    grandTotalPaise: toPaise(Number(row.grand_total)),
    placedAt: row.placed_at,
    updatedAt: row.updated_at,
    notes: row.notes,
    balanceAfterCoinsPaise,
    shippingAddress: row.shipping_address,
    items: (row.order_items ?? []).map((item) => ({
      id: item.id,
      productId: item.product_id,
      packId: item.pack_id,
      productName: item.products?.name ?? null,
      packName: item.product_packs?.pack_name ?? null,
      quantity: item.quantity,
      quantityUnit: item.quantity_unit ?? 'packs',
      quantityPieces: item.quantity_pieces,
      unitsPerCase: item.units_per_case,
      unitPricePaise: toPaise(Number(item.unit_price)),
      gstPercent: Number(item.gst_percent),
      lineTotalPaise: toPaise(Number(item.line_total)),
    })),
  };
}
