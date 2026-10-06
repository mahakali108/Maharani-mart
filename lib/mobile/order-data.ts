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

/** One status-history row, as the web order timeline reads them. */
export interface MobileOrderStatusEntry {
  id: string;
  status: string;
  note: string | null;
  createdAt: string;
}

/**
 * Facts only the DETAIL endpoint has.
 *
 * Both are optional so the list endpoint keeps its exact previous payload: a
 * caller that did not ask for the history or the ledger movement does not get
 * an empty array that looks like "this order has no history".
 */
export interface MobileOrderExtras {
  statusHistory?: MobileOrderStatusEntry[];
  /** Coins this order spent/refunded, read from the wallet ledger. */
  coinMovement?: { spentPaise: number; refundedPaise: number; refunded: boolean } | null;
}

/** Convert database truth to a stable, money-safe native API representation. */
export function serializeMobileOrder(row: MobileOrderRow, extras: MobileOrderExtras = {}) {
  const balanceAfterCoinsPaise = row.coins_balance_after_paise == null
    ? null
    : Number(row.coins_balance_after_paise);
  if (balanceAfterCoinsPaise !== null && (!Number.isSafeInteger(balanceAfterCoinsPaise) || balanceAfterCoinsPaise < 0)) {
    throw new Error('Order Coins balance snapshot is invalid.');
  }
  const payload = {
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

  const withExtras: Record<string, unknown> = { ...payload };
  if (extras.statusHistory) withExtras.statusHistory = extras.statusHistory;
  if (extras.coinMovement) {
    // The order's own ledger movement (`spentPaise` already excludes reversed
    // debits), so the detail screen reports what THIS order spent — or what was
    // refunded to the shop when it was cancelled/returned.
    withExtras.coinsSpentPaise = extras.coinMovement.spentPaise;
    withExtras.coinsRefundedPaise = extras.coinMovement.refundedPaise;
    withExtras.coinsRefunded = extras.coinMovement.refunded;
  }
  return withExtras as typeof payload & Partial<{
    statusHistory: MobileOrderStatusEntry[];
    coinsSpentPaise: number;
    coinsRefundedPaise: number;
    coinsRefunded: boolean;
  }>;
}
