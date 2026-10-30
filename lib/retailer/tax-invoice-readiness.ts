import { isValidGstin, normalizeGstin } from '@/lib/retailer/invoice-tax';

/**
 * A rendered document must not be labelled a tax invoice until an issuer is
 * configured and the invoice model is known. This is deliberately a technical
 * publication guard, not GST registration validation or a CA conclusion.
 *
 * Marketplace seller lines are fail-closed: this repository does not yet have
 * a CA-approved seller-of-record / issuer model or per-seller tax-invoice
 * renderer. Rendering them under Ajay General's details would be misleading.
 */
export type TaxInvoiceReadiness =
  | {
      ready: true;
      issuer: { name: string; gstin: string; address: string; phone: string };
    }
  | {
      ready: false;
      reason: 'issuer_details_missing' | 'issuer_gstin_invalid' | 'marketplace_issuer_model_pending';
      message: string;
    };

export interface TaxInvoiceReadinessInput {
  /** Any seller-source line requires an approved marketplace invoice model. */
  hasMarketplaceSellerLine: boolean;
  /** Injectable for tests; callers use the server environment by default. */
  environment?: NodeJS.ProcessEnv;
}

function text(environment: NodeJS.ProcessEnv, key: 'COMPANY_NAME' | 'COMPANY_GSTIN' | 'COMPANY_ADDRESS' | 'COMPANY_PHONE'): string | null {
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
      message: 'Tax-invoice issuance for marketplace seller items is pending the owner and CA-approved seller-of-record and invoice-issuer model.',
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
  if (!isValidGstin(gstin)) {
    return {
      ready: false,
      reason: 'issuer_gstin_invalid',
      message: 'Tax-invoice issuance is unavailable because the configured issuer GSTIN is not syntactically valid. Owner and CA confirmation is required.',
    };
  }

  return { ready: true, issuer: { name, gstin, address, phone } };
}
