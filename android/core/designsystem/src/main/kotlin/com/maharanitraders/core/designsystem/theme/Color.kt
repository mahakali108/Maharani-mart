package com.maharanitraders.core.designsystem.theme

import androidx.compose.ui.graphics.Color

/**
 * Brand palette, transcribed from the EXISTING web tokens plus the native
 * shopping-redesign brief:
 *
 *   - `tailwind.config.ts` → `primary` (premium red) and `action` (buy blue)
 *   - the launcher background asset ships the same brand red (#C8102E)
 *   - the native redesign promotes the marketplace blue to the app's PRIMARY
 *     commerce colour (Flipkart-style shopping chrome) while the brand red
 *     stays the identity colour of the crown mark, the splash and accents;
 *     both come from the SAME web tokens, so nothing here is invented.
 *   - the saffron scale and the cool page greys are the one addition of the
 *     native brief (restrained accents, light-blue page backgrounds). They are
 *     design tokens, not data: no product, price or stock value lives here.
 *
 * Note for reviewers: use these tokens (or the Material 3 scheme built from
 * them in [MaharaniTheme]) instead of literal hex values in screens.
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

  // Action blue — the retailer "buy" colour on the web (Add to cart, Place order).
  val ActionBlue50 = Color(0xFFF0F6FF)
  val ActionBlue100 = Color(0xFFDCEBFF)
  val ActionBlue200 = Color(0xFFB9D8FF)
  val ActionBlue300 = Color(0xFF8CBDFF)
  val ActionBlue400 = Color(0xFF5C9AF8)
  val ActionBlue500 = Color(0xFF2874F0)
  val ActionBlue600 = Color(0xFF1E5FD8)
  val ActionBlue700 = Color(0xFF1A4DB4)
  val ActionBlue800 = Color(0xFF1A4394)
  val ActionBlue900 = Color(0xFF1A3C78)

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

  // Saffron — the native shopping redesign's restrained accent (tier-table
  // emphasis, wholesale highlights). Part of the native brand direction, not a
  // web token; the app keeps it to small surfaces only.
  val Saffron50 = Color(0xFFFFF8EB)
  val Saffron100 = Color(0xFFFEEFC7)
  val Saffron200 = Color(0xFFFDDF8A)
  val Saffron300 = Color(0xFFFBC44D)
  val Saffron500 = Color(0xFFF59E0B)
  val Saffron600 = Color(0xFFD97706)
  val Saffron700 = Color(0xFFA16207)
  val Saffron900 = Color(0xFF78350F)

  // Cool page greys — the light-blue-tinted backgrounds the native redesign
  // puts behind white cards, so the shop reads as one continuous surface.
  val PageLight = Color(0xFFF3F6FB)
  val Cool50 = Color(0xFFF8FAFD)
  val Cool100 = Color(0xFFEFF3F9)
  val Cool200 = Color(0xFFE3EAF3)
  val Cool300 = Color(0xFFD3DDEA)
  val PageDark = Color(0xFF0D1218)
  val SurfaceDark = Color(0xFF151C25)
  val SurfaceDarkHigh = Color(0xFF1E2732)

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
