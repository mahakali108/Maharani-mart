package com.maharanitraders.core.designsystem.theme

import androidx.compose.ui.graphics.Color

/**
 * Brand palette, transcribed from the EXISTING web tokens — nothing is invented
 * here:
 *
 *   - `tailwind.config.ts` → `primary` (premium red) and `action` (buy blue)
 *   - the launcher background asset ships the same brand red (#C8102E)
 *
 * Note for reviewers: use these tokens (or the Material 3 scheme built from
 * them in [MaharaniTheme]) instead of literal hex values in screens.
 */
object MaharaniPalette {

  // Brand red — chrome, wordmark, primary actions on brand surfaces.
  val Red50 = Color(0xFFFDF2F3)
  val Red100 = Color(0xFFFCE4E6)
  val Red200 = Color(0xFFF9CCD1)
  val Red300 = Color(0xFFF4A3AC)
  val Red400 = Color(0xFFEC6F7D)
  val Red500 = Color(0xFFDD3D4F)
  val Red600 = Color(0xFFC8102E) // brand core, matches ic_launcher_background
  val Red700 = Color(0xFFA80C26)
  val Red800 = Color(0xFF8C0F24)
  val Red900 = Color(0xFF771023)
  val Red950 = Color(0xFF41040F)

  // Action blue — the retailer "buy" colour on the web (Add to cart, Place order).
  val Action50 = Color(0xFFF0F6FF)
  val Action100 = Color(0xFFDCEBFF)
  val Action200 = Color(0xFFB9D8FF)
  val Action300 = Color(0xFF8CBDFF)
  val Action400 = Color(0xFF5C9AF8)
  val Action500 = Color(0xFF2874F0)
  val Action600 = Color(0xFF1E5FD8)
  val Action700 = Color(0xFF1A4DB4)
  val Action800 = Color(0xFF1A4394)
  val Action900 = Color(0xFF1A3C78)

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

  val Warning50 = Color(0xFFFFFBEB)
  val Warning600 = Color(0xFFD97706)
  val Warning700 = Color(0xFFB45309)
  val Warning900 = Color(0xFF451A03)

  val Danger50 = Color(0xFFFFF1F2)
  val Danger600 = Color(0xFFE11D48)
  val Danger700 = Color(0xFFBE123C)
  val Danger900 = Color(0xFF4C0519)

  val White = Color(0xFFFFFFFF)
  val Black = Color(0xFF000000)
}
