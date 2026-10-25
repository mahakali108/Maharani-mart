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

---

## PR #42 — three more retailer pages: same "failed read rendered as empty" defect

Found by a cross-check of this branch's diff against every open PR's file list
during the CI pass. This branch had edited these three files; **the edits were
reverted** and they are byte-identical to `origin/main` again (verified by
`git hash-object` against `git rev-parse origin/main:<path>`). The defect itself
is still present in PR #42's own versions, so the fix belongs to #42's owner.

Why #42's owner and not this branch: #42 rewrites all three files
(`notifications` −105 lines, `orders` 334 changed lines, `schemes` +21), so a
patch written against `main`'s text will not apply and a merge would conflict on
the exact lines involved.

### 1. `app/retailer/schemes/page.tsx`

PR #42's version, ~line 36: `const { data } = await supabase.from('schemes')…`,
then `const schemes = data ?? [];` and an empty state that says *"No active
schemes right now"*.

```diff
-  const { data } = await supabase
+  const { data, error } = await supabase
     .from('schemes')
     …
     .returns<SchemeRow[]>();
+  // A failed read must not claim there are no active schemes.
+  if (error) {
+    throw new Error(`Active schemes could not be loaded [${error.code ?? 'unknown'}]: ${error.message}`);
+  }
   const schemes = data ?? [];
```

Test to add (`tests/retailer-pages-read-failure.test.tsx`): render the page with
`supabaseFixture({ schemes: [] }, { schemes: 'timeout' })` and expect
`rejects.toThrow(/Active schemes could not be loaded/)`.

### 2. `app/retailer/notifications/page.tsx`

PR #42's version, ~line 19: `const { data } = await supabase.from('notifications')…`.

```diff
-  const { data } = await supabase
+  const { data, error } = await supabase
     .from('notifications')
     …
     .returns<NotificationRow[]>();
+  if (error) throw new Error(`Notifications could not be loaded [${error.code ?? 'unknown'}]: ${error.message}`);
```

### 3. `app/retailer/orders/page.tsx`

PR #42's version, ~line 98: `const { data, count } = await query;` followed by an
empty state that can read *"No orders yet"*.

```diff
-  const { data, count } = await query;
+  const { data, count, error } = await query;
+  // "No orders yet" is a statement about the retailer's purchase history; a
+  // failed read must reach error.tsx instead of inventing an empty history.
+  if (error) throw new Error(`Orders could not be loaded [${error.code ?? 'unknown'}]: ${error.message}`);
```

(`app/retailer/orders/page.tsx` is also in PR #107's file list — whoever merges
first should carry this hunk, and the second must not revert it.)

### For reference: where the guard lives in this branch

`lib/supabase/read-guard.ts` (`throwIfReadFailed`) and the shared
`components/ui/read-failure-notice.tsx` already exist, so #42 can use them
instead of writing a new error surface. Both are additive files; nothing in #42's
tree conflicts with them.
