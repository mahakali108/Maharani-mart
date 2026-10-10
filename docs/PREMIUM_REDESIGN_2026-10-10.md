# Premium redesign and Saran district — 10 October 2026

Branch: `arena/e73680ac-maharani-mart`, based on `main` @ `6c7b634`.
Scope: the Next.js web app / PWA only. Android was not touched.

## 1. What changed visually

- **Palette (`tailwind.config.ts`).** Blush, ivory, wine and gold replace the former
  bright red and marketplace blue. The `primary` and `action` scales now share the
  wine core `#8f1d40`. `slate` is now a warm neutral scale. Class names are unchanged,
  so every existing screen inherits the new palette.
- **Shell.** The page background is ivory. Brand colour follows the new wine in
  the manifest, theme colour, install prompt and offline page.
- **Login.** Solid wine brand panel with a gold rule (no gradient), ivory form panel,
  service area named.
- **Home.** Welcome block is now a wine banner with a gold top rule. It shows a
  "Serving Saran District, Bihar" selector chip.
- **Catalogue.** The hero is a solid blush surface. A new **Shop by brand** strip sits
  beneath the category tiles, so Categories and Brands are both visible. Brand chips
  use the same `brand` filter parameter as the filter panel and keep an active category.
- **Category tiles.** Compact tiles are now circular "aisle" tiles. Full category
  cards use the premium surface.
- **Gradients.** About 17 repeated template gradients were replaced with solid blush or
  wine surfaces.

## 2. Saran District, Bihar

See `docs/SERVICE_AREA_SARAN.md`. In short: `lib/config/service-area.ts` is the
constant, migration `0058` changes the DB default only, and no rows are rewritten.
No areas, pincodes or coordinates were invented.

## 3. Verification (executed locally)

| Check | Result |
|---|---|
| `pnpm typecheck` | Passed, 0 errors |
| `pnpm lint` | Passed, 0 errors, 1 pre-existing warning (`<img>` in `product-image-manager.tsx`) |
| `pnpm test` | 122 files / 2264 tests passed (baseline 120 / 2238) |
| `pnpm build` | Passed (placeholder public Supabase URL, so no live data) |
| Production server | `/login` 200 with Saran copy and no Khagaria text; `/manifest.webmanifest` 200; `/sw.js` 200; `/offline.html` 200; `/retailer/home` anonymous → 307 to `/login` |

## 4. Not verified here (see the final report)

- Screenshots and real-device visual QA: no browser binary is available in the sandbox.
- Session persistence on a real Android PWA.
- Live production health.
- Applying migrations 0057 and 0058 to the live database.
- The `is_phone_registered` enumeration risk (needs a product decision and rate limiting).
