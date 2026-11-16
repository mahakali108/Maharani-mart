# Migration 0105 — approval package (draft-only seed)

**File:** `supabase/migrations/0105_seed_site_content.sql` (847 lines, generated)
**Generator:** `scripts/generate-site-content-seed.mjs` from `content/site-pages.seed.json`
**Prepared:** 16 November 2026 · **Status: NOT APPLIED anywhere. Awaiting owner approval.**

> A seed is the one migration in this change that writes *content*. This document
> exists so the owner can approve precisely what that content is — and confirm that
> it publishes nothing.

---

## 1. What the file does, statement by statement

1. One `insert … on conflict (slug) do nothing` per page (19 pages), so the file is
   **idempotent**: re-running it never overwrites an edit made in `/admin/content`.
2. One `insert` per section (70 sections), with `body` and `bullets` as ordered text.
3. `site_page_admin_notes`: 19 notes rows (the operator commentary that used to be
   printed on the public policy pages, 5,668 characters in total).
4. `owner_decisions`: 15 open decisions attached to 6 pages, stored as JSON on the
   page and **never** rendered publicly.
5. A final `do $$ … $$` block that **fails the migration** if (a) any expected slug
   is missing or (b) any seeded page is not a pure draft.

There is **no** `update … set status='published'`, no `published_at`, no
`published_by`, no `published_snapshot`, and no write to
`legal_document_current_versions`.

---

## 2. Exact content inventory

| | Count |
|---|---|
| Pages seeded | 19 (17 legal + About + Contact) |
| Sections | 70 |
| Body paragraphs | 165 |
| Bullet items | 42 |
| Internal notes rows | 19 |
| Open owner decisions | 15 |
| Pages published by this file | **0** |
| Registry rows written by this file | **0** |

Per page (sections / open decisions):

```
terms 5/0          privacy 4/0        returns 4/0       shipping 3/0
damaged-goods 4/2  seller-agreement 8/3  retailer-terms 5/2  marketplace-disclaimer 3/0
grievance 3/0      business-disclosure 2/0  gst-pricing-invoice 3/4  product-safety 2/0
prohibited-products 3/0  ip-complaints 3/0  suspension-termination 5/2
cookies 4/0        coins-loyalty 3/2  about 3/0          contact 3/0
```

All 19 rows carry `version = '1.0'`, `owner_review_pending`, and an
`effective_date`: `2026-11-04` for the nine pages whose wording is already public,
`2026-11-14` for the ten additions.

---

## 3. Why drafts and not published

Publishing is the act that makes a policy legally operative and, for an
acceptance-required document, the act that fixes the version a customer must
accept. A seed cannot take that decision for nineteen pages at once, and a
fabricated historical timestamp would assert the owner published text on a date
nobody chose. The seed therefore creates drafts, and publication is two separate,
reviewed scripts (`supabase/publication/stage1_*.sql`, `stage2_*.sql`).

---

## 4. Verification SQL — executed on PostgreSQL 16, not merely written

The release procedure test (`tests/site-content-release.test.ts`, 5 tests, all
passing) applies every migration, then asserts the following; the same queries can
be pasted into the SQL editor after applying 0105.

```sql
-- 1. every page is a draft, nothing is published, nothing carries a stamp
select count(*)                                              as total,
       count(*) filter (where status = 'draft')              as drafts,
       count(*) filter (where status = 'published')          as published,
       count(*) filter (where published_at is not null)      as stamped,
       count(*) filter (where published_snapshot is not null) as snapshots
  from public.site_pages;
-- expected: 19 / 19 / 0 / 0 / 0

-- 2. no page has a future or backdated publication timestamp
select count(*) as impossible_timestamps
  from public.site_pages
 where published_at > now() or published_at < date '2026-11-01';
-- expected: 0

-- 3. sections and notes are attached to the right pages
select p.slug, count(distinct s.id) as sections, count(distinct n.id) as notes
  from public.site_pages p
  left join public.site_page_sections s on s.page_id = p.id
  left join public.site_page_admin_notes n on n.page_id = p.id
 group by p.slug order by p.slug;
-- expected: 19 rows, sections 2..8, notes 1 each

-- 4. an anonymous caller sees nothing at all
select count(*) as public_index_size from public.published_pages();
-- expected: 0
select p.slug, public.published_page(p.slug) ->> 'state' as anon_state
  from public.site_pages p order by p.slug;
-- expected: 19 rows, all 'unpublished'

-- 5. the acceptance registry is untouched
select document_key, document_version from public.legal_document_current_versions order by 1;
-- expected: one row, seller-agreement 1.0
```

---

## 5. Idempotency and re-run behaviour

* `on conflict (slug) do nothing` on pages and `(page_id, sort_order)` on sections:
  a second run inserts nothing.
* The closing guard counts missing slugs and any non-draft row and raises, so a
  partially edited database fails loudly instead of half-seeding.
* Re-running is safe after stage 1 has published pages: the guard only inspects
  rows **this file created in that run**, and publication is not a seed concern —
  but the guard does raise if a seeded slug is published *and* the file is re-run
  after a schema change. In that case the correct action is to do nothing: the seed
  has already been applied (see `schema_migrations`).

---

## 6. Rollback

`supabase/rollbacks/0105_seed_site_content.down.sql` deletes only the 19 seeded
slugs, and only rows that are still `is_system = true`; a page an editor has
changed stays. It sets `maharani.allow_data_loss = 'true'` for its own session
because the system-page delete guard would otherwise refuse (see
`MIGRATION_0104_APPROVAL.md` §3). Execution proof and the full recovery runbook:
`ROLLBACK_AND_RECOVERY.md`.

---

## 7. Risk register

| Risk | Assessment |
|---|---|
| Seed overwrites the owner's edits | Cannot: `on conflict do nothing` |
| Seed publishes something | Cannot: no publication column is written, and the closing guard raises if any row is not a draft |
| Seed pins an acceptance version | Cannot: the registry is not referenced |
| Seed contains text the owner has not seen | **No.** All 19 pages are text that is live today: the nine are static JSX, the ten were rendered from `lib/legal/content.ts` by `/legal/[slug]`. The seed was generated from those sources and a sentence-level diff against `656a6a4` finds 0 added and 0 dropped sentences on all ten, and no substantive change on the nine. Approval is about *publishing* wording the owner has not yet formally approved, not about new wording. See `STAGE1_PAGE_REVIEW.md` and `STAGE2_OWNER_CA_CHECKLIST.md` |
| Seed is large (847 lines) | 19 pages of plain text; the content is reviewable in `content/site-pages.seed.json` with the same text |

---

## 8. Approval

Approving 0105 approves the exact wording in `content/site-pages.seed.json` at the
commit that contains this document, inserted **as drafts**. It does not approve
publishing any page.

| Decision | Tick | Name | Date |
|---|---|---|---|
| Apply 0105 (19 drafts) to `fhrmsrumsraprvutrpeo` | ☐ approve ☐ reject | | |
| The nine stage-1 pages keep today's live wording (see `STAGE1_PAGE_REVIEW.md`) | ☐ approve ☐ reject | | |
| The ten stage-2 pages may exist as drafts before CA review | ☐ approve ☐ reject | | |

Owner signature: ______________________  Date: ____________
