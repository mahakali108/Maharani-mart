# Owner information checklist — every item is a launch blocker until supplied

Nothing below was guessed or filled in. Supply each item with a supporting
document; an Admin then enters it in Business Settings (not in code).

## A. Identity and registration
- [ ] Legal name exactly as on the GST certificate. The brief says "Ajay General"; the site currently shows "AJAY KUMAR, Proprietor" trading as "AJAY GENERAL". **Confirm which is right.**
- [ ] GSTIN and a copy of the GST registration certificate.
- [ ] PAN of the proprietor.
- [ ] Principal place of business exactly as registered. The site shows an address in Belaganj, Gaya – 804403 that is hard-coded; confirm or correct.
- [ ] Shops & Establishments / trade licence number, if applicable.
- [ ] Any cosmetics-related licence or written confirmation from the drugs control office that none is needed.

## B. Contact and grievance
- [ ] Official customer-care phone and email (the site shows a personal Gmail address and a mobile number; confirm these are meant to be public).
- [ ] Grievance Officer: name, designation, phone, email, working hours.
- [ ] Confirm the published timelines: acknowledge within 48 hours, resolve within one month.

## C. Commercial policies (the documents make no promise on these yet)
- [ ] Return-request window in days (software default 7; not set).
- [ ] How Cash-on-Delivery refunds are paid, and how quickly.
- [ ] Delivery areas / PIN codes and normal delivery time.
- [ ] Minimum order value; any delivery charge.
- [ ] Whether any retailer gets credit terms.
- [ ] Whether Coins expire; what happens to a Coins balance on account closure.
- [ ] Whether loyalty points will ever be redeemable.

## D. Marketplace (before the first third-party seller)
- [ ] Commission / fee schedule and payout cycle.
- [ ] CA confirmation on TCS (CGST s.52) and TDS (s.194-O) and the operator's registrations.
- [ ] Lawyer-drafted liability, indemnity, notice and dispute clauses for the Seller Agreement.
- [ ] Seller KYC document list and who verifies it.

## E. Tax
- [ ] HSN code and GST rate for each product, signed off by a CA.
- [ ] Invoice number series.

## F. Privacy
- [ ] Person responsible for privacy requests and breach response.
- [ ] Retention periods approved for orders, invoices, KYC documents, delivery proofs.
- [ ] Written breach-response procedure.

## G. Technical decisions
- [ ] Approve deploying this PR, then applying migrations 0094 and 0095 (see `04_MIGRATIONS.md`).
- [ ] Confirm `DELIVERY_OTP_SECRET` and `SUPABASE_SERVICE_ROLE_KEY` are set in Vercel production (not inspected).
- [ ] Decide on the `zod` major-version upgrade (open high-severity advisory).

## H. Professional sign-off
- [ ] Advocate review of all 17 published documents.
- [ ] CA review of GST / invoice / TCS position.
