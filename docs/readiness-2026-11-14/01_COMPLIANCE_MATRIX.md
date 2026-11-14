# Indian legal compliance matrix — 14 November 2026

**Read this first.** This is an engineering compliance review, not legal
advice. Statute titles and rule numbers below were checked against search
results on 14 Nov 2026; most of those results were secondary summaries, and
only the DPDP item was read from an official (PIB) document. Every row must be
confirmed by an advocate and a Chartered Accountant against the official
Gazette / CBIC / CDSCO text before it is relied on. Where that confirmation is
the missing piece, the status is BLOCKED, not PASS.

Status: PASS = evidenced in code/tests. FAIL = gap found. BLOCKED = cannot be
completed without owner information or professional confirmation. N/A = does
not apply to this business as described.

| # | Law / rule | What it asks for (summary) | Where it is handled | Status | Evidence / gap |
|---|---|---|---|---|---|
| 1 | Consumer Protection Act, 2019 + Consumer Protection (E-Commerce) Rules, 2020, r.4 | Legal name, address, contact details; grievance officer name, designation, contact; acknowledge in 48 hours, redress in one month | `/legal/business-disclosure`, `/legal/grievance`, `/contact` | BLOCKED | Pages exist and show owner-provided details hard-coded in `components/legal/business-contact.tsx`. Not verified against registration documents. Live `platform_settings` has no `business_profile` / `contact_grievance` keys. |
| 2 | E-Commerce Rules, r.5 (marketplace) | Seller details on listing; seller undertaking on accuracy; return/refund/delivery/grievance information displayed | `/legal/marketplace-disclaimer`, `/legal/seller-agreement`, cart "Sold by" label | BLOCKED | Documents written; agreement acceptance recorded only after migration 0095 is applied. No seller exists live. |
| 3 | E-Commerce Rules, r.6 (sellers) | Written contract with the marketplace; seller grievance contact; country of origin | Seller Agreement | BLOCKED | Commercial terms and liability wording need a lawyer. Country-of-origin field on listings was **not audited**. |
| 4 | Applicability of 1–3 to trade buyers | Buyers here are retailers buying for resale, who may not be "consumers" under the Act | Retailer Terms state the procedures apply to every buyer regardless | BLOCKED | Legal question for an advocate. The site does not rely on the exclusion. |
| 5 | Digital Personal Data Protection Act, 2023 + DPDP Rules, 2025 | Notice, consent, security safeguards, breach intimation, access / correction / erasure, grievance channel | `/legal/privacy`, `/legal/cookies`, account requests (export, deletion, + correction and consent withdrawal after 0095) | FAIL (partial) | Rules were notified in Nov 2025 with phased commencement; the operative duties are reported to start about 18 months after notification (**confirm date**). Gaps: no itemised consent notice at sign-up; no written breach-response procedure; request handling is manual with no tracked deadline; no Admin screen for the new request types. |
| 6 | Information Technology Act, 2000 + Intermediary Guidelines Rules, 2021 | Published rules/privacy policy/user agreement; grievance officer; action on unlawful content | Terms, Prohibited Products, IP Complaints, Grievance | BLOCKED | Documents exist. Whether the operator is an "intermediary" for seller listings, and the exact timelines, need legal confirmation. |
| 7 | CGST Act, 2017 — registration, tax invoice | GSTIN, tax invoice contents, HSN | `lib/retailer/tax-invoice-readiness.ts`, `/legal/gst-pricing-invoice` | BLOCKED | GSTIN not supplied. The app correctly refuses to label a document a tax invoice until details are complete. |
| 8 | CGST Act s.52 (TCS by e-commerce operator); Income-tax Act s.194-O | Operator collects/deducts tax on third-party seller sales and files returns | Not implemented | FAIL | No TCS/TDS calculation in seller ledger. Rates and applicability must be confirmed by a CA. **Do not switch on third-party seller sales until resolved.** |
| 9 | Legal Metrology Act, 2009 + Packaged Commodities Rules, 2011 | Label declarations; e-commerce display of MRP, net quantity, manufacturer/importer, country of origin, consumer care | Seller Agreement, Product Safety, Retailer Terms (no sale above MRP) | FAIL (partial) | Policy commitments exist. Whether every listing page **displays** the mandatory declarations was not verified field by field. |
| 10 | Drugs and Cosmetics Act, 1940 + Cosmetics Rules, 2020 | Cosmetics only from licensed manufacturers / registered imports; labelling | Seller Agreement, Prohibited Products, catalogue compliance triggers (0086/0087) | BLOCKED | Whether the business itself needs any licence to **stock and sell** cosmetics wholesale in Bihar must be confirmed with the State drugs control office. |
| 11 | BIS | Certain cosmetics are subject to Indian Standards | Seller warranty | BLOCKED | Product-by-product check needed; not automatable from the repo. |
| 12 | Food Safety and Standards Act, 2006 | Would require an FSSAI licence | Food is blocked: category `compliance_scope` trigger rejects non cosmetics/FMCG; Prohibited Products policy | PASS (N/A by design) | DB trigger `CATALOG_CATEGORY_BLOCKED` (0086); policy test. Note 11 pre-existing DB test suites that exercise the catalogue fail in fixture set-up (see test report), so this control is evidenced by the migration and by 0094's fixtures having to bypass it, not by a green dedicated suite. |
| 13 | Payments | RBI rules for online payment / stored value | Cash on Delivery only; Coins are a refund/adjustment ledger | BLOCKED | Whether a Coins balance could be treated as a prepaid instrument should be confirmed by a professional. Coins cannot be bought with money in the app. |
| 14 | Shops & Establishments / trade licence (Bihar) | Local registration | — | BLOCKED | Owner to supply. |
| 15 | Advertising disclosure (CCPA guidelines) | Label paid/sponsored content | No such feature | N/A | Recorded on `/legal`. |
