import { isValidGstin, normalizeGstin } from '@/lib/retailer/invoice-tax';

/**
 * A rendered document must not be labelled a tax invoice until an issuer is
 * configured and the invoice model is known. This is deliberately a technical
 * publication guard, not GST registration validation or a CA conclusion.
 *
 * HISTORICAL third-party lines stay fail-closed. Maharani Traders no longer
 * sells any third-party goods (the seller marketplace was removed), but orders
 * placed while it existed still contain `source_type = 'seller'` lines. There is
 * no CA-approved seller-of-record / issuer model for those lines, so rendering
 * them under Ajay General's details would misstate who supplied the goods.
 * Refusing the invoice is the honest outcome; the order history remains readable.
 */
/**
 * Just the slice of the environment this guard reads. Structural rather than
 * `NodeJS.ProcessEnv` so a caller can pass a minimal object.
 */
export type EnvLike = Readonly<Record<string, string | undefined>>;

export type TaxInvoiceReadiness =
  | {
      ready: true;
      issuer: { name: string; gstin: string; address: string; phone: string };
    }
  | {
      ready: false;
      reason:
        | 'issuer_details_missing'
        | 'issuer_gstin_invalid'
        | 'issuer_identity_unapproved'
        | 'marketplace_issuer_model_pending';
      message: string;
    };

export interface TaxInvoiceReadinessInput {
  /**
   * True when the order contains any HISTORICAL third-party (`source_type =
   * 'seller'`) line. Such an order cannot be invoiced under our own identity.
   */
  hasMarketplaceSellerLine: boolean;
  /** Injectable for tests; callers use the server environment by default. */
  environment?: EnvLike;
}

/**
 * The issuer must be the proprietorship, not the brand.
 *
 * "Ajay General" (optionally with a legal suffix such as "Proprietor") is the
 * approved issuer. A bare brand name such as "Maharani Traders" or "Maha Bazar by
 * Maharani" is a trading style, not an entity, so it is refused on its own — it
 * may appear alongside the approved name but never instead of it.
 */
function isApprovedIssuerName(value: string): boolean {
  return /\bajay\s+general\b/i.test(value);
}

function text(environment: EnvLike, key: 'COMPANY_NAME' | 'COMPANY_GSTIN' | 'COMPANY_ADDRESS' | 'COMPANY_PHONE'): string | null {
  const value = environment[key]?.trim() ?? '';
  if (!value) return null;
  // Prevent the old human-readable configuration prompt from becoming a legal
  // identity merely because it was copied into an environment value.
  if (/^(?:configure|tbd|todo|n\/?a|owner input required|placeholder)\b/i.test(value)) return null;
  return value;
}

export function getTaxInvoiceReadiness({
  hasMarketplaceSellerLine,
  environment = process.env,
}: TaxInvoiceReadinessInput): TaxInvoiceReadiness {
  if (hasMarketplaceSellerLine) {
    return {
      ready: false,
      reason: 'marketplace_issuer_model_pending',
      // Historical-only path. A few orders placed before the marketplace was
      // discontinued contain third-party-supplied lines, and issuing an invoice
      // in Maharani Traders' name for goods it did not sell would be wrong. The
      // wording therefore says the programme has ended rather than implying the
      // model is still being prepared.
      message: 'This order contains an item that was supplied by a third-party seller under the marketplace that we no longer operate. Because Maharani Traders was not the seller of that item, an invoice cannot be issued for it here; contact us and we will identify the seller of record for that line.',
    };
  }

  const name = text(environment, 'COMPANY_NAME');
  const gstin = normalizeGstin(text(environment, 'COMPANY_GSTIN'));
  const address = text(environment, 'COMPANY_ADDRESS');
  const phone = text(environment, 'COMPANY_PHONE');
  if (!name || !gstin || !address || !phone) {
    return {
      ready: false,
      reason: 'issuer_details_missing',
      message: 'Tax-invoice issuance is unavailable until the owner and CA confirm the issuer name, GSTIN, address and support phone.',
    };
  }
  // The owner has confirmed WHICH identity is the invoice issuer: the AJAY
  // GENERAL proprietorship, trading under the brand MAHARANI TRADERS. The brand
  // is not a legal entity, so an issuer name that names only the brand would put
  // a non-entity on a tax document. Fail closed instead of printing it.
  if (!isApprovedIssuerName(name)) {
    return {
      ready: false,
      reason: 'issuer_identity_unapproved',
      message:
        'Tax-invoice issuance is unavailable because the configured issuer name does not identify the approved business identity (AJAY GENERAL, the proprietorship trading as MAHARANI TRADERS). The brand name alone is not a legal entity and cannot appear as the issuer on its own.',
    };
  }
  if (!isValidGstin(gstin)) {
    return {
      ready: false,
      reason: 'issuer_gstin_invalid',
      message: 'Tax-invoice issuance is unavailable because the configured issuer GSTIN is not syntactically valid. Owner and CA confirmation is required.',
    };
  }

  return { ready: true, issuer: { name, gstin, address, phone } };
}
