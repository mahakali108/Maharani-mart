import type { TaxSplitMode } from '@/lib/retailer/invoice-tax';

/**
 * No verified seller-of-record / issuer or issued tax-invoice snapshot exists
 * in the order schema. The legacy /invoice URLs stay as links for old clients,
 * but their output is an order summary, NEVER a GST tax invoice.
 */
export const ORDER_SUMMARY_NOTICE =
  'Order summary only — not a GST tax invoice. Amounts come from the stored order; contact support about any supplier-issued tax invoice.';

/** A GSTIN configured in an env var is not proof of issuer or place of supply. */
export function orderSummaryTaxMode(): TaxSplitMode {
  return 'unsplit';
}
