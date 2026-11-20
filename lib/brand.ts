/**
 * CUSTOMER-FACING BRAND, DEFINED ONCE.
 *
 * The business has four names that must stay strictly separate, and this module
 * is the only place the customer-facing app should take them from:
 *
 *   BRAND.name            "Maha Bazar by Maharani"  - the website / app name
 *   BRAND.legalName       "Ajay General"            - the legal seller + invoice issuer
 *   BRAND.legalForm       "proprietorship"          - what kind of entity that is
 *   BRAND.tradingStyle    "Maharani Traders"        - the brand the proprietorship trades under
 *   BRAND.brandFamily     "Maharani"                - a NAME, never a legal entity
 *
 * Owner-approved statement: **Ajay General (proprietorship) is the legal seller and
 * invoice issuer, trading under the Maharani Traders brand.**
 *
 * Rules this module exists to keep:
 *   * The invoice issuer is `legalName`, never the brand alone. A trading style is
 *     not an entity, and printing one on a tax document misstates who issued it.
 *   * Renaming the app to "Maha Bazar by Maharani" changes NO legal fact. The
 *     entity is still Ajay General; nothing here may be read as a new entity.
 *   * Maa Kali Enterprises is a SEPARATE identity. It is deliberately absent from
 *     this module so that no customer-facing surface can pick it up by accident.
 *   * GSTIN, registered address, phone and grievance contact are NOT defined here.
 *     They are owner-supplied facts: lib/legal/issuer.ts marks them pending and
 *     refuses to publish a number it was not given.
 */

export const BRAND = {
  /** Customer-facing website and installable-app name. */
  name: 'Maha Bazar by Maharani',
  /** Kept short enough for a launcher icon label. */
  shortName: 'Maha Bazar',
  /** The legal seller and invoice issuer. Never the brand alone. */
  legalName: 'Ajay General',
  legalForm: 'proprietorship',
  /** The brand the proprietorship trades under. */
  tradingStyle: 'Maharani Traders',
  /** A brand family name. NOT a company, firm or legal entity. */
  brandFamily: 'Maharani',
  /** One-line descriptor used in metadata, shells and the install prompt. */
  tagline: 'B2B wholesale ordering for retailers',
} as const;

/**
 * "Maha Bazar by Maharani" plus the trading style, for places that should show
 * the brand and its provenance (footer, about page, install prompt).
 */
export const BRAND_WITH_TRADING_STYLE = `${BRAND.name} \u00b7 ${BRAND.tradingStyle}`;

/**
 * The legal issuer line for invoices and statutory blocks.
 *
 * Renders as: "Ajay General (proprietorship), trading as Maharani Traders".
 * It never claims a GSTIN or an address - those are added only when the owner
 * supplies verified values.
 */
export const LEGAL_ISSUER_LINE =
  `${BRAND.legalName} (${BRAND.legalForm}), trading as ${BRAND.tradingStyle}`;

/** Page-title helper so every <title> is consistent. */
export function pageTitle(subject: string): string {
  return `${subject} \u2014 ${BRAND.name}`;
}
