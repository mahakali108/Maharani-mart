# Banner `alt_text` — proposal (draft, not implemented)

**Status: reviewable draft only.** No column, type, action or component has
been changed. Implementation stays blocked until the owner approves and the
open-PR conflict on the storefront components is resolved.

---

## 1. Problem

`PromoBanner` renders `alt={title}` (`components/retailer/promo-banner.tsx`).
That is acceptable only when the title describes the image. Campaign titles such
as "Diwali Offer" or "Flat 12%" name the promotion, not the picture, so a screen
reader announces a heading twice and conveys nothing about the artwork.

Part 4.4 of the brief asks for "Title and accessible alternative text" as
separate concepts. Today there is no way to supply the second.

## 2. Proposed schema (draft)

Would become `supabase/migrations/0076_banner_alt_text.sql`.

```sql
alter table public.banners
  add column if not exists alt_text text;

comment on column public.banners.alt_text is
  'Accessible name for the banner artwork. NULL falls back to title.';

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.banners'::regclass
       and conname = 'banners_alt_text_length_check'
  ) then
    alter table public.banners
      add constraint banners_alt_text_length_check
      check (alt_text is null or char_length(btrim(alt_text)) between 2 and 160);
  end if;
end;
$$;
```

Design notes:

- **Nullable, never `NOT NULL`.** Existing rows have no alt text; requiring one
  would block every banner edit until an operator rewrites copy.
- **Fallback is `alt_text ?? title`.** A banner can never end up with an empty
  `alt` while carrying a promotional image.
- **No default.** A generated default ("Banner") would be worse than the title.
- **Constraint length** matches the 140-character title cap plus headroom, and
  rejects whitespace-only values.
- Rollback: `drop column if exists alt_text` (drops the constraint with it —
  the rollback file should drop the constraint explicitly first for clarity).

## 3. Touch points

| File | Change | Contested? |
| --- | --- | --- |
| `supabase/migrations/0076_banner_alt_text.sql` | new | no |
| `supabase/rollbacks/0076_banner_alt_text.sql` | new | no |
| `types/database.types.ts` | `alt_text: string \| null` on Row/Insert | no |
| `lib/admin/banners-actions.ts` | parse + persist `altText`, trim, fall back to `null` | no |
| `components/admin/banner-form.tsx` | "Alternative text" field with guidance | no |
| `components/admin/banner-edit-form.tsx` | same | no |
| `components/admin/banner-preview.tsx` | pass the value through | no |
| `app/admin/banners/page.tsx` | optional column/indicator | no |
| `components/retailer/promo-banner.tsx` | accept `altText`, use `altText ?? title` | **yes — #42, #66** |
| `components/retailer/promo-carousel.tsx` | pass `alt_text` through | **yes — #42, #66** |
| `tests/banners.test.tsx` | assert fallback and override | no |
| `tests/banner-alt-text-db.test.ts` | new PGlite case for the constraint | no |

## 4. Gating

Phase 1 (Option C) froze further edits to `promo-banner.tsx` and
`promo-carousel.tsx`. That splits this work:

- **Unblocked now** (if approved): migration, types, action, admin forms,
  preview, admin list, DB test. None of these files is owned by #42/#66.
- **Blocked**: the actual storefront rendering change. Until the PR conflict is
  resolved, a stored `alt_text` would be inert — worse than not shipping it,
  because an operator could set a value and see no effect.

**Recommendation:** do not start the unblocked half either, until the storefront
half can land with it. A column that nothing reads is dead weight and invites
someone to "finish" it with an ad-hoc edit to a contested file.

## 5. Mobile API — deliberately unchanged

`PromoBannerDto` in the native app is locked field-for-field against
`lib/mobile/catalog.ts` by `tests/mobile-catalog-api.test.ts`, which parses the
Kotlin DTO. Adding `altText` to the mobile payload would require editing Kotlin
(`android/…/PromoBannerDto.kt`) and its test.

The brief excludes native work, so the mobile DTO stays as-is and the app keeps
using `title` as its accessible name. That is a **known, accepted limitation**,
not an oversight; it disappears if the native app is ever brought back into
scope.

## 6. Accessibility guidance for admins (proposed copy)

> Describe what the picture shows, not the offer. "Two Gold-plan cartons beside
> a berry gift box" helps; "Diwali Offer" does not. Leave empty to reuse the
> title.

## 7. Decisions needed

1. Approve the column and the `alt_text ?? title` fallback.
2. Approve that the mobile DTO stays unchanged in this phase.
3. Decide whether the admin list needs an "alt text missing" indicator.
