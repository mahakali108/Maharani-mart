# Website content management (Super Admin)

**Shipped in:** migrations `0104_site_content_management.sql`,
`0105_seed_site_content.sql` · web module `lib/site-content/*`,
`app/admin/content/**` · Android API `/api/mobile/v1/pages`, `/pages/{slug}`.

Every public information page — About Us, Contact and all 17 policy documents —
is now **content in the database**, editable by a Super Admin in
`/admin/content`. Before this module, that text was JSX in the repository: the
owner could not correct a phone number, a delivery promise or a grievance
timeline without a code change and a deploy, and the pages carried an operator
notice that customers could read.

---

## 1. What a Super Admin can do

Open **Admin → Website Content**. The list shows every page with its address,
status, version and review state.

| Capability | Where |
| --- | --- |
| Create a page (address, menu label, title, type, audience) | list page, "Create a new page" |
| Edit heading, eyebrow, introduction, search description, version, effective date, menu order, related pages, header image | page editor, "Page details" |
| Add / edit / delete / reorder content sections | page editor, "Content sections" |
| Edit paragraphs, bullets, a highlighted style, an image, an optional button (label + destination) | each section form |
| Hide a section without deleting it | "Visible on the public page" |
| Show/hide a page in the footer menu or the policy index | "Page details" checkboxes |
| Save a draft without touching the live page | "Save draft" |
| Preview exactly what publishing would produce | "Preview draft" |
| Publish / unpublish | "Publishing status" |
| See publishing history (version, event, time, snapshot) | "Publishing history" |
| Record internal notes, open owner decisions and the review status | "Internal review" |
| Manage the legal entity, GST state, storefront contact details and grievance officer | `Business & contact details` (`/admin/content/business`) |

**Publishing is a separate step from saving.** A page has a working *draft* and
an immutable *published snapshot*. Editing a draft never changes what a customer
sees; only **Publish** copies the draft into `site_pages.published_snapshot`.
This is what makes "no draft content visible to customers" a database property
rather than a UI convention.

## 2. What a customer can see

* The published snapshot only: `/about`, `/contact`, `/legal/<slug>`, `/legal`.
* A page that exists but is unpublished answers with a short, plain message —
  *"This page is not available right now."* — with links to the other policies
  and to contact. It never says "draft", "review", "unpublished" or "admin".
* A page address that does not exist is a 404.
* A database failure says the page could not be loaded (and is logged), rather
  than pretending the policy does not exist.

### Footer links are content, not code

Every footer in the product — public pages, the sign-in/registration frame,
retailer, seller, staff, salesman and admin shells — renders
`loadFooterLinks()` (`lib/site-content/nav.ts`). That function reads
`published_pages()` and maps each footer-visible page to
`/legal/<slug>` (kind `legal`) or `/<slug>` (kind `page`), labelled with
`short_label ?? nav_label`, in the Super Admin's `sort_order`. Consequences:

* changing a page's footer label, order or visibility needs no deploy;
* **unpublishing** a page removes its footer link automatically — the address
  still opens the clean "not available right now" message for anyone holding it;
* the same mapping builds the public information pages' own navigation
  (`informationNav`), so a page can never carry two different labels.

`lib/site-content/nav.ts` holds the only list of policy addresses in application
code, and it is a navigation-only fallback used when `published_pages()` cannot be
read at all. It contains no business detail and no policy text. Any other file
that re-types `/legal/...` is limited to the legacy redirects, the legal document
registry and cache invalidation, and `tests/public-information.test.ts` fails if a
new one appears.

### Permission

The module is guarded by `content.manage` in `lib/permissions/permissions.ts`,
held by **`super_admin` only** (plain `admin`, `staff`, `salesman`, `retailer` and
`seller` return `false`; `tests/site-content-footer-nav.test.ts` asserts it). The
permission is also listed in the `/api/mobile/v1/session` capability list, so the
Android app can hide the entry point — the server still enforces
`requireSuperAdmin()` and RLS on every call.

There is no operator notice anywhere on the public site. The old
*"Publication review required"* banner is gone, and the internal notes and open
owner decisions live in `site_page_admin_notes`, which has **no** anonymous or
non-super-admin grant at all — they cannot be read through the Data API even by
a signed-in customer, let alone rendered by a public component.

## 3. Security model (migration 0104)

| Concern | Control |
| --- | --- |
| Who may write | `public.is_super_admin()` in every RLS write policy. A plain `admin` can read published content and nothing more. |
| What the public may read | `public.published_page(slug)` / `public.published_pages()` — SECURITY DEFINER, granted to `anon`, returning the snapshot only. |
| Draft isolation | `published_snapshot` is written only by `publish_site_page()`. |
| Internal notes | Separate table. `anon` has no grant; `authenticated` has a super-admin-only policy. No column of it is reachable from a public function. |
| History | Append-only. Inserted by a `SECURITY DEFINER` trigger; no API role holds INSERT/UPDATE/DELETE. |
| Required pages | `is_system` pages cannot be deleted and their slug cannot change (a trigger raises); their content is fully editable. |
| Incomplete publish | Table-level check constraint + `publish_site_page()` refusals: no introduction, no effective date or no visible section cannot be published. |
| Legal versions | Publishing a legal page calls `publish_legal_document_version()` (0098), so the acceptance registry moves with the page in one transaction. |
| Link safety | Editor input is plain text plus `[label](/path)`. Destinations must match `isSafePublicLink` (`/path`, `https`, `mailto:`, `tel:`); anything else stays visible as text. No HTML path exists. |
| Audit | Create, delete, publish and unpublish write a `super_admin_audit_logs` row. |

## 4. Migrations

* **0104** — schema, RLS, triggers, public read functions, publish/unpublish.
  Rollback: `supabase/rollbacks/0104_site_content_management.down.sql` (refuses to
  destroy content unless `maharani.allow_data_loss = 'true'`).
* **0105** — seeds the wording that was already published (generated by
  `scripts/generate-site-content-seed.mjs`, reviewed in
  `content/site-pages.seed.json`), publishes it, and moves the operator notices
  into the internal notes. Idempotent: an existing slug is never overwritten. It
  inserts **no approval** — every page is `owner_review_pending`.

Neither migration has been applied to any live Supabase project. The migration
number `0103` is deliberately skipped here: it is claimed by open PR #127, and
both migrations are additive and independent.

## 5. Android

`GET /api/mobile/v1/pages` and `GET /api/mobile/v1/pages/{slug}` expose the same
published snapshots with camelCase fields. They are public (the Terms and the
grievance route must be readable before sign-in), rate limited on the shared
`read.catalog` budget, and read through the anonymous client, so a draft is
unreachable. An unpublished page answers `404 not_found` with
`details.reason = "unpublished"`; the app is expected to show the same clean
message as the website.

**Status:** the endpoints and their contract are implemented and tested on the web
side. Native screens for About/legal pages are **not implemented** — see the
final report.

## 6. Operator notes

1. **Owner review is still required.** Seeded pages are engineering wording the
   owner has not approved; the editor shows this as *Owner review pending* and the
   open decisions are listed in the internal notes. Do not set a page to
   *owner approved* or *legal review recorded* unless that review happened.
2. **Bumping a policy version** (e.g. Terms 1.0 → 1.1) updates
   `legal_document_current_versions`, so users are asked to accept 1.1. For the
   **Seller Agreement** specifically, `lib/legal/documents.ts` must be updated in
   the same release: the seller-offer gate compares the database version with the
   build's registry and fails **closed** until they match.
3. **Contact details appear twice** by design: as published page text (what a
   customer reads) and in `platform_settings.contact_grievance` (what launch
   readiness verifies). Change both, or the internal warning in `/admin/content`
   will keep saying they are unconfirmed.
4. **Regenerating the seed** is only for review: `node --experimental-strip-types
   scripts/generate-site-content-seed.mjs`. It never writes to a database.
5. **A failed editor read fails loudly.** If the editor or the page list cannot
   be read (RLS denial, schema drift, timeout), the screen shows the admin error
   boundary with a retry instead of an empty page, "no review recorded" or
   "nothing has been published yet". Saving over that blank state is what would
   destroy real content, so the loaders throw (`throwIfReadFailed`, migration
   0104) and only a genuinely missing page id becomes a 404.
