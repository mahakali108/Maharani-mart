# Website content module — security review (2026-11-15)

Scope: migrations `0104_site_content_management.sql` / `0105_seed_site_content.sql`,
`lib/site-content/*`, `app/admin/content/**`, `lib/admin/site-content-actions.ts`,
`app/api/mobile/v1/pages/**`, the public `/about`, `/contact`, `/legal`,
`/legal/[slug]` routes and the Android screens added on this branch.

This review is **read-only**: nothing in it has been applied to a live database or
deployed. It records what the code *would* do, the threats it was checked
against, and what remains for the owner.

---

## 1. Data exposure — drafts must not be readable

The first version of `0104` granted `anon` and `authenticated` `SELECT` on
`site_pages` and `site_page_sections` and filtered with a row-level policy
(`status = 'published'`). **A policy filters rows, not columns**, so any anonymous
caller holding the publishable key could read `title_draft`, `body_draft`,
`internal_notes`, `seo_*` and `owner_review_*` of a published page, and every
section row of it — including sections hidden from the live page.

Fixed in `dc6033c`:

| Object | anon | authenticated | service_role |
| --- | --- | --- | --- |
| `site_pages` | **no privilege** (revoked) | none (RLS: super admin only) | full |
| `site_page_sections` | **no privilege** (revoked) | none (RLS: super admin only) | full |
| `site_page_admin_notes` | no privilege | none (RLS: super admin only) | full |
| `site_page_revisions` | no privilege | `SELECT` only, super admin | full |
| `published_page(text)` | `EXECUTE` | `EXECUTE` | `EXECUTE` |
| `published_pages()` | `EXECUTE` | `EXECUTE` | `EXECUTE` |
| `site_page_snapshot(uuid)` | none | none | none |

`published_page()` / `published_pages()` are `SECURITY DEFINER` with
`search_path = public, pg_temp`, and return a JSON document assembled from the
**published snapshot** columns only — never a draft column, never an internal
note, never a review decision.

Regression coverage: `tests/site-content-db.test.ts`
* *"no API role can read a draft column of a published page"* — anon gets
  `permission denied`; a signed-in retailer gets `0` rows on both tables; the
  published document contains neither the draft sentence nor a hidden section
  body;
* *"an admin can read published pages"* — a plain admin gets `0` rows from
  `site_pages` and can only read through `published_page()` / `published_pages()`;
* the unpublish test now expects `permission denied` rather than `0` rows.

**Rule for future work:** never re-add an `anon` `SELECT` grant on
`site_pages`, `site_page_sections`, `site_page_admin_notes` or
`site_page_revisions`. The public surface is the two functions.

## 2. Authorisation of writes

* Every admin mutation is a Server Action in `lib/admin/site-content-actions.ts`
  that starts with `requireSuperAdmin()`. Verified by
  `tests/site-content-admin.test.ts` (18 tests), including the "plain admin
  cannot write" and "unauthenticated cannot write" paths.
* The database does not trust the app: `INSERT`/`UPDATE`/`DELETE` policies on all
  four tables call `public.is_super_admin()`, and `is_super_admin()` is pinned to
  `search_path = public, pg_temp` so a shadowing function cannot be planted.
* Publish/unpublish are `SECURITY DEFINER` RPCs, not direct updates, so the
  invariant checks (`title`, at least one visible section, version, effective
  date) cannot be bypassed by a hand-written `UPDATE`.
* No new role, no new permission key beyond `content.manage`; the matrix in
  `docs/role_permission_matrix.md` is updated.

## 3. Untrusted input

* Page text is plain text with a small structure (heading, paragraphs, bullets,
  one link). There is **no HTML anywhere** in the pipeline: the database stores
  text, the route serialises text, the web component renders text, the Android
  screen renders `Text`. There is no sanitiser to get wrong and no
  `dangerouslySetInnerHTML` in the module.
* Links are validated at the database (`link_label`/`link_href` must be filled
  together, href must be `http(s)`, `mailto:`, `tel:` or an on-site `/path`) and
  again on the client: the web footer only renders a link for those schemes, and
  `openLink()` in Android opens an on-site path inside the app and hands only
  `https`/`mailto`/`tel` to the platform. An unknown scheme becomes plain text.
* Slugs are constrained by `site_pages_slug_format`
  (`^[a-z][a-z0-9]*(-[a-z0-9]+)*$`) in the database, re-checked in the mobile
  route before the RPC, and re-checked in the app before the network call, so a
  slug can never become a second path segment or an injection point.
* Admin form input is validated by `lib/site-content/schema.ts` (zod) on both the
  server action and the form.

## 4. Mobile API surface

* Both pages endpoints are public — deliberately: the Terms, Privacy Policy and
  grievance route must be readable before sign-in, as on the website.
* They are rate-limited through the shared `read.catalog` bucket and go through
  `createMobileAnonClient()`, which holds only the publishable key; no service
  role key is reachable from a request path.
* They answer only from `published_pages()` / `published_page()`. An unpublished
  page answers `404 not_found` with `details.reason = "unpublished"` — the same
  shape as a page that does not exist, so a caller cannot enumerate drafts.
* Error paths log the database message server-side and return a generic
  `database_unavailable` to the caller; no SQL text reaches a client.
* Verified by `tests/mobile-pages-api.test.ts` (8 tests) and
  `tests/api-privilege-hardening.test.ts` (25 tests).

## 5. Caching and privacy

* Both mobile routes are `force-dynamic` and read through the anonymous client:
  no user-specific response is cached, and no response depends on a cookie.
* The public pages are `revalidate`d content, not user data. A page's
  `published_at`/`version` change is what refreshes it.
* Nothing in the module logs a user id, a phone number or an address. The
  business-details block that appears on the public pages is the shop's own
  published identity (name, address, phone, email) — the owner's decision, not a
  leak.

## 6. Threats checked and dismissed

| Threat | Result |
| --- | --- |
| Anonymous read of a draft or an internal note | Blocked by the revoke + function-only surface (§1) |
| Authenticated retailer reading unpublished pages | Blocked: 0 rows, `404` on the API |
| Plain admin editing content | Blocked in the action and in RLS |
| Publishing without an effective date or a title | Blocked by the publish RPC's checks |
| Stored XSS through page text | Not possible: no HTML is ever rendered |
| `javascript:` / `data:` link | Refused at the database and on both clients |
| Slug traversal (`../`, `%2F`) | Refused by the slug regex at three layers |
| Secret leakage from the seed | The seed contains only the owner's public business details, taken from the live site |
| Migration ordering / partial apply | Documented in `docs/0104_0105_MIGRATION_AUDIT.md` (R3, R5, R6) |

## 7. Open items for the owner

1. **R2 — legal registry (RESOLVED, now a choice).** Publishing a page no longer
   registers it: `publish_site_page()` takes `p_register_acceptance` (default
   `false`) and the registry still holds only `seller-agreement`. Whether
   `terms`/`privacy`/`retailer-terms`/`prohibited-products` should be version-enforced
   is the owner's decision, with the rationale and three options in
   `docs/PR134_FINAL_REVIEW_2026-11-15.md` §5.
2. **R4 — immediate publication (RESOLVED).** `0105` now seeds 19 **drafts** and
   publishes nothing, with no backdated timestamp anywhere. Publication is two
   owner-run stages in `supabase/publication/`: stage 1 (nine pages whose wording is
   already live) must run **before** the deploy; stage 2 (ten new pages) waits for
   owner and legal approval.
3. **R8 — wording.** Every seeded page carries
   `review_status = 'owner_review_pending'`. The text is the wording already live
   on the site or engineering-standard legal boilerplate; the owner, the CA and
   the advocate must approve it before anyone relies on it, and the grievance
   officer's details must be confirmed.
4. **Apply channel.** `0104` is not transactional in the Supabase SQL editor. Use
   the CLI (or run the file in one transaction) so a failure cannot leave half the
   policies in place — see the audit's apply order.
5. Android screens ship without a signed release keystore, so they are verifiable
   only as a debug APK until the owner provides the keystore and CI secrets.
