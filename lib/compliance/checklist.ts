/**
 * India legal-readiness checklist — DATA ONLY, no legal conclusions.
 *
 * Every item carries an explicit status taken from a closed set, and anything
 * the platform cannot verify is marked `owner_input_required` or routed to a
 * CA/lawyer. Nothing here asserts that the business "is compliant": the page
 * renders configuration readiness and unresolved inputs only.
 *
 * Sources are listed so a reviewer can check them. They were selected from
 * publicly known Indian instruments; the exact text, amendment status and
 * commencement of each item MUST be re-verified against the official source
 * before relying on it (the page states this too).
 */

export type ComplianceStatus =
  | 'verified_in_platform'
  | 'owner_input_required'
  | 'ca_review_required'
  | 'legal_review_required'
  | 'not_applicable';

export interface ComplianceItem {
  id: string;
  area: string;
  requirement: string;
  /** Which platform behaviour, if any, addresses the requirement today. */
  platformState: string;
  status: ComplianceStatus;
  /** Official source to verify (name + URL). Never a paraphrase of law. */
  sources: { label: string; url: string }[];
  /** Which configurable field must be filled, when applicable. */
  ownerInput?: string;
  notes?: string;
}

export const COMPLIANCE_STATUS_LABELS: Record<ComplianceStatus, string> = {
  verified_in_platform: 'Verified in platform',
  owner_input_required: 'Owner Input Required',
  ca_review_required: 'CA Review Required',
  legal_review_required: 'Legal Review Required',
  not_applicable: 'Not applicable',
};

const SOURCES = {
  ecommerceRules2020: {
    label: 'Consumer Protection (E-Commerce) Rules, 2020 — Department of Consumer Affairs',
    url: 'https://consumeraffairs.nic.in/',
  },
  consumerProtection2019: {
    label: 'Consumer Protection Act, 2019 — India Code',
    url: 'https://www.indiacode.nic.in/',
  },
  legalMetrology: {
    label: 'Legal Metrology (Packaged Commodities) Rules, 2011 — Department of Consumer Affairs',
    url: 'https://consumeraffairs.nic.in/',
  },
  cosmeticsRules: {
    label: 'Cosmetics Rules, 2020 — CDSCO',
    url: 'https://cdsco.gov.in/',
  },
  gst: {
    label: 'CGST Act, 2017 and rules — CBIC',
    url: 'https://cbic-gst.gov.in/',
  },
  tcs: {
    label: 'TCS on e-commerce supplies (Section 52 CGST Act / Rule 67A) — CBIC',
    url: 'https://cbic-gst.gov.in/',
  },
  dpdp: {
    label: 'Digital Personal Data Protection Act, 2023 — MeitY',
    url: 'https://www.meity.gov.in/',
  },
  itRules: {
    label: 'Information Technology (Intermediary Guidelines and Digital Media Ethics Code) Rules, 2021 — MeitY',
    url: 'https://www.meity.gov.in/',
  },
} as const;

/**
 * The checklist. `owner_input_required` items are the ones the platform cannot
 * and must not invent (GSTIN, address, grievance officer, phone, email).
 */
export const COMPLIANCE_CHECKLIST: readonly ComplianceItem[] = [
  {
    id: 'entity-disclosure',
    area: 'Marketplace disclosure',
    requirement:
      'Publish the legal entity name, registered address and principal place of business of the marketplace operator, plus customer support contact details.',
    platformState:
      'Contact/grievance details are stored in platform_settings.contact_grievance and rendered from authoritative settings; unconfigured values are shown as "Owner Input Required" rather than a placeholder phone number.',
    status: 'owner_input_required',
    sources: [SOURCES.ecommerceRules2020, SOURCES.consumerProtection2019],
    ownerInput: 'Legal business name, registered address, support phone, support email',
  },
  {
    id: 'grievance-officer',
    area: 'Grievance redressal',
    requirement:
      'Appoint a Grievance Officer, publish their name and contact details, acknowledge complaints within the prescribed period and resolve them within the prescribed period.',
    platformState:
      'The grievance fields exist and the support-ticket workflow records acknowledgement/resolution, but the officer details have not been confirmed by the owner.',
    status: 'owner_input_required',
    sources: [SOURCES.ecommerceRules2020, SOURCES.itRules],
    ownerInput: 'Grievance officer name, designation, email, phone, acknowledgement and resolution commitments',
  },
  {
    id: 'seller-identity',
    area: 'Marketplace sellers',
    requirement:
      'Before listing, obtain and display seller identity and contact details, and require sellers to confirm they comply with applicable law.',
    platformState:
      'The seller marketplace requires admin approval/moderation before an offer can be sold; seller identity fields (business name, GSTIN where provided) are stored on seller records and displayed on the offer.',
    status: 'legal_review_required',
    sources: [SOURCES.ecommerceRules2020],
    notes:
      'Whether the current seller agreement and displayed seller disclosures meet Rule 6 obligations needs a lawyer to confirm; the platform does not claim verification of seller identity.',
  },
  {
    id: 'product-labeling-cosmetics',
    area: 'Product labeling (cosmetics)',
    requirement:
      'Cosmetics offered for sale must comply with labeling/authorisation requirements applicable to the product.',
    platformState:
      'The catalogue is restricted to cosmetics/FMCG; the platform stores product name, brand, pack size and GST, but does not capture manufacturing licence or CDSCO authorisation numbers.',
    status: 'legal_review_required',
    sources: [SOURCES.cosmeticsRules],
    notes: 'Food products are deliberately not enabled on this platform.',
  },
  {
    id: 'legal-metrology',
    area: 'Packaged commodities',
    requirement:
      'Packaged goods declarations (net quantity, MRP, manufacturer/packer, consumer-care details) must be present on the package.',
    platformState:
      'Pack size and MRP are stored per pack; the platform does not verify the physical package declaration.',
    status: 'legal_review_required',
    sources: [SOURCES.legalMetrology],
  },
  {
    id: 'gst-registration',
    area: 'Tax',
    requirement:
      'GST registration and correct tax invoices for taxable supplies; rates depend on the goods and the seller’s turnover.',
    platformState:
      'Invoices are generated from stored GST-inclusive prices with the configured rate per product, and GSTIN is an owner-configurable field. No rate or registration is asserted by the platform.',
    status: 'owner_input_required',
    sources: [SOURCES.gst],
    ownerInput: 'GSTIN, registration state, invoice series and CA-confirmed rates',
  },
  {
    id: 'marketplace-tcs',
    area: 'Tax (marketplace)',
    requirement:
      'Marketplace operators may be required to collect tax at source on certain supplies and file the prescribed statements.',
    platformState:
      'A configurable TCS percentage exists in marketplace compliance settings but is not enforced by checkout until the owner/CA confirms applicability and the settlement logic is verified.',
    status: 'ca_review_required',
    sources: [SOURCES.tcs],
    ownerInput: 'CA note on TCS applicability, rate and filing responsibility',
    notes: 'TCS is NOT deducted today. The field is configuration only.',
  },
  {
    id: 'seller-funded-discounts',
    area: 'Discounts & settlement',
    requirement:
      'Discounts on third-party-sold goods must be transparent and reconciled against the counterparty. Maharani Traders no longer sells third-party goods, so this requirement is recorded as satisfied-by-removal.',
    platformState:
      'Third-party sellers were removed from the platform, so there is no seller-funded discount or seller settlement to reconcile. Category pricing applies to centrally-owned own-stock lines only.',
    status: 'not_applicable',
    sources: [SOURCES.gst],
    ownerInput: 'None — the third-party marketplace was removed; retain only for historical orders.',
  },
  {
    id: 'membership-retirement',
    area: 'Advertising claims',
    requirement: 'Marketing claims must reflect what the platform actually offers.',
    platformState:
      'The paid membership system was retired (migration 0083): no plan, fee or discount claim remains in checkout or marketing surfaces.',
    status: 'verified_in_platform',
    sources: [SOURCES.consumerProtection2019],
  },
  {
    id: 'privacy-notice',
    area: 'Privacy & personal data',
    requirement:
      'Publish a privacy notice describing what personal data is collected, why, how long it is kept and how rights can be exercised.',
    platformState:
      'A privacy policy page exists and the AI-only 14-day retention rule is documented; general business retention is 90/120 days. The privacy notice must be reviewed against the current data-protection framework by counsel.',
    status: 'legal_review_required',
    sources: [SOURCES.dpdp],
    notes: 'Deletion of AI data does NOT extend to orders, invoices, payments or ledger records.',
  },
  {
    id: 'terms-and-policies',
    area: 'Terms & policies',
    requirement:
      'Terms of use, shipping, cancellation, return and refund policies must be published and consistent with the actual workflow.',
    platformState:
      'Policy pages and the return/delivery workflows exist in the app; consistency with actual operational practice and statutory timelines needs legal review.',
    status: 'legal_review_required',
    sources: [SOURCES.consumerProtection2019, SOURCES.ecommerceRules2020],
  },
  {
    id: 'food-products',
    area: 'Scope',
    requirement: 'Food product compliance (FSSAI) would apply only if food were sold.',
    platformState: 'The catalogue is restricted to cosmetics and FMCG; food products are not enabled.',
    status: 'not_applicable',
    sources: [],
    notes: 'Revisit immediately if the owner adds any food category.',
  },
] as const;

/** Counts per status for the summary strip. */
export function complianceSummary(items: readonly ComplianceItem[]): Record<ComplianceStatus, number> {
  const base: Record<ComplianceStatus, number> = {
    verified_in_platform: 0,
    owner_input_required: 0,
    ca_review_required: 0,
    legal_review_required: 0,
    not_applicable: 0,
  };
  for (const item of items) base[item.status] += 1;
  return base;
}
