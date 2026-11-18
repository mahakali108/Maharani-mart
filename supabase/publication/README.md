# Staged publication of the managed website pages

**These files are NOT migrations.** `supabase db push` will never run them, and no
automated process reads this directory. Each one is a reviewed, owner-approved
action that a human runs deliberately, one stage at a time, against
`fhrmsrumsraprvutrpeo`.

| Stage | File | What it publishes | Approval needed before running |
| --- | --- | --- | --- |
| 1 | `stage1_publish_live_text.sql` | The **9 pages whose wording is already live today**, unchanged: `about`, `contact`, `terms`, `privacy`, `returns`, `shipping`, `grievance`, `business-disclosure`, `product-safety` | Owner. No new text goes public — this stage only preserves what customers can already read, so the deploy that replaces the static pages does not leave a 404. |
| 2 | `stage2_publish_reviewed_additions.sql` | The **9 pages that did not exist as public pages before**: `damaged-goods`, `retailer-terms`, `marketplace-disclaimer`, `gst-pricing-invoice`, `prohibited-products`, `ip-complaints`, `suspension-termination`, `cookies`, `coins-loyalty`. **`seller-agreement` was removed from this stage** when the marketplace was discontinued (migration 0110) — it is a historical contract with a seller class that no longer exists and must not be published. | Owner **and** legal/CA review of each page's text. These are new public statements about refunds, GST, suspension, cookies and the discontinued marketplace. |
| — | `verify_publication.sql` | Read-only checks: what is published, what is still a draft, and what an anonymous caller can see | None — it changes nothing. |

## Why publication is not part of 0105

Migration `0105` seeds all 19 pages as **drafts** and cannot publish anything: its
own final check raises an exception if any seeded row has a `published_snapshot`,
a `published_at` or a `published_by`. Three reasons:

1. **Publishing is a legal act, not a seed.** A published legal page is what a
   customer is shown and (for an acceptance-required document) what fixes the
   version they accept. That is the owner's decision, page by page.
2. **No invented history.** Seeding `published_at = 2026-11-14T00:00:00+00` would
   record that the owner published 19 policies on a date they never chose, and
   that timestamp is what the public page shows as its publication date.
3. **Reversibility.** A draft is invisible. If a stage is wrong, `unpublish` puts
   the page back to invisible in one statement; a bad publish has already been
   read by customers and indexed by search engines.

## Order of operations (do not reorder)

```
1. apply 0104        (schema, RLS, functions)      <- owner approval
2. apply 0105        (19 draft pages)              <- owner approval
3. run verify_publication.sql   -> expect 0 published, 19 draft, anon reads nothing
4. run stage1_publish_live_text.sql                <- owner approval
5. run verify_publication.sql   -> expect 9 published, 10 draft
6. run stage2_publish_reviewed_additions.sql       <- owner + legal approval, SAME WINDOW
7. run verify_publication.sql   -> expect 19 published
8. DEPLOY the application (the /about, /contact, /legal routes now read the database)
9. re-run verify_publication.sql and check all 19 URLs
```

**Steps 4 and 6 must both happen before step 8.** The deployed site reads pages
from the database; a page that is still a draft answers "This page is not
available right now." Unpublishing everything first and deploying afterwards is
the one ordering that produces a visible regression.

**Correction (verified against production on 16 November 2026).** An earlier
version of this file said the ten stage-2 pages "are beyond what the site
published before", and that deferring stage 2 kept the public surface unchanged.
That is **wrong**, and following it would have taken ten live URLs off the air:

```
/legal/damaged-goods     /legal/retailer-terms
/legal/marketplace-disclaimer   /legal/gst-pricing-invoice
/legal/prohibited-products      /legal/ip-complaints
/legal/suspension-termination   /legal/cookies     /legal/coins-loyalty
```

All nineteen pages — these ten, the seven legal pages in stage 1, `/about` and
`/contact` — are served by the deployed application today (the live `/legal` index
lists all seventeen registry documents, and pages from both stages were fetched
directly). `tests/site-content-continuity.test.ts` already encodes the same fact:
nineteen URLs live before the change, nineteen published after both stages.

The wording in both stages is byte-identical to what is live today: regenerating
`content/site-pages.seed.json` and `0105` from the current page sources is a no-op
(`tests/site-content-seed.test.ts` → "generator drift"). So publishing stage 2 is
not a new publication in substance — it is the same text moving from JSX to the
database — and doing it in the same window as stage 1 removes the dark-page risk
instead of creating it.

Deferring stage 2 is only acceptable if the owner explicitly accepts that these
nine URLs will answer "This page is not available right now." until stage 2 runs.

`/legal/seller-agreement` is a separate case and is NOT published by either
stage. Since migration 0110 discontinued the marketplace there is no seller to
bind by it: no seller invitations can be issued (0110 closes `handle_new_user`
and revokes the invitation RPCs) and every seller-role profile is deactivated,
so nothing can trigger an acceptance requirement. The page, its wording and its
`legal_document_current_versions` row are all preserved — see the
seller/supplier removal implementation report for the decision record.

## What a stage does, mechanically

For each slug it runs, inside one transaction:

```sql
update public.site_pages p
   set status = 'published',
       published_at = now(),          -- the real time, never a backdate
       published_by = null,           -- no signed-in user: an operator action
       published_snapshot = public.site_page_snapshot(p.id)
 where p.slug = '<slug>'
   and p.status <> 'published';
```

* `published_at = now()` — the time the owner actually published it.
* `site_page_snapshot()` builds the customer-visible copy from the draft, and the
  script refuses to publish a page whose snapshot has no visible section.
* It does **not** call `publish_legal_document_version()`. Acceptance registry
  entries are a separate decision — see the acceptance section of
  `docs/PR134_FINAL_REVIEW_2026-11-15.md`.

## Rolling a stage back

```sql
-- One page:
select public.unpublish_site_page((select id from public.site_pages where slug = '<slug>'));
-- or, without a super-admin session:
update public.site_pages
   set status = 'draft', published_snapshot = null, published_at = null
 where slug = '<slug>';
```

The page becomes invisible immediately (`published_page()` returns
`state = 'unpublished'`, the mobile API returns `404 not_found`). The draft, its
sections and its internal notes are untouched, so it can be published again after
an edit.

## What is never published by these scripts

Business/GST approvals, the marketplace switch, seller invitations, readiness
flags, or any `platform_settings` row. Publication here is website content only.
