# Indian E-Commerce Compliance Matrix — Maharani Traders

**Document Version**: 1.0.0  
**Effective Date**: 2026-10-27  
**Platform**: Maharani Traders (`Maharani-mart`)  
**Operating Entity**: Ajay General (Proprietorship) trading as Maharani Traders  
**Operational Region**: Gaya District / Bihar (Serviceable PINs only)  
**Catalog Classification**: Cosmetics & Fast-Moving Consumer Goods (FMCG) ONLY (Food products explicitly excluded)  
**Business Model**: Hybrid Wholesale B2B Marketplace (Own-stock + Admin-approved third-party seller offers)

---

## 1. Compliance Matrix

| Regulation / Legal Source | Legal Scope & Requirement | Applicability to Maharani Traders | Code / DB Enforcement | Evidence & Verification | Owner / CA / Legal Action Required | Status | Next Action |
| :--- | :--- | :--- | :--- | :--- | :--- | :---: | :--- |
| **Consumer Protection (E-Commerce) Rules, 2020** (Rule 4, 5, 6) | Mandatory entity details, registered name, principal address, customer support, grievance officer contact, response within 48h, redressal within 1 month. | Applicable (even for B2B marketplaces facilitating commercial transactions). | Entity disclosure in footer & `/legal/terms`. Grievance officer listed in `/legal/grievance`. | Static review of legal pages & support routes. | **Owner must provide**: Verified legal business name, permanent address, Grievance Officer name, email, phone number. | **PASS (Gated on Placeholder)** | Replace placeholder tokens once owner confirms official PAN/GSTIN registration certificate details. |
| **Consumer Protection Act, 2019** (Section 2(28), Misleading Ads) | Ban on false or misleading claims, deceptive pricing, fake discounts, and unfair trade practices. | Applicable to all catalog listings, banner artwork, and wholesale discount representations. | Strict admin-only banner moderation (`0074`, `0077`). Pricing tiers locked in DB (`product_pricing_tiers`). | `tests/banner-draft-workflow.test.ts`, `tests/product-pricing.test.ts`. | Owner confirmation that MRP, PTR, and wholesale discount percentages match verified manufacturer invoices. | **PASS** | Continuous auditing of admin catalog additions. |
| **Legal Metrology (Packaged Commodities) Rules, 2011** (Rule 6(10) E-Commerce Amendments) | Mandatory digital display of: Name of manufacturer/packer, Country of origin, Net quantity, Best before/expiry, MRP (inclusive of all taxes), Consumer care details. | Applicable to all packaged cosmetics and FMCG sold online. | Stored in `products` table (`country_of_origin`, `net_quantity`, `mrp`, `expiry_date`). Displayed on PDP. | `components/retailer/product-card.tsx`, `app/retailer/products/[id]/page.tsx`. | Verify data completeness on legacy catalog items before public launch. | **PASS** | Add admin validation blocking publish if `country_of_origin` or `mrp` is null. |
| **Drugs and Cosmetics Act, 1940 & Cosmetics Rules, 2020** (Rules 34-39) | Ban on adulterated, spurious, or counterfeit cosmetics; mandatory manufacturer license number; ban on animal testing claims unless verified; no unsubstantiated medical claims (e.g. skin whitening/cure). | High risk — Cosmetics is a core product category for Maharani Traders. | Seller marketplace is invite-only (`0070_seller_invite_only.sql`). Seller offers require admin moderation before live publishing (`moderation_status = 'approved'`). | `supabase/migrations/0063_seller_offers.sql`, `tests/seller-offers.test.ts`. | **Legal review**: Require cosmetic sellers to upload valid manufacturing/import licenses during onboarding. | **PASS (Architecture)** | Admin checklist for cosmetic SKU verification. |
| **Food Safety and Standards Act, 2006 (FSSAI)** | Mandatory FSSAI license display for food business operators. | **NOT APPLICABLE** (Platform scope is strictly Cosmetics and FMCG; food products are prohibited from the catalog). | Catalog categories restricted to cosmetics, personal care, and general merchandise. | Catalog category constraint tests. | None. Scope strictly maintained. | **NOT APPLICABLE** | Reject any food-related SKU additions during product entry. |
| **Digital Personal Data Protection (DPDP) Act, 2023 & Rules** | Notice and consent for data processing, data minimization, right to correction/erasure, grievance redressal, reasonable security safeguards. | Applicable to all retailer profiles, salesman activity tracking, and device tokens. | Phone OTP authentication without password storage; RLS restricts retailer profile access (`auth.uid() = id`). Data retention archive procedures (`0055_data_retention_cleanup.sql`). | `tests/rls-retailer.test.ts`, `docs/retention-policy.md`. | Provide formal Data Protection Officer (DPO) / Grievance Redressal contact in Privacy Policy. | **PASS** | Keep PII masked in client delivery logs. |
| **Central Goods and Services Tax (CGST) Act, 2017** (Section 15(3) - Discounts) | Pre-supply discounts recorded on invoice are excluded from taxable value. Post-supply discounts require agreement before supply and reversal of ITC by recipient. | Applicable to Coupon and Membership discounts offered to retailers. | Current engine treats discounts as post-tax rupee deductions. Proposed Phase 2B implements additive subtotal discounts. | `lib/orders/quote-order.ts`, `supabase/migrations/0056_mobile_checkout_atomic.sql`. | **CRITICAL CA DECISION REQUIRED**: Written determination on pre-tax vs post-tax discount treatment and GSTR-1 invoice reporting. | **BLOCKED (Awaiting CA)** | Maintain feature flag disabled for membership discounts in checkout until CA signs off. |
| **CGST Act, 2017** (Section 31 & 34 - Tax Invoices & Credit Notes) | Mandatory tax invoice with HSN, GSTIN of supplier and recipient, tax rate breakdown (CGST/SGST/IGST). Credit notes required for returns and price reductions. | Applicable to all fulfilled orders, deliveries, and return workflows. | Order item snapshots capture `unit_price`, `gst_percent`, `line_total`. Delivery actions record returned stock. | `lib/delivery/delivery-actions.ts`, `app/admin/orders/[id]/page.tsx`. | CA review of generated tax invoice format and credit note numbering series. | **PASS (Pending CA sign-off)** | Standardize credit note auto-generation upon delivery shortfall or warehouse return. |
| **CGST Act, 2017** (Section 52 - Tax Collection at Source / TCS) | E-commerce operator must collect 1% TCS (0.5% CGST + 0.5% SGST) on net value of taxable supplies made through it by other suppliers. | Applicable to Split Orders fulfilled by 3rd-party sellers (`fulfilment_type = 'seller'`). | Seller settlements table exists (`0067_seller_settlement.sql`). | `tests/seller-settlement.test.ts`. | **CRITICAL CA DECISION REQUIRED**: Who funds membership discounts on 3rd-party items, and how is net value for TCS calculated? | **BLOCKED (Awaiting CA)** | Prohibit 3rd-party seller offers from qualifying for membership discounts until settled. |
| **Information Technology Act, 2000 & Intermediary Guidelines, 2021** (Rule 3) | Due diligence by intermediary, publishing terms of use, privacy policy, rules for user conduct, reporting cyber security incidents to CERT-In within 6 hours. | Applicable to marketplace operations and retailer user accounts. | Strong authentication, RLS, audit logs on sensitive tables (`0057_security_definer_hardening.sql`, `0078_privilege_hardening.sql`). | Vitest RLS security suites. | Setup dedicated CERT-In security contact email (`security@maharanitraders.com`). | **PASS** | Document incident response protocol. |

---

## 2. Official Government & Statutory Source References

1. **Central Board of Indirect Taxes and Customs (CBIC) - GST Invoice Rules**:
   - URL: https://cbic-gst.gov.in/gst-invoice-rules.html
   - Access Date: 2026-10-27
   - Relevant Mandate: Notification No. 14/2020 – Central Tax (Dynamic QR code on B2C / registered B2B invoice criteria), Section 31 tax invoice details.
2. **Ministry of Consumer Affairs, Food and Public Distribution - E-Commerce Rules**:
   - URL: https://consumeraffairs.nic.in/acts-and-rules/consumer-protection
   - Access Date: 2026-10-27
   - Relevant Mandate: Consumer Protection (E-Commerce) Rules, 2020.
3. **Ministry of Law and Justice - Digital Personal Data Protection Act, 2023**:
   - URL: https://www.meity.gov.in/content/digital-personal-data-protection-act-2023
   - Access Date: 2026-10-27
   - Relevant Mandate: Section 6 (Consent), Section 8 (Obligations of Data Fiduciary).
4. **Central Drugs Standard Control Organization (CDSCO) - Cosmetics Rules, 2020**:
   - URL: https://cdsco.gov.in/opencms/opencms/en/Cosmetics/Cosmetics/
   - Access Date: 2026-10-27
   - Relevant Mandate: Part V (Standards of Cosmetics), Part VII (Labeling and Packaging).
