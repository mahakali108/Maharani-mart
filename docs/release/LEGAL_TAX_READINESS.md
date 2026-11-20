# Legal and tax readiness — owner / CA / advocate checklist

> **SUPERSEDED — kept as a historical record.** This document describes the site as it stood on the
> date in its title and quotes statutory facts that were later withdrawn because the owner never
> verified them (the proprietor's personal name, the trade-name registration status, the registered
> address, the named grievance officer). Do not copy any identity or contact line out of this file.
> The current approved statement is: *Maha Bazar by Maharani is the customer-facing website and app
> name for the AJAY GENERAL proprietorship, which trades under the brand MAHARANI TRADERS. AJAY
> GENERAL is the legal seller and invoice issuer. Maharani Traders is a trading style, not a separate
> incorporated company or legal entity. Maa Kali Enterprises is a separate business identity.*
> See `docs/repair/MAHA_BAZAR_BUSINESS_IDENTITY_REPORT.md`.

**Prepared:** 16 November 2026. **No legal or tax opinion is formed here.** Every
number, registration and statutory reference below is quoted from the product or
marked as missing. Nothing has been invented, and nothing has been published.

Companions: `STAGE1_PAGE_REVIEW.md` (the nine live pages),
`STAGE2_OWNER_CA_CHECKLIST.md` (the ten live-but-unapproved pages),
`ACCEPTANCE_REGISTRY_OPTIONS.md`.

---

## 1. GSTIN and tax invoices

**State today.** The business pages assert GST registration but publish no number:

> *"The owner reports that the business is registered for GST as an active regular
> taxpayer. The GST certificate, GSTIN, registration status and invoice
> configuration have not been independently verified."* — `business-disclosure`

> *"Where GST applies, it is charged at the rate that applies to the product and is
> shown in the order summary and on the invoice."* — `gst-pricing-invoice`

Four open decisions are recorded on that page: **GSTIN**, invoice numbering series
and financial-year prefix, HSN codes and rates per product, and TCS registration for
seller sales.

**Consequence, stated plainly:** with no GSTIN in the system, **no valid tax invoice
can be issued for a delivered order today**. The order confirmation is not a tax
invoice. This blocks B2C/B2B GST compliance, input-credit claims by retailers, and
any B2B expectation of a tax invoice.

| # | Owner action | Evidence to record |
|---|---|---|
| 1.1 | Provide the GSTIN exactly as printed on the certificate | certificate number |
| 1.2 | Confirm the legal name and registered address that must appear on the invoice | certificate |
| 1.3 | Agree the invoice series and the financial-year prefix | sample number |
| 1.4 | Provide HSN codes and rates for the cosmetics/non-food FMCG lines | CA-signed list |
| 1.5 | Decide whether the invoice is issued by the proprietorship for all own-stock sales (the policies say it is) | one-line decision |
| 1.6 | Do **not** publish a GSTIN on the website until the CA has confirmed how it should be displayed | — |

---

## 2. Grievance officer information

**State today** (identical to the live page, verified in `STAGE1_PAGE_REVIEW.md`):

```
Grievance Officer : AJAY KUMAR, Proprietor
Address           : Plot No. 231, Ander Bazar, Belaganj, Gaya, Bihar – 804403
Phone             : 8987023959
Email             : adinathsahu8987@gmail.com
```

Timelines are published as **targets that are still proposals**:

> *"The proposed targets are acknowledgement within 48 hours and an endeavour to
> resolve the grievance within one month from receipt. These targets and the
> complaint-handling workflow require operational and legal verification before
> publication…"*

| # | Action | Why |
|---|---|---|
| 2.1 | Confirm the named officer, designation, postal address, phone and email are current and monitored | a published grievance contact that nobody reads is worse than none |
| 2.2 | Decide whether 48 h / one month become commitments (drop "proposed") or stay targets | a consumer forum reads "proposed" as evasive and the numbers as promises |
| 2.3 | Confirm the mailbox can receive and retain complaints (evidence for a future complaint) | record-keeping |
| 2.4 | CA/advocate: confirm which e-commerce/intermediary and consumer-protection obligations apply to a proprietorship of this size, and whether the published officer details satisfy them | statutory applicability |

**Do not** add a designation, address or number that the owner has not confirmed. The
defaults in `lib/admin/business-settings/server.ts` are deliberately empty.

---

## 3. DPDP / privacy review

**What the policy says today** (live text, carried into stage 1 verbatim) — it is
honest about its own gaps:

| Gap the text admits | Quote |
|---|---|
| no verified data flows | *"Marketplace data flows and disclosures require verification before any third-party operation."* |
| no verified retention schedule | *"Retention periods and deletion procedures require verification…"* |
| no consent mechanism | *"Any legally required consent mechanism must be implemented and verified before publication."* |
| unverified processors | *"The application uses Supabase for authentication and includes Vercel Analytics; actual deployment and provider arrangements should be verified before publication."* |

| # | Action | Owner / CA |
|---|---|---|
| 3.1 | List the personal data actually collected (the policy lists name, mobile, email, addresses, order history, COD status, support messages, device/login data) and confirm each is collected | owner |
| 3.2 | Name the processors and their locations (Supabase region, Vercel) and confirm a data-processing position for each | CA |
| 3.3 | Set a retention schedule per data class; the code has a 14-day AI-retention window (0084) and a 120-day financial window that is **on hold** | owner + CA |
| 3.4 | Decide the consent/notice mechanism for analytics before it is described as compliant | CA |
| 3.5 | Confirm the data-principal request route (access, correction, deletion) and who answers it | owner |
| 3.6 | Confirm whether a Data Protection Officer / grievance route is required at this scale | CA |
| 3.7 | Remove the three "require verification before publication" sentences once the answers are known (§7) | owner |

A DPDP readiness review **has not been done**. The policy is a description, not a
compliance artefact.

---

## 4. Seller agreement

The page is live; three open decisions are recorded on it:

1. commission / fee rates and payout cycle — deliberately absent from the document;
2. TCS under CGST s.52 and TDS under IT s.194-O;
3. liability caps, indemnity wording, notice period and governing forum.

| # | Action | Notes |
|---|---|---|
| 4.1 | Decide commission and payout cycle (kept out of the public agreement on purpose) | if they stay out, the agreement must *say* they are agreed separately — see §7 |
| 4.2 | CA: confirm TCS/TDS applicability and registration before the first third-party sale | see §5 |
| 4.3 | Advocate: liability cap, indemnity, notice period, forum | none of this exists today |
| 4.4 | Confirm the seller is the supplier for GST on seller offers (the agreement says so) and that invoicing follows | this allocation carries the tax risk |
| 4.5 | Decide whether the seller agreement is acceptance-tracked (already is, `seller-agreement 1.0`) and that its page is public before an invitation is sent | see `ACCEPTANCE_REGISTRY_OPTIONS.md` §5 |

No seller can be onboarded until 4.1–4.3 are settled: the agreement is the contract.

---

## 5. Marketplace TCS/TDS applicability

The marketplace switch is data, not code:

* `public.marketplace_launch_approvals` (0098) is an append-only log; the newest row
  wins; **no row = OFF**;
* the table's own constraint refuses an enabling row unless **both** an owner
  approval reference and a CA approval reference are present.

Verified: no row exists, so third-party offers are OFF.

| # | Action | Owner / CA |
|---|---|---|
| 5.1 | Decide whether the marketplace will operate at all in this release | owner |
| 5.2 | If yes: register for TCS under s.52 CGST and TDS under s.194-O, and confirm the software can compute, withhold, deposit and report them | CA (no such code path is verified here) |
| 5.3 | Record the switch-on only through the approval log with both references | owner + CA |

Nothing in the website release turns the marketplace on. Publishing
`marketplace-disclaimer` describes a capability; it does not enable it.

---

## 6. Returns, refunds and delivery commitments

| Commitment | Where | State |
|---|---|---|
| Delivery limited to local serviceable areas in and around Belaganj, Gaya | `shipping` | live text; **not all Gaya PINs** — stated |
| PIN-level blocking when a delivery fee is configured | `shipping` | live text, phrased as an implementation detail (§7) |
| Cash on Delivery only; no online payment | `terms`, `retailer-terms`, `damaged-goods`, `shipping` | live text |
| Return window | `damaged-goods` | **open**: software default 7 days, owner has not set it |
| COD refund method and time | `damaged-goods` | **open**: Coins credit, bank transfer or cash — undecided |
| Change-of-mind returns on opened cosmetics may be refused for hygiene | `returns` | live text |
| Coins balance on account closure | `suspension-termination` | **open**: payout mechanism undecided |

| # | Action |
|---|---|
| 6.1 | Set the return-request window (the UI shows the last date per delivered order) |
| 6.2 | Decide the COD refund method and the time taken, then state both |
| 6.3 | Confirm the delivery area statement matches what checkout actually enforces (area/PIN configuration) |
| 6.4 | Decide whether Coins ever expire and whether loyalty points become redeemable |

A promise the software cannot keep is worse than a conservative one: the order page
already displays a per-order return deadline derived from the configured window.

---

## 7. Public engineering caveats that must not stay in customer policies

These sentences are live today and would be republished verbatim by stage 1 / stage 2.
They are notes to the owner written in the customer's voice. Each proposed rewrite is
a **proposal only** — nothing has been changed in the seed.

| Page | Current text (live) | Proposed replacement (owner/CA to approve) |
|---|---|---|
| privacy (intro) | "…all uses, including any marketplace processing, require verification before publication." | "This policy describes how this website handles personal information." |
| privacy (sharing) | "Marketplace data flows and disclosures require verification before any third-party operation." + "…actual deployment and provider arrangements should be verified before publication." | "Where a third-party seller fulfils an order, that seller receives the order and delivery details needed to fulfil it. Authentication is provided by Supabase and site analytics by Vercel." |
| privacy (cookies) | "Any legally required consent mechanism must be implemented and verified before publication." | "We will ask for consent where the law requires it before using non-essential cookies or analytics." |
| privacy (retention) | "Retention periods and deletion procedures require verification; some transaction or tax records may need statutory retention." | "We keep order and tax records for the period required by law, and other information only as long as needed for the purpose it was collected." |
| grievance | "…require operational and legal verification before publication…" | delete the clause; keep "Applicable statutory rights and timelines are not affected." |
| business-disclosure | "The GST certificate, GSTIN, registration status and invoice configuration have not been independently verified." | "GSTIN: <to be supplied>." — or omit GST claims until the number exists |
| business-disclosure | "…we have not verified whether those features are operating in production." | "Third-party seller offers are not operating at present." (true: the switch is OFF) |
| business-disclosure | "If online payment gateways, wider delivery areas, food products or other services are introduced later, the relevant policies and disclosures must be reviewed and updated before launch." | keep — this one is a legitimate forward-looking statement |
| about | "GST and other statutory invoice information must be verified before publication." | delete |
| shipping | "The current checkout blocks online ordering for PINs configured with a positive delivery fee until that fee can be accounted for correctly." | "Where a delivery charge applies, it is shown at checkout before the order is confirmed." |

Two of these are more than cosmetics:

* the **business-disclosure** GST sentence is the one a customer would quote in a
  complaint about a missing tax invoice;
* the **grievance** clause advertises that the complaint process is unverified.

Editing them before 0105 is applied costs nothing (regenerate the seed). Editing them
after publication means a new version (`1.0` → `1.1`) and, if the registry is used, a
re-acceptance.

---

## 8. What this document is not

It is not a legal opinion, a tax opinion, or a compliance certificate. It lists what a
qualified Indian CA and advocate must decide, with the exact text in front of them.
Where the product could not know a fact — a GSTIN, a refund method, a commission rate
— this document says so instead of inventing it.

---

## 9. Sign-off

| Area | Owner | CA / advocate | Date |
|---|---|---|---|
| GSTIN, invoices, HSN, series (§1) | ☐ | ☐ | |
| Grievance officer details and timelines (§2) | ☐ | ☐ | |
| DPDP review and retention (§3) | ☐ | ☐ | |
| Seller agreement commercial terms (§4) | ☐ | ☐ | |
| TCS/TDS and marketplace switch (§5) | ☐ | ☐ | |
| Returns, refunds, delivery commitments (§6) | ☐ | ☐ | |
| Caveat rewrites before publication (§7) | ☐ | ☐ | |

Owner signature: ______________________  Date: ____________
CA / advocate: ________________________  Date: ____________
