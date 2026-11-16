# Staged publication of the managed website pages

**These files are NOT migrations.** `supabase db push` will never run them, and no
automated process reads this directory. Each one is a reviewed, owner-approved
action that a human runs deliberately, one stage at a time, against
`fhrmsrumsraprvutrpeo`.

| Stage | File | What it publishes | Approval needed before running |
| --- | --- | --- | --- |
| 1 | `stage1_publish_live_text.sql` | The **9 pages whose wording is already live today**, unchanged: `about`, `contact`, `terms`, `privacy`, `returns`, `shipping`, `grievance`, `business-disclosure`, `product-safety` | Owner. No new text goes public — this stage only preserves what customers can already read, so the deploy that replaces the static pages does not leave a 404. |
| 2 | `stage2_publish_reviewed_additions.sql` | The **10 pages that did not exist as public pages before**: `damaged-goods`, `seller-agreement`, `retailer-terms`, `marketplace-disclaimer`, `gst-pricing-invoice`, `prohibited-products`, `ip-complaints`, `suspension-termination`, `cookies`, `coins-loyalty` | Owner **and** legal/CA review of each page's text. These are new public statements about refunds, GST, suspension, cookies and the marketplace. |
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
6. DEPLOY the application (the /about, /contact, /legal routes now read the database)
7. run stage2_publish_reviewed_additions.sql       <- owner + legal approval, any time later
8. run verify_publication.sql   -> expect 19 published
```

**Step 4 must happen before step 6.** The deployed site reads pages from the
database; a deploy with nothing published would show "This page is not available
right now." on `/about`, `/contact` and every policy. Unpublishing everything
first and deploying afterwards is the one ordering that produces a visible
regression.

Step 7 is deliberately not urgent: the 10 stage-2 pages are beyond what the site
published before, so leaving them as drafts keeps the public surface exactly as
it is today.

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
