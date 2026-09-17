import { roundMoney } from '@/lib/orders/credit';

export function roundPct(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Compact Indian numbering without a rupee sign — KPI chips. */
export function formatCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_00_00_000) return `${(value / 1_00_00_000).toFixed(1)}Cr`;
  if (abs >= 1_00_000) return `${(value / 1_00_000).toFixed(1)}L`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return value.toFixed(0);
}

export function formatInr(value: number): string {
  return `₹${roundMoney(value).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatInrCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_00_00_000) return `₹${(value / 1_00_00_000).toFixed(1)}Cr`;
  if (abs >= 1_00_000) return `₹${(value / 1_00_000).toFixed(1)}L`;
  if (abs >= 1_000) return `₹${(value / 1_000).toFixed(1)}k`;
  return formatInr(value);
}

export function formatPct(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${roundPct(value)}%`;
}

export function paiseToRupees(paise: number): number {
  return roundMoney(paise / 100);
}

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: 'Cash',
  bank_transfer: 'Bank transfer',
  upi: 'UPI',
  cheque: 'Cheque',
  other: 'Other',
};

export const ORDER_STATUS_STYLES: Record<string, string> = {
  pending: 'bg-amber-50 text-amber-700',
  confirmed: 'bg-blue-50 text-blue-700',
  processing: 'bg-blue-50 text-blue-700',
  packed: 'bg-violet-50 text-violet-700',
  dispatched: 'bg-violet-50 text-violet-700',
  delivered: 'bg-green-50 text-green-700',
  cancelled: 'bg-primary-50 text-primary-700',
  returned: 'bg-primary-50 text-primary-700',
};

export const AUDIT_TABLE_LABELS: Record<string, string> = {
  products: 'a product',
  price_lists: 'a price',
  orders: 'an order',
  product_packs: 'a product pack',
  product_pricing_tiers: 'a pricing tier',
  retailer_documents: 'a retailer document',
  retailers: 'a retailer',
  banners: 'a banner',
  inventory_stock: 'stock levels',
  stock_movements: 'a stock movement',
  schemes: 'a scheme',
  product_images: 'a product image',
  support_tickets: 'a support ticket',
  payment_collections: 'a collection',
  return_requests: 'a return',
};
