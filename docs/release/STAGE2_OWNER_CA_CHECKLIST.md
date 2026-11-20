# Stage 2 — owner and CA/advocate review checklist

> **SUPERSEDED — kept as a historical record.** This document describes the site as it stood on the
> date in its title and quotes statutory facts that were later withdrawn because the owner never
> verified them (the proprietor's personal name, the trade-name registration status, the registered
> address, the named grievance officer). Do not copy any identity or contact line out of this file.
> The current approved statement is: *Maha Bazar by Maharani is the customer-facing website and app
> name for the AJAY GENERAL proprietorship, which trades under the brand MAHARANI TRADERS. AJAY
> GENERAL is the legal seller and invoice issuer. Maharani Traders is a trading style, not a separate
> incorporated company or legal entity. Maa Kali Enterprises is a separate business identity.*
> See `docs/repair/MAHA_BAZAR_BUSINESS_IDENTITY_REPORT.md`.

**Subject:** the ten pages that stay drafts in stage 1
(`supabase/publication/stage2_publish_reviewed_additions.sql`).
**Prepared:** 16 November 2026. **Status: ALL TEN REMAIN DRAFTS. Nothing is published.**

> These ten pages are **not new text**. They are live today at
> `/legal/<slug>`, rendered from `lib/legal/content.ts`. A sentence-level diff
> against `656a6a4` finds 0 added and 0 dropped sentences on all ten, and the same
> 15 open decisions. Stage 2 republishes the wording that is already public —
> which is why the review below is about **approving** text, not about drafting it.

One structural difference does need review: the public card *"Points awaiting the
owner's confirmation"* is not rendered after this change (`STAGE1_PAGE_REVIEW.md`
§4 F7). Where a document relied on that card to avoid promising something, the
clause must now say so itself.

---

## 1. How to use this checklist

For each page: read the draft, tick **owner approved** and **CA/advocate reviewed**,
and record the version. Any change of wording after review is a new version
(`1.0` → `1.1`) and re-opens both ticks. Nothing is published until every page the
owner wants live has both ticks — and stage 2 is a single file, so it publishes the
ten together. If only some are approved, the stage-2 file must be edited to that
subset first (a one-line list at the top of the file).

Read the drafts at `content/site-pages.seed.json` (same text as
`supabase/migrations/0105_seed_site_content.sql`) or, once `/admin/content` is
reachable, in the editor.

---

## 2. The ten pages and what each one commits the business to

### 2.1 `damaged-goods` — Return, Replacement and Damaged Goods Procedure

| # | Commitment | Owner | CA/advocate |
|---|---|---|---|
| 1 | Delivery is completed with an OTP that only the buyer receives; goods must be counted and inspected before sharing it | ☐ | ☐ |
| 2 | A shortfall recorded at the door reduces the COD amount, recalculated from recorded quantities | ☐ | ☐ |
| 3 | A return request can be raised from the order page; the last date is shown per delivered order | ☐ | ☐ |
| 4 | Remedy is replacement, collection with refund, or a price adjustment | ☐ | ☐ |

**Open decisions (2):** the return-request window (software default: 7 days) and how
COD refunds are paid (Coins credit, bank transfer or cash) plus the time taken.
Both are unspecified in the text today; stage 2 publishes the text either way, so
the CA should confirm the silence is acceptable.

### 2.2 `seller-agreement` — Seller Agreement

| # | Commitment | Owner | CA/advocate |
|---|---|---|---|
| 1 | Selling is by Super Admin invitation only; no public seller sign-up | ☐ | ☐ |
| 2 | Only approved cosmetics/personal-care/non-food FMCG categories; no food or drink of any kind | ☐ | ☐ |
| 3 | Seller warrants genuine, lawfully sourced goods and the right to sell | ☐ | ☐ |
| 4 | Seller must fulfil or notify immediately; buyer is informed and refunded | ☐ | ☐ |
| 5 | Selling price must not exceed the printed MRP; the seller is the supplier for GST and is responsible for its own invoices and returns | ☐ | ☐ |
| 6 | Buyer data is limited to fulfilment, used only for that order, not reused for marketing | ☐ | ☐ |
| 7 | Suspension/removal grounds: safety, suspected counterfeit, breach, non-response | ☐ | ☐ |
| 8 | A changed agreement gets a new version; acceptance is recorded with version and time | ☐ | ☐ |

**Open decisions (3):** commission/fee rates and payout cycle (deliberately not in
the document); TCS under CGST s.52 and TDS under IT s.194-O; liability caps,
indemnity, notice period and forum. **These are the three items a lawyer must settle
before the first third-party sale** — and item 5's "seller is the supplier for GST"
is the allocation that carries the tax risk.

### 2.3 `retailer-terms` — Retailer and Wholesale Buyer Terms

| # | Commitment | Owner | CA/advocate |
|---|---|---|---|
| 1 | Accounts are reviewed before ordering; true shop details required | ☐ | ☐ |
| 2 | Price, pack size, minimum quantity and slabs are shown before confirmation | ☐ | ☐ |
| 3 | Payment is Cash on Delivery; Coins applied at checkout, balance on delivery | ☐ | ☐ |
| 4 | Resale in original unopened packs with the label intact | ☐ | ☐ |
| 5 | Consumer-protection rights that apply only to personal use may not apply to resale; the complaint/return/refund process is offered regardless | ☐ | ☐ |

**Open decisions (2):** credit terms (the document assumes COD only) and any minimum
order value. Note item 5: the sentence is honest, and a CA should confirm it is not
too broad a disclaimer of statutory rights.

### 2.4 `marketplace-disclaimer` — Marketplace Disclaimer

| # | Commitment | Owner | CA/advocate |
|---|---|---|---|
| 1 | Two kinds of offer: own stock (we are the seller and issue the invoice) and seller offers | ☐ | ☐ |
| 2 | We invite sellers individually and check business details before listing | ☐ | ☐ |
| 3 | We do not manufacture, and make no health/medical/treatment claim | ☐ | ☐ |

No open decisions. This page is the one that decides who a customer contracts with
in each case — it matters if seller offers are ever switched on.

### 2.5 `gst-pricing-invoice` — GST, Pricing and Invoice Policy

| # | Commitment | Owner | CA/advocate |
|---|---|---|---|
| 1 | Price, pack size and quantity are shown before ordering; the summary shows the total | ☐ | ☐ |
| 2 | Delivery or other charges are disclosed before confirmation | ☐ | ☐ |
| 3 | GST is charged at the applicable rate, shown in the summary and on the invoice | ☐ | ☐ |
| 4 | An invoice is issued for every delivered order by the seller of the goods | ☐ | ☐ |

**Open decisions (4):** the GSTIN (the owner reports registration; the number has not
been supplied, so **no tax invoice can be issued yet**), invoice numbering series and
financial-year prefix, HSN codes and rates per product, and TCS registration for
seller sales. This page is the least ready of the ten: its own text cannot be fully
honoured until the GSTIN exists in the invoice configuration.

### 2.6 `prohibited-products` — Prohibited and Restricted Products Policy

| # | Commitment | Owner | CA/advocate |
|---|---|---|---|
| 1 | Food and drink of every kind are never allowed, including supplements, pan masala, edible oils, baby food | ☐ | ☐ |
| 2 | Enforcement is a Super Admin compliance classification per category; only cosmetics/non-food FMCG categories can hold products | ☐ | ☐ |
| 3 | A report is reviewed and the listing removed while checked | ☐ | ☐ |

No open decisions. This is the page that, together with the category classification
in the database, enforces the food exclusion — confirm the classification matches
the policy on the day it goes live.

### 2.7 `ip-complaints` — Intellectual Property Complaints Policy

| # | Commitment | Owner | CA/advocate |
|---|---|---|---|
| 1 | What a complainant must send (identity, contact, the listing, the right relied on, a truth statement, authorisation) | ☐ | ☐ |
| 2 | We acknowledge, check, and remove or disable a listing that appears valid; the seller may reply with evidence | ☐ | ☐ |
| 3 | Product names, logos and pack images belong to their owners and are used only to identify the goods | ☐ | ☐ |

No open decisions. A CA should confirm the notice-and-takedown sequence and the
counter-notice step are enough for the intermediary safe harbour the business wants
to rely on.

### 2.8 `suspension-termination` — Suspension, Termination and Dispute Policy

| # | Commitment | Owner | CA/advocate |
|---|---|---|---|
| 1 | Grounds for restriction: false/unverifiable details, fraud, abuse, breach, legal requirement | ☐ | ☐ |
| 2 | Where safe, the reason is given and there is a chance to explain first | ☐ | ☐ |
| 3 | A retailer can ask for closure from Account → Security; open orders, returns and dues settle first | ☐ | ☐ |
| 4 | Delivered orders, complaints, refunds and dues survive a suspension or closure; a Coins balance representing money paid is not confiscated | ☐ | ☐ |
| 5 | Disputes start with the grievance route, then review by the proprietor | ☐ | ☐ |

**Open decisions (2):** how a remaining Coins balance is paid out on closure, and
whether disputes go to arbitration or court and where. Item 4 is a promise about
money: the payout mechanism must exist before it is relied on.

### 2.9 `cookies` — Cookie and Device Storage Notice

| # | Commitment | Owner | CA/advocate |
|---|---|---|---|
| 1 | Session cookies are necessary; the site cannot work without them | ☐ | ☐ |
| 2 | Vercel Web Analytics counts visits and, per its provider, uses no cookies and does not identify individuals | ☐ | ☐ |
| 3 | No advertising cookies, no social pixels, no sale of browsing data; a future change updates the notice first | ☐ | ☐ |
| 4 | Clearing cookies signs the user out and clears recently viewed; blocking necessary cookies breaks sign-in | ☐ | ☐ |

No open decisions. Item 2 is a statement about a third-party product — it should be
re-checked against Vercel's current documentation at the moment of publication.

### 2.10 `coins-loyalty` — Coins and Loyalty Points Terms

| # | Commitment | Owner | CA/advocate |
|---|---|---|---|
| 1 | Coins are an account balance credited for refunds/adjustments (short or damaged goods) | ☐ | ☐ |
| 2 | Loyalty points: 1 point per full ₹100 of a delivered order; removed if the order is returned | ☐ | ☐ |
| 3 | A wrong entry is checked against the ledger and corrected if genuine | ☐ | ☐ |

**Open decisions (2):** whether Coins expire (software sets none) and whether points
become redeemable. Loyalty points are currently earned but not spendable — a
customer reading this page may expect otherwise; the CA should decide whether the
text must say so explicitly.

---

## 3. Cross-page items that only one reviewer will catch

1. **Which entity contracts with whom.** Own stock: the proprietorship (AJAY KUMAR,
   trade name AJAY GENERAL). Seller offers: the seller, with the operator as
   marketplace. Consistent across `marketplace-disclaimer`, `seller-agreement`,
   `gst-pricing-invoice`.
2. **The grievance route is referenced by five pages.** All five point at
   `/legal/grievance` (published in stage 1) — confirm the route and the timelines
   after F4 of `STAGE1_PAGE_REVIEW.md` is decided.
3. **"Food is never allowed" appears in three pages.** One classification rule in the
   database enforces it.
4. **Two documents promise a new version and a recorded acceptance** (seller
   agreement, and every document once registered). That promise is only true if the
   acceptance registry is used — see `ACCEPTANCE_REGISTRY_OPTIONS.md`.
5. **Cash on Delivery is asserted in four pages.** No online payment gateway exists;
   if one is added, all four change.

---

## 4. Version and date freeze

* Every draft is `version = 1.0`.
* `effective_date = 2026-11-14` for these ten. If publication happens materially
  later, the owner may prefer to move the effective date to the publication date;
  it is a one-field edit before publishing and costs nothing.
* The publication timestamp (`now()`) is independent of the effective date and is
  never backdated.
* Any wording change after review → version `1.1`, new effective date, re-tick.

---

## 5. Sign-off

| Page | Version | Owner approved (name/date) | CA/advocate reviewed (name/date) | Publish |
|---|---|---|---|---|
| damaged-goods | 1.0 | | | ☐ |
| seller-agreement | 1.0 | | | ☐ |
| retailer-terms | 1.0 | | | ☐ |
| marketplace-disclaimer | 1.0 | | | ☐ |
| gst-pricing-invoice | 1.0 | | | ☐ |
| prohibited-products | 1.0 | | | ☐ |
| ip-complaints | 1.0 | | | ☐ |
| suspension-termination | 1.0 | | | ☐ |
| cookies | 1.0 | | | ☐ |
| coins-loyalty | 1.0 | | | ☐ |

Owner signature: ______________________  Date: ____________
CA / advocate: ________________________  Date: ____________

**Status today: all ten are drafts in the database design, all ten boxes are
unticked, and nothing has been published.**
