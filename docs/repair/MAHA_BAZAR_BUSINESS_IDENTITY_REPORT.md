# Maha Bazar by Maharani — Business Identity & Branding Report

**Branch:** `arena/b4ce4177-maharani-mart` · **PR:** #140
**Scope:** customer-facing branding preparation and legal-identity enforcement
**Production actions performed:** none.

---

## 1. The four names, and what each one is

The owner's instruction is that these identities stay strictly separate. This is the
interpretation the code and the copy now enforce:

| Name | What it is | Where it appears | What it must never be called |
| --- | --- | --- | --- |
| **Maha Bazar by Maharani** | the customer-facing website / app name | browser title, PWA manifest, install prompt, header wordmark, offline page, page titles | a legal entity, an invoice issuer, a GST registrant |
| **Maharani Traders** | the brand / trading style | footer, about page, legal copy, product provenance | a legal entity, an invoice issuer |
| **Ajay General** (proprietorship) | the **legal seller and invoice issuer** the owner approved | tax-invoice issuer block, statutory disclosures, support "company" field | — (this is the entity) |
| **Maa Kali Enterprises** | a **separate** business identity | repository architecture comments only | anything owned, operated, invoiced or legally identical to the other three |

Owner-approved statement, applied verbatim throughout:

> **Ajay General (proprietorship) is the legal seller and invoice issuer, trading under the
> Maharani Traders brand.**

`Maa Kali Enterprises` appears in exactly one customer-facing sentence, and only to say it is
**separate**: *"Maa Kali Enterprises is a separate business identity and is not connected to this
business."* No ownership, invoicing, registration or identity relationship is claimed for it anywhere.

---

## 2. What changed in the code

### 2.1 One source of truth

Two new modules, because a brand name duplicated across 40 files is a brand name that will drift:

* **`lib/brand.ts`** — `BRAND.name` (`Maha Bazar by Maharani`), `BRAND.shortName` (`Maha Bazar`),
  `BRAND.legalName` (`Ajay General`), `BRAND.legalForm` (`proprietorship`),
  `BRAND.tradingStyle` (`Maharani Traders`), `BRAND.brandFamily` (`Maharani`), plus
  `BRAND_WITH_TRADING_STYLE`, `LEGAL_ISSUER_LINE` and a `pageTitle()` helper.
  `Maa Kali Enterprises` is **deliberately absent** from this module so no surface can pick it up by
  accident.
* **`lib/legal/issuer.ts`** — the statutory block, with every owner-supplied fact modelled as
  `{ key, placeholder, value }`. `value` is `null` until the owner supplies it; a caller that needs a
  complete block checks `statutoryBlockIsComplete()` and refuses rather than printing a guess.
  Configuration prompts (`TBD`, `TODO`, `n/a`, `owner input required`, `placeholder`, `configure`)
  are treated as **absent, not as values**.

### 2.2 Surfaces switched to the brand constant

| Surface | File | Change |
| --- | --- | --- |
| Browser title, description, application name, Apple web-app title | `app/layout.tsx` | `BRAND.name` / `BRAND.tagline` |
| PWA manifest name, short name, description | `app/manifest.ts` | `BRAND.name`, `BRAND.shortName` — `id` and `start_url` unchanged, so an existing install is not orphaned |
| Install prompt dialog + button label | `components/pwa/InstallPrompt.tsx` | accessible names from `BRAND.name` |
| Header wordmark and footer | `components/layout/retailer-shell.tsx` | wordmark `BRAND.name`; footer `BRAND_WITH_TRADING_STYLE` |
| Topbar, sidebar, auth frame | `components/layout/{topbar,sidebar}.tsx`, `components/auth/auth-frame.tsx` | `BRAND.name` |
| Offline fallback page | `public/offline.html` | static file, updated by hand |
| Service-worker header comment | `public/sw.js` | comment only; **no caching behaviour changed** |
| Page titles (9 pages + managed legal pages) | `app/**`, `components/legal/managed-page.tsx` | `BRAND.name` via template literal |
| Promo carousel region label | `components/retailer/promo-carousel.tsx` | `BRAND.name` |
| Support counterparty name | `app/api/mobile/v1/help/route.ts`, `app/retailer/help/page.tsx` | `BRAND.legalName` (the entity, not the app) + new `appName` field |
| Login / access-expired copy | `app/login/page.tsx`, `app/access-expired/page.tsx` | `BRAND.name` |

**Admin branding deliberately unchanged.** The admin shell labels itself `Super Admin Console` /
`Admin Console` by role, which is a functional label, not a brand claim. It is left alone.

### 2.3 Invoice: the entity issues, the brand is shown separately

A branding change must not move the legal identity. The invoice path now carries both names
*without conflating them*:

* `lib/retailer/invoice-html.ts` — `company` is documented as **the legal issuer** and is rendered as
  before; a new optional `brandName` renders as *"Trading as Maha Bazar by Maharani"* beside it. The
  footer note now reads *"issued by Ajay General (trading as Maha Bazar by Maharani)"*.
* `app/retailer/orders/[id]/invoice/download/route.ts` — passes `brandName` separately.
* `app/api/mobile/v1/orders/[id]/invoice/route.ts` — `biller` stays the legal issuer; the app brand
  travels in a new `brand` key so a client can render the brand without relabelling the issuer.

### 2.4 The issuer guard

`getTaxInvoiceReadiness()` refuses to issue when `COMPANY_NAME` identifies **only** a brand:

| `COMPANY_NAME` | Result |
| --- | --- |
| `Maharani Traders`, `Maha Bazar by Maharani`, `Maha Bazar`, `Maharani` | `issuer_identity_unapproved` |
| `Ajay General`, `Ajay General (Proprietor)`, `Ajay General, trading as Maharani Traders` | ready |

A trading style is not a legal entity. Printing one as the issuer on a tax document would misstate
who issued it, even if every sentence of the website is correct. A previously passing mobile-invoice
test used `Maharani Traders` as the biller; it was corrected to the entity rather than the guard being
weakened.

---

## 3. Legal copy

`terms` now opens its identity sentence with the app name:

> Maha Bazar by Maharani is the customer-facing website and app name for Maharani Traders, a brand
> operated by AJAY KUMAR, Proprietor, under the registered trade name AJAY GENERAL (proprietorship).
> Maharani Traders is a trading style, not a separate incorporated company or legal entity, and the
> legal seller and invoice issuer is AJAY GENERAL. Maa Kali Enterprises is a separate business
> identity and is not connected to this business.

`terms`, `business-disclosure`, `gst-pricing-invoice` and `about` all state the approved issuer:

> The seller and invoice issuer is the AJAY GENERAL proprietorship, which trades under the brand
> MAHARANI TRADERS; the GSTIN and registered address printed on the invoice are the ones registered
> for that business.

**No GSTIN, registered address, phone, registration number, bank detail or grievance contact was
invented.** The registered values remain owner-supplied and are pointed at, not guessed.

---

## 4. What is still missing, and how it is represented

| Fact | State | How the code behaves |
| --- | --- | --- |
| GSTIN | **not supplied** | `issuer.gstin.value = null`; `statutoryBlock()` renders *"GSTIN to be supplied by the owner before publication"*; `statutoryBlockIsComplete()` is `false` |
| Registered address | **not supplied** | same |
| Support phone | **not supplied** | same |
| Grievance officer | **not supplied** in code (the legal pages carry the owner's earlier stated contact) | same |

The application therefore has a **controlled placeholder** everywhere the owner's value is required,
and a machine-checkable completeness flag. Setting the `COMPANY_*` environment variables is the only
step needed once the owner supplies the values; no code change is required.

---

## 5. What was deliberately NOT done

* No Android APK/AAB, Flutter or Android build/release task. A test asserts no
  `@capacitor/*` or `react-native` dependency appears.
* No logo artwork was redrawn. The existing icons in `public/icons` are reused, so the PWA install
  identity (`id`, `start_url`, icon set) is stable across the rename.
* No unrelated functionality was redesigned; the diff is naming, copy and the new modules.
* No production deploy, no DNS/Vercel change, no Supabase setting change.

---

## 6. Verification

| Check | Result |
| --- | --- |
| `tests/brand-identity.test.ts` | 16 tests — brand constants, entity/brand separation, issuer guard, Maa Kali isolation, no APK/Flutter surface |
| `tests/business-identity-claims.test.ts` | 12 tests — no unverified seller-of-record / legal-seller / invoice-issuer / GST claim, no invented GSTIN/phone/email, grievance officer unchanged, statutory disclosures preserved |
| `tests/pwa.test.ts` | 19 tests — manifest name, short name, offline page, layout metadata |
| `tests/retirement-security-audit.test.ts` | 15 tests — no live link to a retired route, no dropped object, `search_path` pinned, rollback exact |
| Full suite | **234 files / 3520 tests, EXIT=0** |
| `tsc --noEmit` / `eslint .` / `next build` | EXIT=0 / 0 errors 0 warnings / EXIT=0 |

The brand assertions are not tautological: reverting a sentence or reintroducing an issuer claim makes
`business-identity-claims` fail (verified by temporarily reverting the copy during development).
