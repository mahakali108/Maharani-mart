/**
 * Single registry of every public legal / policy document.
 *
 * Versioning rules:
 *  - `version` changes whenever the wording changes in a way that affects
 *    rights or duties; `lastUpdated` changes with every published edit.
 *  - `effectiveDate` is the date the current version started to apply.
 *  - A user's acceptance is recorded against (key, version) — see migration
 *    0095 (`legal_document_acceptances`). Never reuse a version string.
 *
 * `reviewStatus` is honest by design: nothing here is marked as approved
 * until the owner (and a qualified legal reviewer) has signed it off.
 */
export type LegalAudience = 'everyone' | 'buyers' | 'sellers';
export type LegalReviewStatus = 'owner_review_pending';

export type LegalDocument = {
  /** Stable key used in acceptance records. Never rename. */
  key: string;
  /** Letter from the readiness brief (A–R), for traceability. */
  ref: string;
  href: string;
  title: string;
  shortLabel: string;
  summary: string;
  audience: LegalAudience;
  version: string;
  effectiveDate: string;
  lastUpdated: string;
  reviewStatus: LegalReviewStatus;
};

export type NotApplicableDocument = { ref: string; title: string; reason: string };

const V1 = { version: '1.0', effectiveDate: '04 November 2026', lastUpdated: '14 November 2026', reviewStatus: 'owner_review_pending' as const };
const NEW = { version: '1.0', effectiveDate: '14 November 2026', lastUpdated: '14 November 2026', reviewStatus: 'owner_review_pending' as const };

export const LEGAL_DOCUMENTS: readonly LegalDocument[] = [
  { key: 'terms', ref: 'A', href: '/legal/terms', title: 'Terms and Conditions', shortLabel: 'Terms', audience: 'everyone', summary: 'The basic rules for using the website, placing orders and paying.', ...V1 },
  { key: 'privacy', ref: 'B', href: '/legal/privacy', title: 'Privacy Policy', shortLabel: 'Privacy', audience: 'everyone', summary: 'What personal data we collect, why, who sees it, and how to ask for access, correction or deletion.', ...V1 },
  { key: 'returns', ref: 'C', href: '/legal/returns', title: 'Cancellation, Return and Refund Policy', shortLabel: 'Returns', audience: 'buyers', summary: 'When an order can be cancelled, how refunds work and what happens to Coins.', ...V1 },
  { key: 'shipping', ref: 'D', href: '/legal/shipping', title: 'Shipping and Delivery Policy', shortLabel: 'Delivery', audience: 'buyers', summary: 'Where we deliver, delivery OTP, and what to check at the door.', ...V1 },
  { key: 'damaged-goods', ref: 'E', href: '/legal/damaged-goods', title: 'Return, Replacement and Damaged Goods Procedure', shortLabel: 'Damaged goods', audience: 'buyers', summary: 'Step-by-step procedure for damaged, short, wrong or expired goods.', ...NEW },
  { key: 'seller-agreement', ref: 'F', href: '/legal/seller-agreement', title: 'Seller Agreement', shortLabel: 'Seller agreement', audience: 'sellers', summary: 'Duties of third-party sellers: registration, genuine goods, labelling, fulfilment, taxes and payouts.', ...NEW },
  { key: 'retailer-terms', ref: 'G', href: '/legal/retailer-terms', title: 'Retailer and Wholesale Buyer Terms', shortLabel: 'Retailer terms', audience: 'buyers', summary: 'Extra terms for shops buying for resale: account approval, pricing category, resale duties.', ...NEW },
  { key: 'marketplace-disclaimer', ref: 'H', href: '/legal/marketplace-disclaimer', title: 'Marketplace Disclaimer', shortLabel: 'Marketplace', audience: 'everyone', summary: 'Which goods are sold by us and which by independent sellers, and who is responsible for what.', ...NEW },
  { key: 'grievance', ref: 'I', href: '/legal/grievance', title: 'Grievance Redressal Policy', shortLabel: 'Grievance', audience: 'everyone', summary: 'How to complain, who handles it, and the acknowledgement and resolution timelines.', ...V1 },
  { key: 'business-disclosure', ref: 'J', href: '/legal/business-disclosure', title: 'Contact and Legal Information', shortLabel: 'Business disclosure', audience: 'everyone', summary: 'Who operates this website, where, and how to reach us.', ...V1 },
  { key: 'gst-pricing-invoice', ref: 'K', href: '/legal/gst-pricing-invoice', title: 'GST, Pricing and Invoice Policy', shortLabel: 'GST & invoices', audience: 'everyone', summary: 'How prices and taxes are shown, and when a tax invoice is issued.', ...NEW },
  { key: 'product-safety', ref: 'L', href: '/legal/product-safety', title: 'Product Authenticity and Safety Policy', shortLabel: 'Product safety', audience: 'everyone', summary: 'Genuine goods, labelling, expiry and how to report a safety concern.', ...V1 },
  { key: 'prohibited-products', ref: 'M', href: '/legal/prohibited-products', title: 'Prohibited and Restricted Products Policy', shortLabel: 'Prohibited products', audience: 'everyone', summary: 'What may never be listed here — including all food products.', ...NEW },
  { key: 'ip-complaints', ref: 'N', href: '/legal/ip-complaints', title: 'Intellectual Property Complaints Policy', shortLabel: 'IP complaints', audience: 'everyone', summary: 'How a brand owner can report a counterfeit or infringing listing.', ...NEW },
  { key: 'suspension-termination', ref: 'O', href: '/legal/suspension-termination', title: 'Suspension, Termination and Dispute Policy', shortLabel: 'Suspension & disputes', audience: 'everyone', summary: 'When an account can be restricted or closed, and how to dispute it.', ...NEW },
  { key: 'cookies', ref: 'P', href: '/legal/cookies', title: 'Cookie and Device Storage Notice', shortLabel: 'Cookies', audience: 'everyone', summary: 'The small files this website stores on your device and why.', ...NEW },
  { key: 'coins-loyalty', ref: 'Q', href: '/legal/coins-loyalty', title: 'Coins and Loyalty Points Terms', shortLabel: 'Coins & points', audience: 'buyers', summary: 'How Coins and loyalty points are added, used, reversed and corrected.', ...NEW },
];

/** Documents from the brief that are deliberately not published, with the reason. */
export const NOT_APPLICABLE_DOCUMENTS: readonly NotApplicableDocument[] = [
  {
    ref: 'R',
    title: 'Advertising and Sponsored Listing Disclosure',
    reason: 'This website has no paid advertising or sponsored product placement feature. If one is introduced, a disclosure policy and on-listing “Sponsored” labels must be published before it goes live.',
  },
];

export function legalDocumentByKey(key: string): LegalDocument | undefined {
  return LEGAL_DOCUMENTS.find((doc) => doc.key === key);
}

export function legalDocumentByHref(href: string): LegalDocument | undefined {
  return LEGAL_DOCUMENTS.find((doc) => doc.href === href);
}

/** Documents a given kind of account must accept (version-pinned) before trading. */
export const REQUIRED_ACCEPTANCE: Record<'retailer' | 'seller', readonly string[]> = {
  retailer: ['terms', 'privacy', 'retailer-terms'],
  seller: ['terms', 'privacy', 'seller-agreement', 'prohibited-products'],
};
