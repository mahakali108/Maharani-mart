# Banner artwork privacy — architecture and migration plan

**Status: proposal only. No bucket, policy, column or file has been changed.**
Nothing here is applied to any environment. Per the owner's decision, draft
artwork should eventually live in private storage with signed URLs, but the
bucket visibility and storage policies are untouched until this plan is
approved.

Decision in force: *"Prefer private storage with signed URLs for unpublished
artwork, subject to an architecture and migration impact review."*

---

## 1. What exists today (verified)

| Item | Finding | Source |
| --- | --- | --- |
| Bucket | `banners` is created **public** (`public = true`) | `supabase/migrations/0003_storage_buckets.sql:11` |
| Read policy | `public_read_banners` — any caller, including `anon`, may `SELECT` every object in the bucket | `0003_storage_buckets.sql:20-21` |
| Write policies | insert/update `is_staff_or_above()`; delete `is_admin_or_above()` | `0003_storage_buckets.sql:35-40` |
| Stored value | `banners.image_url` holds a **full public URL** (`…/storage/v1/object/public/banners/…`); 0074 adds the same shape for `image_url_mobile` | `lib/media/supabase.ts` |
| Upload path | `banners/{bannerId or _draft}/{uuid}.{ext}`; `banner` is the only kind allowed to upload before its row exists | `lib/media/paths.ts`, `lib/media/access.ts` (`DRAFT_ALLOWED`) |
| Resolution | `resolveMediaUrl()` returns a URL only for a **public** URL or an external URL; a bare object path resolves to `null` | `lib/media/refs.ts` |
| Image optimisation | Only `…/object/public/…` is optimised; anything else is rendered `unoptimized` | `components/media/stored-image.tsx` |
| Next.js allowlist | `remotePatterns` permits `*.supabase.co` **`/storage/v1/object/public/**` only** | `next.config.mjs` |
| Mobile API | `toMobileBanners()` maps `imageUrl: resolveMediaUrl(row.image_url)` — a bare path becomes `null` | `lib/mobile/catalog.ts:382` |
| Signed-URL helper | `getSignedUrl(bucket, path, ttl, client?)` exists for a **closed union** of four private buckets | `lib/storage/signed-url.ts` |
| Delete helper | `deleteMedia()` maps any bare object path to **`retailer-documents`**, unconditionally | `lib/media/index.ts:81-92` |

### Consequences

1. **Draft artwork is unlisted, not protected.** Object names are UUIDs, so a
   draft image is not discoverable by guessing, but anyone holding the URL —
   a shared link, a browser cache, a forwarded admin preview — can read it
   without authentication, forever. Setting `status = 'draft'` hides the row,
   not the file. This is finding F3 in the 0074 review.
2. **A private bucket is not a configuration flip.** Because
   `resolveMediaUrl()` returns `null` for bare paths, moving banner objects to a
   private bucket without wiring signing would blank every banner in the
   storefront, the admin list and the mobile home payload.
3. **`deleteMedia()` would delete from the wrong bucket.** Today it is correct
   only because `retailer-documents` is the sole bucket that stores bare paths.
   The moment banner paths are stored bare, `deleteBannerAction()` would call
   `remove()` on `retailer-documents` with a `banners/...` path. It would fail
   harmlessly (object not found) but would silently leak the real object.

## 2. Options

### Option A — additive private bucket, promote on publish (recommended)

Keep the public `banners` bucket exactly as it is. Add a **new private bucket**
`banner-drafts` used only while a banner is a draft.

- Admin uploads draft artwork into `banner-drafts`; the row stores the **object
  path** in new columns.
- Admin preview signs the path server-side with the existing `getSignedUrl()`
  using the admin's own cookie session, so storage RLS still applies.
- On **publish**, the server copies the object into the public `banners` bucket
  and writes the resulting public URL into `image_url` / `image_url_mobile`,
  then deletes the draft object.
- On **unpublish**, the public artwork stays (already public); only the row's
  status changes.

**Why:** zero change for published banners, every existing row keeps working,
the storefront and mobile code paths are untouched, and the public bucket's
policies stay as they are.

**Cost:** two new nullable columns, one new bucket with three policies, a
promote step in the publish action, and a bucket-aware delete fix.

### Option B — make the existing `banners` bucket private

Highest blast radius, not recommended:

- every stored `image_url` becomes unreadable and would need rewriting;
- `resolveMediaUrl()`, `toMobileBanners()`, the admin list thumbnails and the
  client-side preview all need signing;
- signed URLs expire, so any cached HTML, CDN entry or previously shared link
  breaks;
- `next.config.mjs` would need a `…/object/sign/**` rule (and signing defeats
  the Next image optimiser anyway);
- the mobile API would have to mint signed URLs per request, coupling banner
  delivery to session lifetime.

### Option C — never store draft artwork publicly

Admin uploads draft art to the (still public) bucket only at publish time; the
draft form previews a local `blob:` object. Zero schema change.

**Why not:** the uploaded artwork is lost on navigation, drafts cannot be
reviewed later, and `blob:` values are explicitly rejected by
`parseMediaRef()` — so it also needs UI work to avoid persisting a temporary
URL.

**Recommendation: Option A**, with Option C as the zero-migration fallback if a
new bucket is not wanted.

## 3. Proposed schema (draft — do not apply)

Would become `supabase/migrations/0077_banner_draft_artwork.sql` (0075 is
reserved for retention, 0076 for `alt_text`).

```sql
-- New private bucket for unpublished banner artwork only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('banner-drafts', 'banner-drafts', false, 5242880,
        array['image/png','image/jpeg','image/webp'])
on conflict (id) do nothing;

-- Admin-only read/write; never public, never deletable by staff.
create policy "admin_read_banner_drafts" on storage.objects
  for select using (bucket_id = 'banner-drafts' and is_admin_or_above());
create policy "admin_write_banner_drafts" on storage.objects
  for insert with check (bucket_id = 'banner-drafts' and is_admin_or_above());
create policy "admin_update_banner_drafts" on storage.objects
  for update using (bucket_id = 'banner-drafts' and is_admin_or_above());
create policy "admin_delete_banner_drafts" on storage.objects
  for delete using (bucket_id = 'banner-drafts' and is_admin_or_above());

alter table public.banners
  add column if not exists draft_image_path text,
  add column if not exists draft_image_mobile_path text;

comment on column public.banners.draft_image_path is
  'Object path in the private banner-drafts bucket. Promoted to image_url on publish.';
```

Open question for approval: should promotion **copy** or **move**? `storage-js`
v2 (pinned `@supabase/supabase-js ^2.45.4`) is expected to support
`copy(from, to, { destinationBucket })`; that must be verified against the
pinned version before implementation. The fallback is a server-side
download + re-upload, which is slower but has no version dependency.

## 4. Backward compatibility

| Concern | Behaviour |
| --- | --- |
| Existing banners | `draft_image_path` is `NULL`; nothing reads it, so rendering is byte-identical. |
| Published artwork | Stays in the public `banners` bucket at its current URL. No rewrite, no re-upload, no 404. |
| Storefront / mobile | Untouched. Both keep resolving `image_url` as a public URL. |
| Admin list thumbnails | Unchanged for published rows; draft rows show a signed URL instead. |
| `deleteBannerAction` | Must handle both shapes: public URL (existing path) and draft path (new bucket). Requires the `deleteMedia()` fix below. |
| Rollback | Drop the two columns and the bucket. Published data is unaffected; unpublished draft artwork is deleted with the bucket — acceptable only if the owner confirms drafts may be discarded, otherwise the bucket must be emptied manually first. |

### Required defect fix in the same change

`deleteMedia()` currently hardcodes `retailer-documents` for every bare object
path (`lib/media/index.ts:88-90`). Any bare banner path would be routed to the
wrong bucket. Fix options:

- add an optional explicit `bucket` argument, e.g.
  `deleteMedia(ref, { bucket: 'banner-drafts' })`, or
- introduce a scheme-qualified ref such as `sb://banner-drafts/banners/…/x.webp`
  so a stored value is self-describing.

The scheme-qualified ref is more robust long-term but changes stored-value
parsing, which four buckets currently depend on. **Recommendation:** the explicit
`bucket` argument for this change, with the scheme ref considered separately.

## 5. Implementation sequence (if approved)

1. Migration `0077` + rollback, reviewed like 0074.
2. `lib/media`: add a `banner-draft` kind (bucket `banner-drafts`, private),
   extend `PrivateBucket` in `lib/storage/signed-url.ts`, fix `deleteMedia()`.
3. `lib/admin/banners-actions.ts`: draft upload, signed preview, promote on
   publish, delete both shapes.
4. Admin forms/preview: accept a signed `previewUrl` prop instead of assuming a
   public URL.
5. Tests: a PGlite case proving `anon` cannot read `banner-drafts`; a unit case
   proving publish promotes the path and leaves `image_url` public.
6. Docs: `docs/storage-buckets.md` gains the bucket row.

## 6. Decisions needed

1. Approve Option A, Option B or Option C.
2. Confirm draft artwork may be discarded on rollback.
3. Copy-vs-move on publish (pending pinned-version verification).
4. Whether already-uploaded draft objects currently sitting in the public
   bucket should be purged. **This is a production data deletion and would need
   its own explicit approval**; it is not part of this plan.
