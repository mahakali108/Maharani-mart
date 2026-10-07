package com.maharanitraders.core.designsystem.theme

import androidx.compose.ui.graphics.Color

/**
 * Brand palette.
 *
 * MAHARANI RED IS THE PRIMARY. The brand red scale below (#C8102E at
 * [BrandRed600]) is the app's `primary` — app bar, selected tab, bottom-bar
 * selection, primary buttons, prices' accent and progress — and it is the same
 * red as the launcher background asset and the web's `primary` token in
 * `tailwind.config.ts`, so the app and the storefront cannot drift apart.
 *
 * What the rest of the palette is for:
 *   - [Saffron] is the one accent ([ColorScheme.secondary]): offer badges,
 *     wholesale highlights and small emphatic surfaces;
 *   - [Neutral] page/surface greys keep white cards on a continuous, warm
 *     neutral background — the app deliberately has no blue chrome;
 *   - [Success]/[OutOfStockRose] are the stock states (green in stock, rose
 *     unavailable) and are never used decoratively;
 *   - [Ink] is text and elevation-by-surface.
 *
 * The web storefront still carries its own `action` blue in `tailwind.config.ts`
 * (that is a web token, not an app one); nothing on this layer is blue, so the
 * native app cannot render blue chrome by accident.
 *
 * No product, price or stock value lives here: these are design tokens only.
 */
object MaharaniPalette {

  // Brand red — chrome, wordmark, primary actions on brand surfaces.
  val BrandRed50 = Color(0xFFFDF2F3)
  val BrandRed100 = Color(0xFFFCE4E6)
  val BrandRed200 = Color(0xFFF9CCD1)
  val BrandRed300 = Color(0xFFF4A3AC)
  val BrandRed400 = Color(0xFFEC6F7D)
  val BrandRed500 = Color(0xFFDD3D4F)
  val BrandRed600 = Color(0xFFC8102E) // brand core, matches ic_launcher_background
  val BrandRed700 = Color(0xFFA80C26)
  val BrandRed800 = Color(0xFF8C0F24)
  val BrandRed900 = Color(0xFF771023)
  val BrandRed950 = Color(0xFF41040F)

  // Ink — text and neutral surfaces.
  val Ink50 = Color(0xFFF6F6F6)
  val Ink100 = Color(0xFFEDEDED)
  val Ink200 = Color(0xFFDCDCDC)
  val Ink300 = Color(0xFFBFBFBF)
  val Ink400 = Color(0xFF9A9A9A)
  val Ink500 = Color(0xFF6E6E6E)
  val Ink600 = Color(0xFF545454)
  val Ink700 = Color(0xFF3D3D3D)
  val Ink800 = Color(0xFF2A2A2A)
  val Ink900 = Color(0xFF1A1A1A)
  val Ink950 = Color(0xFF0B0B0B)

  // Status colours, aligned with the web's success/warning/danger utilities.
  val Success50 = Color(0xFFECFDF5)
  val Success600 = Color(0xFF059669)
  val Success700 = Color(0xFF047857)
  val Success900 = Color(0xFF064E3B)

  // Saffron / gold — the app's SECONDARY accent (Material's `secondary` role):
  // offer badges, "New" ribbons' companion accents, wholesale highlights, the
  // selected segment's edge and banner copy. Warm amber-gold, deliberately used
  // on small surfaces so it reads as a premium accent rather than a wash.
  val Saffron50 = Color(0xFFFFF8EB)
  val Saffron100 = Color(0xFFFEEFC7)
  val Saffron200 = Color(0xFFFDDF8A)
  val Saffron300 = Color(0xFFFBC44D)
  val Saffron400 = Color(0xFFF7B01B)
  val Saffron500 = Color(0xFFF59E0B) // secondary core
  val Saffron600 = Color(0xFFD97706)
  val Saffron700 = Color(0xFFA16207)
  val Saffron800 = Color(0xFF854D0E)
  val Saffron900 = Color(0xFF78350F)

  // Page and surface neutrals — the light, WARM-NEUTRAL backgrounds the native
  // shopping UI puts behind white cards, so the shop reads as one continuous
  // surface and the brand red is the only strong colour on screen. Deliberately
  // not blue-tinted: a cool page grey is what made the whole app read as
  // "marketplace blue" even when nothing on it was blue.
  val NeutralPage = Color(0xFFF7F6F7)
  val Neutral50 = Color(0xFFFBFAFA)
  val Neutral100 = Color(0xFFF2F1F2)
  val Neutral200 = Color(0xFFE7E5E6)
  val Neutral300 = Color(0xFFD8D5D7)
  val PageDark = Color(0xFF121013)
  val SurfaceDark = Color(0xFF1A1719)
  val SurfaceDarkHigh = Color(0xFF252124)

  val Warning50 = Color(0xFFFFFBEB)
  val Warning600 = Color(0xFFD97706)
  val Warning700 = Color(0xFFB45309)
  val Warning900 = Color(0xFF451A03)

  val Danger50 = Color(0xFFFFF1F2)
  val Danger600 = Color(0xFFE11D48)
  val Danger700 = Color(0xFFBE123C)
  val Danger900 = Color(0xFF4C0519)

  // Rose - the web's "out of stock" / failure tone. The dark pair matches the
  // values Theme.kt already uses for Material's `error` role in the dark scheme.
  val OutOfStockRose = Color(0xFFE11D48)
  val OutOfStockRoseSurface = Color(0xFFFFF1F2)
  val OutOfStockRoseDark = Color(0xFFFB7185)
  val OutOfStockRoseSurfaceDark = Color(0xFF4C0519)

  val White = Color(0xFFFFFFFF)
  val Black = Color(0xFF000000)
}
