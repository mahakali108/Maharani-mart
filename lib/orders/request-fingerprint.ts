import 'server-only';

import { createHash } from 'node:crypto';

export interface FingerprintLine {
  packId: string;
  quantity: number;
  /** Seller offer identity for split-order lines (0064 line_key). Omitted for legacy pack lines so their canonical form is unchanged. */
  sellerOfferId?: string | null;
}

export interface OrderRequestFingerprintInput {
  retailerId: string;
  collectedBy: string | null;
  lines: FingerprintLine[];
  notes?: string | null;
  /** Opaque caller context, e.g. the verified address-book id. */
  context?: string | null;
  /** Legacy server-side callers may bind a verified snapshot as well. */
  shippingAddress?: {
    line: string;
    label?: string;
    receiverName?: string;
    phone?: string;
  } | null;
  couponCode?: string | null;
}

/**
 * Deterministic, privacy-preserving fingerprint for one order intent.
 *
 * No totals, rates, stock, coupon discount or authorization facts are accepted
 * from the client. The server hashes only canonicalized line identity and
 * quantity plus optional text/address context; the actual quote is always
 * recomputed independently by `quoteOrderForRetailer`.
 */
export function createOrderRequestFingerprint(input: OrderRequestFingerprintInput): string {
  const canonical = {
    version: 1,
    retailerId: input.retailerId.trim().toLowerCase(),
    collectedBy: input.collectedBy?.trim().toLowerCase() ?? null,
    lines: input.lines
      .map((line) => {
        const base = { packId: line.packId.trim().toLowerCase(), quantity: line.quantity };
        // Legacy lines keep the exact pre-split canonical shape (no extra key).
        return line.sellerOfferId
          ? { ...base, sellerOfferId: line.sellerOfferId.trim().toLowerCase() }
          : base;
      })
      .sort((left, right) =>
        left.packId.localeCompare(right.packId)
        || String('sellerOfferId' in left ? left.sellerOfferId : '').localeCompare(
             String('sellerOfferId' in right ? right.sellerOfferId : '')
           )
      ),
    notes: (input.notes ?? '').replace(/\r\n/g, '\n').trim(),
    context: input.context?.trim() ?? null,
    shippingAddress: input.shippingAddress
      ? {
          line: input.shippingAddress.line.trim(),
          label: input.shippingAddress.label?.trim() ?? null,
          receiverName: input.shippingAddress.receiverName?.trim() ?? null,
          phone: input.shippingAddress.phone?.trim() ?? null,
        }
      : null,
    couponCode: input.couponCode?.trim().toUpperCase() ?? null,
  };

  return createHash('sha256').update(JSON.stringify(canonical), 'utf8').digest('hex');
}
