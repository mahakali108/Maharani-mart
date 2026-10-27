# India Legal Readiness — Factual Checklist (configuration view, not a legal opinion)

**Date:** 2026-10-27
**Entity on record:** Ajay General (proprietorship) trading as **Maharani Traders** —
*owner confirmation of the legal name, address and registrations is still outstanding.*
**Operational area:** Gaya district, Bihar (serviceable PINs only)
**Catalogue:** cosmetics and FMCG only — **food products are not enabled**
**Model:** own-stock sales + third-party seller marketplace (admin-approved offers)

> **What this document is.** A list of requirements, what the platform actually
> does today, and what is still missing. It is **not** a conclusion that the
> business is compliant, and it does not replace a CA or a lawyer. Status values
> are restricted to: **Verified in platform**, **Owner Input Required**,
> **CA Review Required**, **Legal Review Required**, **Not applicable**.
> Anything the platform cannot prove is marked as an input, never invented.

The same checklist is rendered in-app at `/admin/compliance` from
`lib/compliance/checklist.ts`, with the live values of the configurable fields.

---

## 1. Current obligations vs future effective dates

| Instrument | Status as understood on 2026-10-27 | What that means here |
| --- | --- | --- |
| Consumer Protection Act, 2019 + Consumer Protection (E-Commerce) Rules, 2020 | In force | Marketplace disclosure, grievance officer, seller disclosure, no unfair trade practice |
| Consumer Protection (E-Commerce) (Amendment) Rules, **2026** | **Notified 9 Sep 2026; reported to take effect 1 Jan 2027** — *a FUTURE effective date* | Additional disclosure duties (price/best-before/return/warranty/delivery/payment terms) and the "copy of recorded complaint" duty become relevant from that date; **do not treat them as current obligations yet** |
| Cosmetics Rules, 2020 (CDSCO) | In force (verify current text/amendments) | Labeling/authorisation duties on the products themselves, not satisfied by listing them online |
| Legal Metrology (Packaged Commodities) Rules, 2011 | In force (verify current text) | Package declarations; the platform stores pack size and MRP but does not verify the physical label |
| CGST Act, 2017 / Bihar SGST | In force | GST registration, invoicing, rate correctness |
| TCS on e-commerce supplies (s.52 CGST / Rule 67A) | Applicability and current rate need CA confirmation | Configuration field exists (1.0% default) but **TCS is not deducted by checkout** |
| Digital Personal Data Protection Act, 2023 + DPDP Rules, 2025 | Rules notified 13 Nov 2025; **phased commencement**: machinery rules in force, consent-manager provisions 13 Nov 2026, substantive obligations 13 May 2027 (verify) | Privacy notice and retention practice must be reviewed before the substantive date; the AI 14-day deletion is a platform decision, not a statutory one |
| IT (Intermediary Guidelines) Rules, 2021 | In force | Grievance/acknowledgement mechanics if the platform is treated as an intermediary |

Every date above must be re-verified against the official notification before
being relied on. The table is deliberately conservative: it separates **in
force** from **future** and flags uncertainty.

Official portals for verification:

* Department of Consumer Affairs — <https://consumeraffairs.nic.in/>
* India Code (Acts) — <https://www.indiacode.nic.in/>
* CDSCO (cosmetics) — <https://cdsco.gov.in/>
* CBIC (GST/TCS) — <https://cbic-gst.gov.in/>
* MeitY (DPDP, IT Rules) — <https://www.meity.gov.in/>

---

## 2. Owner Input Required (the platform cannot and must not invent these)

| # | Item | Where it is used | State |
| --- | --- | --- | --- |
| 1 | Confirmed legal entity name | Terms, invoices, disclosures | Owner Input Required |
| 2 | Registered / principal business address | Terms, grievance page | Owner Input Required |
| 3 | GSTIN (and registration state) | Invoices, GST display | Owner Input Required |
| 4 | PAN | Business profile | Owner Input Required |
| 5 | Support phone number | Support, policies | Owner Input Required |
| 6 | Support email | Support, policies | Owner Input Required |
| 7 | Grievance officer name, designation, email, phone | Grievance page (E-Commerce Rules) | Owner Input Required |
| 8 | Acknowledgement / resolution commitments actually staffed | Grievance SLA | Owner Input Required |
| 9 | Return / refund / shipping terms as actually practised | Policies | Owner Input Required (legal review of wording) |
| 10 | Seller agreement with seller-funded discount terms | Marketplace settlement | CA + Legal Review |

The admin UI renders an unset field as **"Owner Input Required"**. The codebase
does not ship a placeholder phone number or email as if it were operational.

---

## 3. Where each requirement stands in the platform

| Area | Platform behaviour today | Status |
| --- | --- | --- |
| Marketplace entity disclosure | Rendered from authoritative settings; unset fields labelled as owner inputs | **Owner Input Required** |
| Grievance officer + timelines | Support-ticket workflow records acknowledgement/resolution; officer details unconfirmed | **Owner Input Required** |
| Seller identity/disclosure | Seller onboarding is admin-approved; offers require moderation before sale; seller name/GSTIN shown on the offer. No claim of verified identity | **Legal Review Required** |
| Product labeling (cosmetics) | No manufacturing licence / CDSCO authorisation captured; labelling is a product-level duty | **Legal Review Required** |
| Legal Metrology declarations | Pack size + MRP stored; physical label not verified | **Legal Review Required** |
| GST invoicing | GST-inclusive prices, per-product rate, invoice generation from stored order rows; no rate or registration asserted | **CA Review Required** + Owner Input Required |
| Marketplace TCS | Configurable percentage stored; **not** deducted; settlement math must be verified first | **CA Review Required** |
| Discounts & settlement | Seller-funded discounts disabled by default; category pricing applies to own-stock lines only and never reduces seller settlement; membership discounts removed | **CA Review Required** |
| Advertising claims | Paid membership claims removed with migration 0083 | **Verified in platform** |
| Privacy notice / data retention | Privacy page exists; AI-only 14-day deletion implemented; general retention 90/120 days documented in `docs/retention-policy.md`; review against DPDP required | **Legal Review Required** |
| Terms / shipping / cancellation / returns | Pages and workflows exist; consistency with practice and statutory timelines needs review | **Legal Review Required** |
| Food products | Not enabled | **Not applicable** (revisit immediately if enabled) |

---

## 4. Discounts, GST and settlement safeguards (what is actually enforced)

* **Membership checkout discounts:** none. The retired system never had a
  checkout caller; the fee/claim surfaces are gone.
* **Category (tier) prices** are GST-inclusive per piece, server-resolved at
  checkout, and cannot be applied to a seller offer.
* **Seller-funded discounts** remain disabled (`sellerFundedDiscountsAllowed =
  false`) until the seller agreement and settlement math are agreed.
* **CA reference:** a filled reference field is a *project control*, not proof
  that a written opinion exists or that it applies to this arrangement. No
  discount is enabled merely because a field is populated.
* **TCS:** configuration only; no deduction occurs.
* **No tax rate, deadline or legal conclusion is asserted by the code.**

---

## 5. What must happen before launch claims

1. Owner supplies items 1–9 above; each is stored in the authoritative settings
   and rendered from there (no placeholder text).
2. CA confirms: GST registration basis, invoice format/rates, TCS applicability
   and the discount characterisation for both platform- and seller-funded
   discounts.
3. Lawyer reviews: Terms, Privacy, Returns/Refunds/Shipping, the seller
   agreement, and the disclosure set (including the 2026 amendment once it takes
   effect).
4. Cosmetics/Legal Metrology labelling evidence is collected for listed products.
5. Re-verify DPDP commencement dates before the substantive obligations apply.

Until then the honest public statement is that policies and configuration exist
— **not** that the business is compliant.
