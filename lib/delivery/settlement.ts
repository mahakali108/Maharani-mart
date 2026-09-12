/**
 * Partial-delivery settlement math. Pure.
 *
 * When a delivery completes with missing or damaged lines (decision D4),
 * the retailer's wallet is credited back the value of the shortfall as a
 * REFUND_CREDIT ledger entry — the retailer must never pay for goods they
 * did not receive. Damaged goods are also collected back by the driver
 * (order goes to `partially_delivered` when anything is missing/damaged).
 *
 * Per line: shortfall share = round(lineTotal × (missing + damaged) / ordered).
 * `round` (half-up) keeps the sum of credits within ±(lines/2) paise of the
 * exact proportional total — and the exact ordered value is always debited
 * and credited consistently for the delivered remainder.
 */

export interface SettlementLine {
  /** Line total actually debited for this line, in paise (> 0 typically). */
  lineTotalPaise: number;
  /** Pieces this line covers (snapshot from order_items at dispatch). */
  quantityOrdered: number;
  quantityMissing: number;
  quantityDamaged: number;
}

export interface PartialSettlement {
  /** Value to credit back to the retailer's wallet, in paise (>= 0). */
  creditBackPaise: number;
  /** Value of goods actually delivered, in paise (>= 0). */
  deliveredValuePaise: number;
  /** Total pieces not delivered (missing + damaged). */
  shortfallPieces: number;
  /** True when every line was fully delivered. */
  fullyDelivered: boolean;
}

function roundHalfUp(value: number): number {
  return Math.floor(value + 0.5);
}

export function computePartialSettlement(lines: readonly SettlementLine[]): PartialSettlement {
  let orderedValue = 0;
  let creditBackPaise = 0;
  let shortfallPieces = 0;
  let fullyDelivered = true;

  for (const line of lines) {
    const lineTotal = Math.max(0, Math.round(line.lineTotalPaise));
    const missing = Math.max(0, Math.floor(line.quantityMissing));
    const damaged = Math.max(0, Math.floor(line.quantityDamaged));
    const ordered = Math.max(0, Math.floor(line.quantityOrdered));

    orderedValue += lineTotal;
    if (ordered <= 0) continue; // a zero-quantity line cannot have a shortfall

    const notDelivered = missing + damaged;
    if (notDelivered <= 0) continue;

    fullyDelivered = false;
    shortfallPieces += notDelivered;
    if (lineTotal <= 0) continue; // pieces were short, but the line carried no value

    const share = Math.min(lineTotal, roundHalfUp((lineTotal * notDelivered) / ordered));
    creditBackPaise += share;
  }

  return {
    creditBackPaise,
    deliveredValuePaise: Math.max(0, orderedValue - creditBackPaise),
    shortfallPieces,
    fullyDelivered,
  };
}
