# Open PR conflict report — #42, #45, #66

**Verified:** 2026-10-20 against `main` @ `1c7d6a1` (merge of PR #115).
**Owner decision in force:** all three PRs stay **open**. Their owners rebase
their own branches. Nothing here was merged, closed, rebased or pushed by this
session, and `main` was not modified.

This report exists so the PR owners and the owner can coordinate. It is not an
instruction to any automation.

---

## 1. Current state

| PR | Branch | Files | Diff | GitHub mergeable | Last updated |
| --- | --- | --- | --- | --- | --- |
| #42 | `arena/01a07a86-maharani-mart` | 27 | +1518 / −559 | `CONFLICTING` / `DIRTY` | 2026-09-07 |
| #45 | `arena/01a07f36-maharani-mart` | 8 | +773 / −91 | `CONFLICTING` / `DIRTY` | 2026-09-08 |
| #66 | `arena/01a0b519-maharani-mart` | 21 | +2276 / −409 | `CONFLICTING` / `DIRTY` | 2026-10-08 |

All three pass the Vercel preview check; the Supabase Preview integration is
skipped on each. The conflicts are real, not a stale badge: a local
`git merge-tree` against `main` reports content conflicts in **26** files for
#42, **4** for #45 and **13** for #66.

They conflict because each branch was cut from an older `main` and `main` has
since advanced (for example #66 is based on `f388d97`, before PR #115).

## 2. Overlap between the PRs

Files touched by more than one PR:

| File | #42 | #45 | #66 |
| --- | :-: | :-: | :-: |
| `app/retailer/home/page.tsx` | ✓ | ✓ | |
| `app/globals.css` | | ✓ | |
| `app/retailer/catalog/page.tsx` | ✓ | | ✓ |
| `app/retailer/categories/page.tsx` | ✓ | | ✓ |
| `components/retailer/product-card.tsx` | ✓ | | ✓ |
| `components/retailer/brand-card.tsx` | ✓ | | ✓ |
| `components/retailer/category-card.tsx` | ✓ | | ✓ |
| `components/retailer/promo-banner.tsx` | ✓ | | ✓ |
| `components/retailer/promo-carousel.tsx` | ✓ | | ✓ |
| `lib/retailer/catalog.ts` | ✓ | | ✓ |

#42 and #66 both rewrite the same three discovery cards and both banner
components, so **they also conflict with each other**, not only with `main`.

## 3. Overlap with the Phase 1 branch (`7987f45`)

The Phase 1 branch touches six files that the open PRs own:

| File | Phase 1 change | Owned by |
| --- | --- | --- |
| `app/globals.css` | one `@import` line for the generated marketing CSS | #45 |
| `components/retailer/promo-banner.tsx` | rewritten for berry styling + `<picture>` art direction | #42, #66 |
| `components/retailer/promo-carousel.tsx` | berry chrome + passes `image_url_mobile` | #42, #66 |
| `components/retailer/home-content.tsx` | berry hero band | #66 |
| `lib/retailer/home-data.ts` | adds `.eq('status','published')` | #66 |
| `tests/retailer-home-ui.test.tsx` | adds the `getImageProps` mock | #66 |

This is a genuine cost: whichever side lands second must reconcile these files.
Per the owner's instruction, **no further changes were made to any PR-owned
file in this turn**; the overlap is reported instead of extended.

## 4. Suggested rebase order (for the PR owners)

Recommended: **#45 → #66 → #42**.

Rationale:

1. **#45 first** — smallest surface (8 files), and it owns `app/globals.css`
   plus the login/OTP path. Landing the shared style foundation and auth fix
   first prevents two larger PRs from repeatedly re-resolving the same global
   stylesheet.
2. **#66 second** — it introduces new catalogue behaviour and components
   (`catalog-feed.tsx`, `catalog-feed.ts`, taxonomy helpers, a new API route).
   Behaviour is easier to rebase while the presentation layer is still
   unsettled.
3. **#42 last** — a broad visual pass over 27 files. A sweeping redesign should
   be applied to the final component set, not the other way round, so its owner
   restyles the components #66 created rather than #66 re-implementing styling
   that #42 then overwrites.

If the owners prefer a different order, the only hard requirement is that
**one** of #42/#66 lands before the other; they cannot both apply cleanly in
parallel.

### Steps for each owner

```bash
git fetch origin
git rebase origin/main            # resolve, then:
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
pnpm build                        # placeholder Supabase env is enough
git push --force-with-lease origin <their-branch>
```

Resolve in favour of `main` for anything already shipped after their base
(PR #115), and re-run the full suite rather than only the touched test files —
the design-system contract test scans every source file for banned colours,
which is exactly what a redesign can break.

## 5. Options for the owner

| Option | Effect | Cost |
| --- | --- | --- |
| A. Owners rebase; Phase 1 stays as-is | Each PR resolves the same 2–5 Phase 1 files | Rebase work lands on the PR owners |
| B. Extract the berry hero into `components/retailer/marketing-hero.tsx` | `home-content.tsx` keeps a one-line import instead of ~60 changed lines; conflict becomes trivial | Small extra refactor; still touches one owned file once |
| C. Park Phase 1's edits to owned files behind a flag | PR-owned files revert to `main` | Homepage/banner redesign is effectively paused |
| D. Close #42/#66 and take the work over | Removes the conflict entirely | Discards their owners' work; needs explicit approval |

Until the owner chooses, Phase 1 remains a reviewable branch and **nothing is
merged or deployed**.
