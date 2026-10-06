package com.maharanitraders.core.designsystem.theme

import androidx.compose.runtime.Immutable
import androidx.compose.ui.graphics.Color

/**
 * Brand tokens that Material 3's [androidx.compose.material3.ColorScheme] has no
 * slot for: the Maharani-red commerce chrome, stock states, the saffron accent,
 * the app-bar gradient and skeleton tones.
 *
 * Read them through [MaharaniThemeTokens.colors] so screens never reach for a
 * palette constant directly and dark mode keeps working:
 *
 *     Text(color = MaharaniThemeTokens.colors.inStock, text = "...")
 *
 * Every value is an existing entry of [MaharaniPalette] - no colour is invented
 * on this layer.
 */
@Immutable
data class MaharaniExtraColors(
  val action: Color,
  val actionContainer: Color,
  val onActionContainer: Color,
  val inStock: Color,
  val inStockSurface: Color,
  val outOfStock: Color,
  val outOfStockSurface: Color,
  val warning: Color,
  val warningSurface: Color,
  /** Brand red, used for the crown mark and identity accents on light chrome. */
  val brandMark: Color,
  val brandMarkSurface: Color,
  /** Restrained saffron accent (wholesale emphasis, slab-table highlight). */
  val saffron: Color,
  val saffronSurface: Color,
  val onSaffronSurface: Color,
  /** The shopping app bar's subtle two-stop gradient. */
  val appBarStart: Color,
  val appBarEnd: Color,
  val onAppBar: Color,
  val onAppBarMuted: Color,
  val appBarField: Color,
  val onAppBarField: Color,
  val appBarFieldHint: Color,
  /** Loading skeleton tones. */
  val skeletonBase: Color,
  val skeletonHighlight: Color,
  /** Neutral tile behind a product image while it loads or when it is missing. */
  val imagePlaceholder: Color,
  val onImagePlaceholder: Color,
  /** Scrim under banner copy, so text stays legible on any artwork. */
  val scrim: Color,
)

internal val LightExtraColors = MaharaniExtraColors(
  // Buy actions (add to cart, place order, checkout) are the brand red: one
  // family across chrome and commerce, so "where am I" and "what can I tap"
  // are the same colour and the shop never looks like a marketplace clone.
  action = MaharaniPalette.BrandRed600,
  actionContainer = MaharaniPalette.BrandRed50,
  onActionContainer = MaharaniPalette.BrandRed700,
  inStock = MaharaniPalette.Success600,
  inStockSurface = MaharaniPalette.Success50,
  outOfStock = MaharaniPalette.OutOfStockRose,
  outOfStockSurface = MaharaniPalette.OutOfStockRoseSurface,
  warning = MaharaniPalette.Warning600,
  warningSurface = MaharaniPalette.Warning50,
  brandMark = MaharaniPalette.BrandRed600,
  brandMarkSurface = MaharaniPalette.BrandRed50,
  saffron = MaharaniPalette.Saffron600,
  saffronSurface = MaharaniPalette.Saffron50,
  onSaffronSurface = MaharaniPalette.Saffron800,
  // The app bar's two-stop brand gradient: deep at the top edge, a touch
  // lighter behind the search field, so the header reads as premium Maharani
  // red without a loud gradient. White content on it clears 4.5:1 at 600.
  appBarStart = MaharaniPalette.BrandRed700,
  appBarEnd = MaharaniPalette.BrandRed600,
  onAppBar = MaharaniPalette.White,
  onAppBarMuted = Color(0xD9FFFFFF),
  appBarField = MaharaniPalette.White,
  onAppBarField = MaharaniPalette.Ink900,
  appBarFieldHint = MaharaniPalette.Ink500,
  skeletonBase = MaharaniPalette.Neutral200,
  skeletonHighlight = MaharaniPalette.Neutral100,
  // A neutral (not pink) tile behind artwork, so a photo is never tinted by the
  // surface it loads on. Brand-tinted placeholder surfaces are opt-in per
  // component (see the directory tiles' monogram).
  imagePlaceholder = MaharaniPalette.Neutral100,
  onImagePlaceholder = MaharaniPalette.Ink400,
  scrim = Color(0x990B0B0B),
)

internal val DarkExtraColors = MaharaniExtraColors(
  action = MaharaniPalette.BrandRed400,
  actionContainer = MaharaniPalette.BrandRed900,
  onActionContainer = MaharaniPalette.BrandRed100,
  inStock = MaharaniPalette.Success50,
  inStockSurface = MaharaniPalette.Success900,
  outOfStock = MaharaniPalette.OutOfStockRoseDark,
  outOfStockSurface = MaharaniPalette.OutOfStockRoseSurfaceDark,
  warning = MaharaniPalette.Warning600,
  warningSurface = MaharaniPalette.Warning900,
  brandMark = MaharaniPalette.BrandRed400,
  brandMarkSurface = MaharaniPalette.BrandRed950,
  saffron = MaharaniPalette.Saffron300,
  saffronSurface = MaharaniPalette.Saffron900,
  onSaffronSurface = MaharaniPalette.Saffron100,
  appBarStart = MaharaniPalette.BrandRed900,
  appBarEnd = MaharaniPalette.BrandRed800,
  onAppBar = MaharaniPalette.White,
  onAppBarMuted = Color(0xB3FFFFFF),
  appBarField = MaharaniPalette.SurfaceDarkHigh,
  onAppBarField = MaharaniPalette.Ink50,
  appBarFieldHint = MaharaniPalette.Ink400,
  skeletonBase = MaharaniPalette.SurfaceDarkHigh,
  skeletonHighlight = Color(0xFF332E31),
  imagePlaceholder = MaharaniPalette.SurfaceDarkHigh,
  onImagePlaceholder = MaharaniPalette.Ink500,
  scrim = Color(0xB3000000),
)
