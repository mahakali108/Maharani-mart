# Chartered Accountant / Tax Consultant Review Questionnaire
## Subject: Indian GST Treatment of Retailer Memberships, Multi-Tier Discounts & Marketplace Split Orders

**Entity**: Ajay General (Proprietorship) trading as Maharani Traders  
**GSTIN State**: Bihar (08 / 10 state code depending on registration)  
**Date Submitted**: 2026-10-27  
**Status**: AWAITING FORMAL WRITTEN OPINION  

---

## Instructions for Reviewing Chartered Accountant
The engineering team has prepared the database schema and atomic transactional logic for Phase 2B (Retailer Memberships, Loyalty, and Split-Order Marketplace Checkout). To prevent tax non-compliance, penal interest, or Input Tax Credit (ITC) denial for B2B retailers, the technical implementation has been gated pending your formal written determination on the following specific legal questions.

Please review each question, cite relevant sections/rules of the CGST Act 2017 and CBIC circulars, and provide your formal binding recommendation.

---

### Question 1: Pre-Supply vs. Post-Supply Discount Characterization (Section 15(3))
**Context**:
Maharani Traders offers paid membership tiers (Silver: 2%, Gold: 5%) granting an extra discount on eligible wholesale orders. In checkout, this discount is computed additively with active coupons based on the order subtotal.

**Options**:
- **Treatment A (Pre-Supply In-Invoice Discount under Section 15(3)(a))**:
  - The discount is known at or before the time of supply and is shown on the tax invoice.
  - Taxable value of each item is reduced proportionately *before* applying GST (e.g., ₹100 item @ 18% with 5% discount: Taxable Value becomes ₹95, GST charged = ₹17.10, Total = ₹112.10).
- **Treatment B (Commercial / Financial Post-Tax Discount under Section 15(3)(b) or Circular 92/11/2019-GST)**:
  - The discount is treated as a commercial concession on the final invoice gross total. GST is charged on the full ₹100 taxable value (GST = ₹18.00). The ₹5 discount is deducted from the gross payable. Output tax liability is NOT reduced.

**Specific Questions for CA**:
1. Does the Silver/Gold membership discount qualify as an in-invoice pre-supply discount under Section 15(3)(a), allowing Maharani Traders to pay output GST only on the net discounted taxable value?
2. If Treatment A applies, does the B2B tax invoice need to show the undiscounted base price, the discount amount, and the net taxable value for every single HSN line item?
3. If Treatment B applies, does issuing a commercial credit note later violate any ITC matching rules for the purchasing retailer?

---

### Question 2: Mixed-Rate GST Invoices & Proportional Discount Allocation
**Context**:
A retailer places a single order containing FMCG and cosmetic items spanning different GST slabs (e.g., hair oil at 5%, cosmetics at 18%, sanitary napkins at 0%). The retailer receives an overall order-level coupon (₹500) and membership discount (₹300).

**Specific Questions for CA**:
1. For tax invoice generation, how must the order-level discount be apportioned across items with different tax rates?
2. Is the **Largest-Remainder (Hamilton) Method**—which allocates the discount in integer paise proportionally based on each item's share of the eligible subtotal—acceptable under GST audit rules?
3. Can an order-level discount be apportioned against 0% (exempt/nil-rated) goods, or must it only be deducted from taxable items?

---

### Question 3: Marketplace Split Orders & Third-Party Seller Discount Funding
**Context**:
Maharani Traders operates a hybrid marketplace. An order may contain:
- Line 1: Maharani warehouse pack stock (fulfilled by Maharani Traders).
- Line 2: Drop-ship seller item (fulfilled by an independent 3rd-party seller registered on the platform).

**Specific Questions for CA**:
1. **Who is the legal invoice issuer for third-party seller lines?** Under Section 31, does the third-party seller issue the tax invoice directly to the retailer, or does Maharani Traders issue a composite invoice as an agent?
2. **Who funds the membership discount?**
   - If Maharani Traders funds the discount (platform-funded): The seller expects their full agreed offer price. Does Maharani issue a subsidy or financial credit note to the seller?
   - How is **Tax Collection at Source (TCS) under Section 52** calculated? Is 1% TCS collected on the gross seller offer price, or on the net price paid by the retailer after the membership discount?
3. If the third-party seller is unregistered or operates under the composition scheme, how does that impact the invoice and TCS requirements?

---

### Question 4: Partial Deliveries, Shortfalls & Tax Credit Notes (Section 34)
**Context**:
During local delivery, some items are found damaged or missing. The delivery staff records the shortfall in the app, and the value of missing goods is immediately credited back to the retailer's wallet ledger as a refund.

**Specific Questions for CA**:
1. If the delivery driver records a shortfall at the shop doorstep before physical handover:
   - Must the original tax invoice be cancelled and re-issued for the delivered quantity?
   - Or must Maharani Traders issue a formal **GST Credit Note under Section 34** referencing the original invoice number?
2. When calculating the credit note value for a discounted item:
   - Must the credit note reflect the *net discounted taxable value* and proportionate tax reversal, rather than the original gross catalog price?
3. What is the statutory time limit under Section 34(2) for reporting credit notes in GSTR-1?

---

### Question 5: GST Liability on Paid Membership Subscription Fees
**Context**:
Retailers pay an upfront fee to activate premium membership tiers:
- Silver Tier: ₹499 for 30 days.
- Gold VIP Tier: ₹999 for 30 days.

**Specific Questions for CA**:
1. Is the membership fee subject to GST? Under which SAC code (e.g., SAC 999599 — Other services provided by membership organisations, or SAC 998319 — Other information technology and e-commerce services)?
2. What is the applicable GST rate (standard 18%)?
3. Must a separate B2B tax invoice be generated and issued to the retailer at the moment of membership activation?
4. If a retailer's membership is cancelled and refunded by an admin, is a GST credit note required for the membership fee?

---

## Sign-Off Block

**Reviewing Chartered Accountant**:  
Firm Name: __________________________________________________  
Membership No. / FRN: _______________________________________  
Signature: __________________________________________________  
Date: _______________________________________________________  
Formal Opinion Attached: [ ] YES  [ ] NO
