# Unpublished banner artwork — implementation notes

Status: **review-only pull request.** Nothing in this document has been applied
to Supabase, deployed, or run against production. Migration `0077` has never
been executed against any project.

This is the implementation companion to `docs/BANNER_ARTWORK_PRIVACY_PLAN.md`
(the approved plan). Where the plan describes intent, this file describes what
the code now does — including what it deliberately does **not** do.

---

## 1. What changed

| Area | File | Change |
| --- | --- | --- |
| Storage bucket | `supabase/migrations/0077_banner_draft_artwork.sql` | New **private** `banner-drafts` bucket (5 MB, png/jpeg/webp) + four admin-only policies |
| Schema | same | Nullable `banners.draft_image_path`, `banners.draft_image_mobile_path` + CHECK constraints |
| Rollback | `supabase/rollbacks/0077_banner_draft_artwork.sql` | Intentional no-op (see §6) |
| Media kinds | `lib/media/types.ts` | `banner-draft` kind → private bucket, same folder convention as `banner` |
| Permissions | `lib/media/access.ts` | `banner-draft` requires `banners.manage`; added to `DRAFT_ALLOWED` |
| Path validation | `lib/media/refs.ts` | `DRAFT_BANNER_PATH_RE`, `isDraftBannerPath()`, `draftBannerOwner()`, `isSignedStorageUrl()`, `isSafeObjectPath()` |
| Delete routing | `lib/media/index.ts` | Explicit bucket allowlist; `bucket` option for bare object paths; legacy default preserved |
| Signed URLs | `lib/storage/signed-url.ts` | `banner-drafts` added to `PrivateBucket`; 15-minute preview TTL |
| Copy-on-publish | `lib/admin/banner-artwork.ts` | New. Promotion state machine + compensation |
| Retention | `lib/retention/storage-cleanup.ts` | `banner-drafts` classified `permanent` (never auto-deleted) |
| Tests | `tests/banner-draft-paths.test.ts`, `tests/banner-artwork-promotion.test.ts`, `tests/banner-draft-db.test.ts`, plus `tests/media-bucket.test.ts` and `tests/storage-retention.test.ts` | See §7 |

Not changed: the public `banners` bucket, its four storage policies, every
existing object and every published URL. No row was migrated, so the
storefront, admin banner list and mobile home payload behave identically.

## 2. Path convention

```
banners/{bannerId | _draft}/{lower-case uuid}.{jpg|png|webp}
```

`_draft` is used when artwork is uploaded before the banner row exists. This is
the existing `MEDIA_KIND_CONFIG.banner.folder()` convention, reused unchanged
so nothing about public banner objects moves.

Enforced in two places that must stay in sync:

* `DRAFT_BANNER_PATH_RE` (`lib/media/refs.ts`) — TypeScript, used before any
  upload or delete;
* `banners_draft_image_path_check` / `…_mobile_path_check` (`0077`) — the SQL
  twin, plus the rule that segment 2 must be `_draft` or **this row's own id**.

Both are case-sensitive because Storage object paths are case-sensitive. Both
reject absolute URLs, signed URLs, traversal, extra path segments, and any
extension other than jpg/png/webp.

## 3. Copy-on-publish

`promoteDraftArtwork(input, storage)` in `lib/admin/banner-artwork.ts`.

Ordering is **copy first, then persist**:

* copy succeeds → DB write fails ⇒ artwork exists but no row points at it.
  Invisible to retailers. Recoverable.
* persist first → copy fails ⇒ a published row would reference a missing
  object. Never allowed.

Destination is **deterministic**: same object name, bucket changes from
`banner-drafts` to `banners`. A retry therefore targets the same path, so a
crashed publish converges rather than duplicating.

| Situation | Behaviour |
| --- | --- |
| No draft, banner already has artwork | Keep existing URLs, copy nothing |
| No draft, banner has no artwork at all | Refuse (`NO_ARTWORK`) |
| One or both drafts present | Copy each, return public URLs |
| Draft path malformed / is a URL | Refuse (`INVALID_DRAFT_PATH`), copy nothing |
| Draft object missing from the private bucket | Refuse (`SOURCE_MISSING`) |
| Copy fails, destination absent | Refuse (`COPY_FAILED`) |
| Copy fails, destination exists and matches source size+MIME | Adopt it, treat as success |
| Copy fails, destination exists but differs | Refuse (`DESTINATION_CONFLICT`), touch nothing |
| Copy fails, destination cannot be listed | Refuse (`COPY_FAILED`) — fail closed |
| Mobile copy fails after desktop succeeded | Refuse, report the desktop object so the caller compensates |
| Publish retried after success | Adopts the identical object; idempotent |

**A failed copy is never taken as proof that the destination is ours.** The
pinned `@supabase/storage-js@2.110.7` `copy()` has no upsert/overwrite option,
so a duplicate error is ambiguous — it may mean "our earlier attempt already
copied it" or "someone else's object occupies this path". The code verifies
size **and** MIME type before adopting, and refuses on any mismatch.

Compensation (`releasePromotedArtwork`) removes only objects **this attempt
created**, and only when a `verifyUnreferenced` callback confirms no banner row
references the path. Without that callback it deletes nothing and reports the
objects as skipped. This is what protects a concurrent publish: the losing
request must not delete an object the winning request has just adopted.

### Call-site contract (not wired in this PR)

The publish action that will use this module must:

1. copy, then `update banners set … where id = $1 and status = 'draft'`
   (the `status = 'draft'` guard makes double-publish a no-op);
2. on a DB failure or a zero-row update, call `releasePromotedArtwork` with a
   `verifyUnreferenced` query and log the report — never delete on a guess;
3. clear `draft_image_path` / `draft_image_mobile_path` only **after** a
   successful update;
4. delete the old public object (if replaced) only **after** the update
   commits.

No publish action is changed here because the banner admin components belong
to PRs #42/#45/#66 and remain frozen (Option C). This module is the piece
those PRs can adopt.

## 4. `deleteMedia()` bucket routing

Previously a bare object path was always deleted from `retailer-documents`.
That is correct for the only caller that stores bare paths
(`retailer_documents.file_url`) but silently wrong for anything else — a
`banner-drafts` path would have been deleted from the wrong bucket.

Now:

* every bucket must appear in `DELETABLE_BUCKETS`, or nothing happens;
* every object path passes `isSafeObjectPath()`;
* `deleteMedia(ref, { bucket })` selects the bucket for a bare path;
* **omitting `bucket` keeps `retailer-documents`**, so all existing callers are
  byte-for-byte unaffected.

Unchanged contract: `deleteMedia()` is best effort, never throws, and never
aborts the caller's database change.

## 5. Privacy limits — read before believing this is "private"

These are real and must not be papered over:

1. **Unpublishing does not restore privacy.** Once artwork has been copied to
   the public `banners` bucket its URL is public permanently; setting
   `status = 'draft'` hides the banner but not the file. Removing the object is
   a separate, manual, deliberate step.
2. **Scheduled artwork can leak early.** There is no scheduler: `status =
   'published'` with a future `starts_at` still exposes the artwork to anyone
   who reads the public URL. Do not treat `starts_at` as a privacy control.
3. **Existing draft rows are already public.** Any banner created before this
   change whose `image_url` points into the public bucket stays public. This
   PR migrates no rows and moves no objects.
4. **Deleting a draft object is never automatic**, including on rollback.
5. **The migration is unapplied.** Until an operator applies `0077` — with the
   target project named explicitly — the bucket does not exist and
   `banner-drafts` uploads will fail closed.

## 6. Rollback

`supabase/rollbacks/0077_banner_draft_artwork.sql` issues a `raise notice` and
nothing else. It does **not** drop the bucket, the policies or the columns, and
it deletes no object.

Reason: dropping `draft_image_path` discards the only mapping from a banner row
to its draft object. The artwork would still exist in Storage with nothing
pointing at it. Both columns are nullable and unreferenced once the application
stops reading them, so leaving them in place is harmless; deleting the mapping
is not recoverable.

A complete removal is a separate, manually approved procedure: export the
paths → download or re-attach objects → then delete objects, policies, bucket
and columns, in that order. It destroys data and must never be automated as
part of a rollback.

## 7. Storage growth trade-off

Draft artwork is never deleted automatically, by owner decision. Consequences:

* every replaced draft image stays in `banner-drafts` forever;
* the bucket grows monotonically, at roughly the size of one banner image per
  upload/replace;
* nothing will reclaim it without an explicit human decision.

That is the accepted cost of never losing unpublished work. `0077`'s bucket is
capped at 5 MB per object, and the table above is the only place growth can
appear.

**Proposed manual cleanup (not implemented, needs separate approval):**

1. list `banner-drafts` objects and join each path against
   `banners.draft_image_path` / `draft_image_mobile_path`;
2. an object is *candidate* only if no row references it **and** it is older
   than a chosen age (e.g. 180 days);
3. an object that *is* referenced is never a candidate, regardless of age;
4. export the candidate list, get written owner approval, then delete in
   batches — with a dry-run count first;
5. never touch the public `banners` bucket in the same operation.

Until that is approved and run, the correct expectation is: the bucket only
grows.

## 8. Signed URLs

`lib/storage/signed-url.ts` gains `banner-drafts` in the closed `PrivateBucket`
union and `BANNER_DRAFT_PREVIEW_TTL_SECONDS = 900`.

Signed URLs are bearer credentials:

* minted per render, server-side, with the caller's RLS-scoped client — never
  the service-role key;
* passed straight to the component and never written to a column, a log line,
  analytics, or cached HTML;
* `/storage/v1/object/sign/**` is outside the `next/image` remote-pattern
  allowlist, so admin previews must render `unoptimized` (or plain `<img>`).

No preview UI ships in this PR.

## 9. Tests

| File | Covers |
| --- | --- |
| `tests/banner-draft-paths.test.ts` | Regex accepts exactly `buildMediaPath()` output; rejects URLs, signed URLs, traversal, other buckets, svg, mixed case; `isSafeObjectPath` |
| `tests/banner-artwork-promotion.test.ts` | Every row of the §3 table, using an injected fake storage: happy path, mobile pairing, invalid path, missing source, verified adopt, size/MIME conflict, unverifiable destination, retry convergence, compensation with/without verification, verification errors |
| `tests/banner-draft-db.test.ts` | PGlite: bucket is private/5 MB/image-only; public `banners` bucket unchanged; exactly four admin-only policies; re-runnable migration; CHECKs reject URLs, foreign banner ids, traversal, svg, mixed case; cross-check against the TypeScript regex; RLS hides draft objects from retailer/anon; rollback keeps everything and contains no destructive statement |
| `tests/media-bucket.test.ts` | Every `MEDIA_KIND_CONFIG` bucket is created by a scanned migration (extended with `0077`) |
| `tests/storage-retention.test.ts` | `banner-drafts` classifies as `permanent` |

PGlite is a single connection. It proves constraints and policies, not
concurrent interleaving; the concurrency guarantee is also asserted
structurally (the `status = 'draft'` guard and `verifyUnreferenced`).

## 10. Applied-state checklist (for whoever deploys this)

Nothing below has been done:

- [ ] Confirm the target Supabase project id, in writing.
- [ ] Apply `0077_banner_draft_artwork.sql` and verify the bucket is `public = false`.
- [ ] Verify all four policies exist and that a retailer cannot read a draft object.
- [ ] Upload one draft object as admin; confirm anon GET on the public URL 404s.
- [ ] Confirm the public `banners` bucket still serves existing URLs unchanged.
- [ ] Only then wire the upload/publish actions to this module.

If the bucket already exists with `public = true`, `0077` raises an exception
and changes nothing. That is intended: changing visibility under live objects
is an operator decision.
