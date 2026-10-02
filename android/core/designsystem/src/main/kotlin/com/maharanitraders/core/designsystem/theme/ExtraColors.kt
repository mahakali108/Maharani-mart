package com.maharanitraders.core.designsystem.theme

import androidx.compose.runtime.Immutable
import androidx.compose.ui.graphics.Color

/**
 * Brand tokens that Material 3's [androidx.compose.material3.ColorScheme] has no
 * slot for: the retailer "action" blue, stock states and the warning tone.
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
)
