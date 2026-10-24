# Handoff to open-PR owners — fixes this branch must not apply

**Why this file exists.** The audit found the same defect on 26 detail pages: they
destructured `{ data }`, dropped `error`, and called `notFound()`, so a failed read
(schema drift `42703`, an RLS denial, a timeout) was reported to the user as
"this record no longer exists". Twenty-three of those pages were fixed on
`arena/b405a872-maharani-mart`.

The three below belong to **open pull requests** (#107 and #42) and that branch is
not allowed to edit them. The exact fix is specified here so their owners can apply
it. Until then the defect is **live on those three routes** and is listed in
`tests/detail-pages-read-failure.test.ts` as `PENDING HANDOFF` rather than silently
excluded.

Nothing here asks you to change business logic. Each hunk is: keep reading `error`,
throw on it, and only 404 when the read genuinely returned no row.

---

## 1. PR #107 — `app/retailer/orders/[id]/page.tsx` (not yet fixed upstream)

Current code (verified against `origin/pr107`):

```ts
  ]);

  if (!order) notFound();
```

Apply:

```diff
--- a/app/retailer/orders/[id]/page.tsx
+++ b/app/retailer/orders/[id]/page.tsx
@@
 import { createClient } from '@/lib/supabase/server';
+import { throwIfReadFailed } from '@/lib/supabase/read-guard';
 import { requireUser } from '@/lib/auth/session';
@@
   const [
-    { data: order },
+    { data: order, error: orderError },
     { data: itemData },
@@
   ]);
 
+  // A failed read is not a deleted order: surface it to the error boundary
+  // instead of telling the customer their order no longer exists.
+  throwIfReadFailed(orderError, 'Order');
   if (!order) notFound();
```

`lib/supabase/read-guard.ts` already exists on `main`'s tree via this branch; if
#107 merges first, inline it instead:

```ts
if (orderError) throw new Error(`Order could not be loaded [${orderError.code ?? 'unknown'}]: ${orderError.message}`);
```

## 2. PR #107 — `app/retailer/orders/[id]/invoice/page.tsx` (already fixed upstream)

Verified: `origin/pr107` already destructures `error: orderError` and throws before
`notFound()`. **No action needed** — the defect closes when #107 merges. Listed only
so the audit trail is complete.

## 3. PR #42 — `app/retailer/catalog/[id]/page.tsx` (not yet fixed upstream)

Verified against `origin/pr42`: three lookups can 404 on a failed read — the
product-id probe, the pack-id fallback, and the product row itself.

```diff
--- a/app/retailer/catalog/[id]/page.tsx
+++ b/app/retailer/catalog/[id]/page.tsx
@@
 import { createClient } from '@/lib/supabase/server';
+import { throwIfReadFailed } from '@/lib/supabase/read-guard';
@@
-    const { data: productRef } = await supabase
+    const { data: productRef, error: productRefError } = await supabase
       .from('products')
       .select('id')
       .eq('id', params.id)
       .eq('is_active', true)
       .maybeSingle<{ id: string }>();
+    throwIfReadFailed(productRefError, 'Product');
     if (productRef) {
       productId = productRef.id;
     } else {
-      const { data: packRef } = await supabase
+      const { data: packRef, error: packRefError } = await supabase
         .from('product_packs')
         .select('id, product_id')
         .eq('id', params.id)
         .maybeSingle<{ id: string; product_id: string }>();
+      throwIfReadFailed(packRefError, 'Pack');
       if (!packRef) notFound();
@@
-  const [{ data: product }, { data: packData }, favoriteIds, { data: cartData }] = await Promise.all([
+  const [{ data: product, error: productError }, { data: packData }, favoriteIds, { data: cartData }] = await Promise.all([
@@
-  if (!product) notFound();
+  throwIfReadFailed(productError, 'Product');
+  if (!product) notFound();
```

---

## Migration-number reservation for PR #107

`main` has `0059_supplier_applications.sql`; #107 adds a **second** `0059`
(`0059_india_compliance_safety.sql`). Two files cannot share a version number —
Supabase's history table is keyed by it.

**#107's owner must renumber to `0080` or higher**, after re-checking
`origin/main` and every open PR at the time of the change. As of this review:

* `main` tip contains migrations up to `0077` — no `0078`, `0079`, `0080`.
* This branch reserves **`0078`** (`0078_privilege_hardening.sql`) and
  **`0079`** (`0079_api_execute_hardening.sql`). Both are review-only and unapplied.
* `0061`, `0075`, `0076` are intentionally absent and must not be invented.
* 0075 is reserved for the on-hold retention archive; 0076 for the deferred
  `banners.alt_text`.

This branch did **not** renumber, move, or edit any #107 file.
