package com.maharanitraders.core.designsystem.theme

import androidx.compose.runtime.Immutable
import androidx.compose.ui.graphics.Color

/**
 * Brand tokens that Material 3's [androidx.compose.material3.ColorScheme] has no
 * slot for: the retailer "action" blue, stock states, the saffron accent, the
 * app-bar gradient and skeleton tones.
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
  action = MaharaniPalette.ActionBlue500,
  actionContainer = MaharaniPalette.ActionBlue50,
  onActionContainer = MaharaniPalette.ActionBlue700,
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
  onSaffronSurface = MaharaniPalette.Saffron700,
  appBarStart = MaharaniPalette.ActionBlue600,
  appBarEnd = MaharaniPalette.ActionBlue500,
  onAppBar = MaharaniPalette.White,
  onAppBarMuted = Color(0xD9FFFFFF),
  appBarField = MaharaniPalette.White,
  onAppBarField = MaharaniPalette.Ink900,
  appBarFieldHint = MaharaniPalette.Ink500,
  skeletonBase = MaharaniPalette.Cool200,
  skeletonHighlight = MaharaniPalette.Cool100,
  imagePlaceholder = MaharaniPalette.Cool100,
  onImagePlaceholder = MaharaniPalette.Ink400,
  scrim = Color(0x990B0B0B),
)

internal val DarkExtraColors = MaharaniExtraColors(
  action = MaharaniPalette.ActionBlue400,
  actionContainer = MaharaniPalette.ActionBlue900,
  onActionContainer = MaharaniPalette.ActionBlue100,
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
  appBarStart = MaharaniPalette.ActionBlue800,
  appBarEnd = MaharaniPalette.ActionBlue700,
  onAppBar = MaharaniPalette.White,
  onAppBarMuted = Color(0xB3FFFFFF),
  appBarField = MaharaniPalette.SurfaceDarkHigh,
  onAppBarField = MaharaniPalette.Ink50,
  appBarFieldHint = MaharaniPalette.Ink400,
  skeletonBase = MaharaniPalette.SurfaceDarkHigh,
  skeletonHighlight = Color(0xFF2A3542),
  imagePlaceholder = MaharaniPalette.SurfaceDarkHigh,
  onImagePlaceholder = MaharaniPalette.Ink500,
  scrim = Color(0xB3000000),
)
