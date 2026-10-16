# Maharani Traders visual system

This document describes the shared design tokens in [`design/tokens.json`](../design/tokens.json). That JSON file is the canonical source. Run `node scripts/generate-design-tokens.mjs` after changing it to regenerate the web custom properties and Android Compose palette. The parity test verifies that both generated outputs still match the registry.

## Visual language

The storefront and native app use a warm ivory canvas, crisp white cards, navy typography, and premium violet actions. Lavender supports selection and account tools; mint marks positive/in-stock states; sky is reserved for informational and delivery context; peach and amber support real, configured offers and warnings. Soft pastel pink is limited to light beauty/personal-care merchandising surfaces. The admin experience shares these tokens, with its neutral data table and status labels taking priority over decoration.

Do not use red, wine, crimson, maroon, or saturated pink as UI branding, action, price, error, or status colours. Errors use a neutral lavender/slate surface and a readable navy label/icon; warnings use amber. Status meaning must also be written in text or conveyed by an icon, never colour alone. Destructive admin controls use neutral styling and explicit confirmation.

## Palette families

The registry contains **117 documented palette tokens across 12 coherent families** plus **39 semantic role aliases**. The scales are options for components, not a palette to display all at once.

| Family | Purpose | Common use |
| --- | --- | --- |
| `violet` | Primary identity and interaction | `violet.600` actions; `violet.700` hover; `violet.500` focus |
| `lavender` | Quiet violet surfaces | Selection, account shortcuts, neutral validation/error containers |
| `navy` | Readable text and dark chrome | `navy.900` primary text; `navy.500` secondary text |
| `slate` | Borders and cool UI neutrals | `slate.200` borders; subtle table surfaces |
| `ivory` | Warm page surfaces | `ivory.100` page canvas; cards stay white |
| `mint` | Positive/in-stock statuses | Dark text/icons on a pale mint surface |
| `sky` | Information and delivery | Delivery area notes, schedule facts, neutral progress |
| `peach` | Merchandising | Pale campaign surfaces and offer labels |
| `amber` | Warnings and configured offers | Explicit warning/expiry states with a text label |
| `stone` | Utility neutrals | Quiet outlines, empty states, monochrome icons |
| `pastelPink` | Soft pastel category accents only | Light beauty/personal-care tiles; never body text or actions |
| `foundation` | White and black | Card surfaces and image/scrim compositing |

Each palette token has a family-level use note next to its value in `design/tokens.json`; generated CSS and Kotlin preserve that documentation.

## Semantic aliases

Prefer semantic aliases over raw palette values: `action.primary`, `surface.page`, `surface.card`, `text.primary`, `text.secondary`, `status.success.*`, `status.warning.*`, `status.info.*`, `status.error.*`, `status.outOfStock.*`, `offer.*`, `chart.*`, and `focus.outline`. Tailwind's `primary`, `action`, `mint`, `sky`, `peach`, `amber`, `lavender`, `ivory`, `slate`, and `ink` scales are compatibility-friendly views of the same registry.

## Accessibility and responsive rules

- Automated WCAG contrast tests enforce 4.5:1 for normal text and 3:1 for the focus outline; primary text on the page is held to 7:1. Large icon/illustration areas are not treated as text.
- Keyboard focus uses a 3px violet outline with offset. Components may provide an equally visible Tailwind focus ring.
- Buttons and compact controls preserve minimum 44px web targets; Compose navigation and actions use the existing 48dp sizing contract.
- Storefront content must remain usable at 320, 360, 390, 768, 1024, and 1440 CSS pixels. Product imagery always has a labelled fallback; actual product, brand, category, promotion, price, stock, pack, and MOQ content is backend-owned.
- Four mobile category shortcuts use separate pastel surfaces; other category rows rotate only through the same approved family set.
- No decorative gradients or banners may imply a live offer. The promotional carousel renders only actual active server-provided banners.

## Native mapping

Jetpack Compose maps Material `primary` and selected navigation to violet, warm ivory to the page, navy to text, mint/sky/amber to their semantic states, and neutral lavender/slate to errors and out-of-stock labels. Native screens remain Kotlin + Compose and keep the existing API, authentication/session, cart, order, account, RLS, and business-rule flows intact.
