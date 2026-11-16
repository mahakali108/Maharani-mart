# Stage 1 — page-by-page review before publishing

**Subject:** the nine pages that stage 1 publishes
(`supabase/publication/stage1_publish_live_text.sql`).
**Prepared:** 16 November 2026. **Status: NOT EXECUTED.** Nothing was published.
**Companions:** `MIGRATION_0104_APPROVAL.md`, `MIGRATION_0105_APPROVAL.md`,
`ROLLBACK_AND_RECOVERY.md`, `docs/0104_0105_MIGRATION_AUDIT.md`.

---

## 1. What stage 1 does

It flips nine seeded drafts to published, with `published_at = now()`, no
`published_by`, and a snapshot built from the draft text:

```
about, contact, terms, privacy, returns, shipping,
grievance, business-disclosure, product-safety
```

Everything else stays a draft. Stage 1 does **not** write
`legal_document_current_versions`, so no customer is asked to accept a new
version of anything as a result of it.

Why it must run before the deploy: the deployed routes read the database. With no
published page, `/about`, `/contact` and every `/legal/*` answer "This page is not
available right now." to a visitor, and the mobile pages API returns
`database_unavailable`. Stage 1 makes the nine pages it publishes a
no-visible-change event: the customer sees the text that is already live today.

### 1.1 The ten pages stage 1 does not publish — read this before scheduling

Nineteen pages are live today, not nine. The other ten
(`damaged-goods`, `seller-agreement`, `retailer-terms`,
`marketplace-disclaimer`, `gst-pricing-invoice`, `prohibited-products`,
`ip-complaints`, `suspension-termination`, `cookies`, `coins-loyalty`) were
rendered by `app/legal/[slug]/page.tsx` from `lib/legal/content.ts`, with
`dynamicParams = false` and `generateStaticParams()` over that module.

A sentence-level comparison of those ten pages against `656a6a4` finds **0 added
and 0 dropped sentences** in all ten, and the same 15 open owner decisions. The
seeded drafts are the live text, verbatim.

Consequence: if the deploy happens after stage 1 but **before** stage 2, those ten
policy pages answer "This page is not available right now." — a visible regression
on ten URLs (`/legal/cookies`, `/legal/seller-agreement`, …), not a neutral blank.
Nothing crashes and no draft leaks; ten links in the legal index simply stop
resolving. The legal index (`/legal`) reads the same published list, so it will
show nine entries instead of nineteen.

Three ways to schedule this, for the owner:

| Option | What runs at the deploy | Consequence |
|---|---|---|
| **A. As briefed** | stage 1 only | Ten live pages go dark until stage 2 is approved and run |
| **B. Same window** (recommended if the gap is unacceptable) | stage 1 **and** stage 2 in one change window | No page ever goes dark; every page carries text that is already public today; the "open decisions" cards are removed (see §4 F3 and `STAGE2_OWNER_CA_CHECKLIST.md`) |
| **C. Stage 2 first, deploy later** | publish only the ten, deploy after | Invalid on its own: stage 1 must be live before the deploy or the nine go dark instead |

Option B publishes no new wording — verified sentence by sentence — but it does
publish wording the owner and a CA have not yet formally approved, which is exactly
what the "keep stage 2 as drafts" instruction was meant to prevent. Option A keeps
that instruction and accepts a temporary gap. **This is a scheduling decision, not a
technical one, and it is Decision D2 in the final report.**

---

## 2. How this review was done

Baseline: the wording that was live before this change, read from Git at
`656a6a4` (`main`), not from the working tree — the working tree already contains
the rewritten content:

* `app/about/page.tsx`, `app/contact/page.tsx`
* `components/legal/business-contact.tsx` (the contact block used by every page)
* `app/legal/{terms,privacy,returns,shipping,grievance,business-disclosure,product-safety}/page.tsx`
* `app/legal/[slug]/page.tsx` (the shared shell: title, intro, effective date)

Comparison: every sentence of the seeded draft was checked against that baseline
after normalising whitespace, curly quotes, markdown link syntax and the
`Effective date: …` prefix. A first pass produced 54 "unmatched" sentences; all 54
were extraction artefacts — heading+paragraph joins, JSX `className` fragments,
and the contact block (which the old pages render as a component, so its lines do
not exist as whole sentences in the old source). After removing those artefacts,
**no sentence of business substance differs on any of the nine pages.** What
remains is listed in §4.

---

## 3. Verdict per page

| Page | Title now / title before | Substance | Verdict |
|---|---|---|---|
| About | *Wholesale, with clearer choices* / same | identical claims; links reflowed | ✅ publish as-is |
| Contact | *Get help with your account or order* / same | identical contact details | ✅ publish as-is |
| Terms and Conditions | same | identical | ✅ publish as-is |
| Privacy Policy | same | identical, including the four operator caveats (F2) | ✅ publish, F2 owner decision |
| Cancellation, Return and Refund Policy | same | identical | ✅ publish as-is |
| Shipping and Delivery Policy | same | identical, including the delivery-scope limits and the PIN/fee caveat (F2) | ✅ publish as-is |
| Grievance Redressal Policy | **Grievance Redressal Policy** / *Customer Support and Grievance Redressal Policy* | identical; the amber business-settings block is gone (F3) | ✅ publish, F1 owner confirmation |
| Contact and Legal Information | **Contact and Legal Information** / *Business Disclosure* | identical, including the GST caveat (F2) | ✅ publish, F1 owner confirmation |
| Product Authenticity and Safety Policy | **Product Authenticity and Safety Policy** / *Product Authenticity and Product Safety Policy* | identical | ✅ publish, F1 owner confirmation |

No page changed a price, a delivery promise, a refund right, a statutory
reference, the operating entity, the address, the phone number or the email
address.

---

## 4. Findings

### F1 — three page titles changed (visible, cosmetic)

| Before | After | Where the new title already appears |
|---|---|---|
| Customer Support and Grievance Redressal Policy | Grievance Redressal Policy | `lib/legal/documents.ts` (legal index, mobile contract) |
| Business Disclosure | Contact and Legal Information | same |
| Product Authenticity and Product Safety Policy | Product Authenticity and Safety Policy | same |

The registry and the seeded page agree, so the site will not show two different
names — but the *customer-visible name of a policy changes*, and the acceptance
registry keys do not change (`grievance`, `business-disclosure`,
`product-safety`), so no recorded acceptance is invalidated.
**Owner action:** confirm the three new titles, or ask for them to be reverted
before stage 1 (a one-line change in `content/site-pages.seed.json`, regenerate,
and 0105 must then be re-generated — easier to accept them).

### F2 — four pages carry operator caveats into public text (pre-existing)

These sentences are **already live today**; they are reproduced verbatim, so stage
1 introduces nothing. They are nonetheless engineering notes in front of customers:

* Privacy — intro: "…all uses, including any marketplace processing, **require
  verification before publication**."
* Privacy — "Marketplace data flows and disclosures **require verification** before
  any third-party operation… actual deployment and provider arrangements **should be
  verified before publication**."
* Privacy — "Any legally required consent mechanism **must be implemented and
  verified before publication**."
* Business disclosure — "The GST certificate, GSTIN, registration status and invoice
  configuration **have not been independently verified**"; "**we have not verified**
  whether those features are operating in production".
* About — "GST and other statutory invoice information **must be verified before
  publication**."
* Shipping — "The current checkout **blocks online ordering** for PINs configured with
  a positive delivery fee…" (an implementation detail, not a customer promise).

**Recommendation:** publish stage 1 unchanged (it is the status quo and it is
honest), then fix these sentences by editing the page in `/admin/content` and
republishing — that is exactly the workflow this change exists to enable. **Not a
stage-1 blocker.** If the owner prefers them gone before launch, they must be
edited in `content/site-pages.seed.json`, 0105 regenerated, and the migration not
yet applied (it has not been applied anywhere, so this is still possible).

### F3 — the amber "business settings" block on the grievance page is gone (improvement, no information lost)

The old page rendered, when `business_settings` had a configured grievance contact:

> "Additional contact currently configured in business settings (reconcile and
> verify before publication): …"

On the live project there is **no `business_settings` table at all** (verified
read-only, 16 November 2026) and `DEFAULT_CONTACT_GRIEVANCE.isConfigured` is
`false`, so that block has never rendered. The contact details customers actually
see are the same six fields, unchanged:

```
Proprietor            AJAY KUMAR
Registered trade name AJAY GENERAL
Brand                 MAHARANI TRADERS
Grievance Officer     AJAY KUMAR, Proprietor
Address               Plot No. 231, Ander Bazar, Belaganj, Gaya, Bihar – 804403
Phone                 8987023959
Email                 adinathsahu8987@gmail.com
```

Behaviour change to be aware of: the grievance contact used to be read from
business settings at request time; it is now part of the published snapshot and is
edited in `/admin/content`. When the settings module is eventually used, the two
can diverge — the page is the one customers read.

### F4 — grievance timelines are stated as *proposed* (pre-existing)

> "The **proposed targets** are acknowledgement within 48 hours and an endeavour to
> resolve the grievance within one month from receipt. These targets and the
> complaint-handling workflow **require operational and legal verification before
> publication**…"

Unchanged from the live page. The numbers come from
`DEFAULT_CONTACT_GRIEVANCE` (48 h / 30 days). **Owner decision (post-launch, via the
editor):** confirm the targets and drop the word "proposed", or leave as is. This is
the kind of sentence a consumer forum would read literally.

### F5 — links are now anchors, not `next/link` (behavioural, no text change)

"See the contact options", "Use the Help centre" and the phone/email now render
from the snapshot as plain links. `tel:` and `mailto:` targets are unchanged. The
internal hrefs are the same paths (`/contact`, `/retailer/help`,
`/legal/shipping`), so a customer cannot tell the difference.

### F6 — publication timestamps are current, never backdated

* `published_at` is `now()` at the moment the script runs (16 November 2026 or
  later) — there is no literal date anywhere in the stage-1 file, and the release
  test asserts 0 rows before `2026-11-15` and 0 rows in the future.
* `effective_date` stays `2026-11-04` for these nine pages. That is the date the
  *document* took effect, which is a different thing from the date the database
  started serving it; both are visible and both are correct.
* `published_by` is `null` for the script (a human runs it in the SQL editor);
  pages published later from `/admin/content` carry the Super Admin's id.

### F7 — the public "points awaiting the owner's confirmation" card disappears

Ten of the pages carried a card headed *"Points awaiting the owner's confirmation"*
listing the 15 open decisions (return window, COD refund method, commission and
payout cycle, TCS/TDS under GST s.52 and IT s.194-O, liability caps, credit terms,
minimum order, Coins expiry, loyalty redemption, arbitration venue). That card is
public today: it is in `POLICY_CONTENT[slug].ownerDecisions` and the old page renders
it.

After this change those decisions live in `owner_decisions` and are **not** rendered
to a customer. Two effects, both of which need the owner's eye at stage 2:

1. a customer can no longer read "this document makes no promise about X", so a
   clause that *relied* on that disclaimer now reads as a commitment — for example
   the seller agreement's blank commission and the Coins expiry question;
2. the removal is an improvement in every other respect (internal notes should never
   be public), so this is a "do not lose the disclaimer" problem, not a "do not
   publish" problem.

Recommended wording fix before stage 2 (an owner/CA decision, not applied): where a
document relied on the card, say so in the document itself, e.g. "Commission,
payout cycle and any tax collected at source are agreed separately in writing with
each seller and are not stated in this agreement." Candidates: `seller-agreement`
(3 decisions), `gst-pricing-invoice` (4), `coins-loyalty` (2), `damaged-goods` (2),
`retailer-terms` (2), `suspension-termination` (2).

---

## 5. Exact order (for the owner to run; not executed here)

> The migration channel is the owner's normal controlled process — the CLI
> (`supabase db push --include-all`, transactional, records `schema_migrations`) or
> the SQL editor with the file wrapped in `begin; … commit;`. See
> `docs/0104_0105_MIGRATION_AUDIT.md` §7 and risk R3/R5.

1. **Back up** (`pg_dump` of `public`, or Dashboard → Backups) and confirm the
   history has not moved:
   `select version, name from supabase_migrations.schema_migrations order by version desc limit 3;`
   *today: `20261115155706` / `0102`.*
2. **Apply 0104.** Verify with `MIGRATION_0104_APPROVAL.md` §5 (4 tables, RLS on,
   `anon` cannot read the table, `anon` can execute the two reads).
3. **Apply 0105.** Verify: 19 drafts, 0 published, 70 sections, 19 notes,
   `published_pages()` empty.
4. **Run the stage-1 script** (`supabase/publication/stage1_publish_live_text.sql`)
   in one transaction. Expected notice: `Stage 1 published 9 page(s)…`.
5. **Verify** with `supabase/publication/verify_publication.sql`: 10 drafts,
   9 published, `published_without_snapshot = 0`, index size 9, all nine anonymous
   states `published`, no internal markers.
6. **Deploy** the web app (Vercel) and open all nine URLs (§7).
7. **Create the first Super Admin** (only after stage 1, and only if the owner wants
   to edit content in a browser):

   ```sql
   -- 1) create the login in Dashboard → Authentication → Users → "Add user"
   -- 2) then, with that user's id:
   insert into public.profiles (id, role, full_name, phone)
   select id, 'super_admin', 'AJAY KUMAR', '<owner phone>'
     from auth.users where email = '<owner email>'
   on conflict (id) do update set role = 'super_admin';
   ```

   `profiles` requires `role`, `full_name` and a unique `phone`; `is_super_admin()`
   reads exactly this row. Until it exists, `/admin/content` correctly refuses
   entry and publishing stays a SQL action.

---

## 6. What to look at after the deploy

| URL | Expect |
|---|---|
| `/about` | "Wholesale, with clearer choices", identity block, contact link |
| `/contact` | proprietor, trade name, brand, officer, address, phone, email |
| `/legal` | index of the nine published pages only |
| `/legal/terms` | Terms and Conditions, effective 04 November 2026, v1.0 |
| `/legal/privacy` | Privacy Policy, all four sections, contact block |
| `/legal/returns` | Cancellation, Return and Refund Policy |
| `/legal/shipping` | Shipping and Delivery Policy, serviceability limits |
| `/legal/grievance` | Grievance Redressal Policy, 48 h / one month, contact |
| `/legal/business-disclosure` | Contact and Legal Information, GST caveat |
| `/legal/product-safety` | Product Authenticity and Safety Policy |
| `/legal/seller-agreement` | **"This page is not available right now."** if stage 2 has not run; the same page was live before the deploy (see §1.1) |
| `/legal/cookies` | same — and the eight other stage-2 pages, each of which was live before the deploy |
| `/api/mobile/v1/pages` | nine entries, no drafts |

A published page that says "not available" means `published_snapshot` is null —
run the census query in `ROLLBACK_AND_RECOVERY.md` §6.

---

## 7. Explicit statement of non-execution

No migration was applied, no page was published, nothing was deployed, and no
account was created. The live project `fhrmsrumsraprvutrpeo` still contains zero
`site_page*` objects, one registry row (`seller-agreement 1.0`), zero acceptances,
zero `auth.users` and zero `profiles`. Every statement in this document is a
proposal awaiting the approval in `MIGRATION_0104_APPROVAL.md`,
`MIGRATION_0105_APPROVAL.md` and the stage-1 sign-off below.

| Decision | Tick | Name | Date |
|---|---|---|---|
| Publish the nine pages with today's wording | ☐ approve ☐ reject | | |
| Accept the three title changes (F1) | ☐ approve ☐ reject | | |
| Leave the operator caveats for a post-launch edit (F2) | ☐ approve ☐ reject | | |
| Create the first Super Admin after stage 1 | ☐ approve ☐ reject | | |
| Scheduling (§1.1): ☐ A stage 1 only ☐ B stage 1 + stage 2 in one window | | | |

Owner signature: ______________________  Date: ____________
