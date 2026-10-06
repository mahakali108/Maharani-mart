package com.maharanitraders.core.designsystem.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

/**
 * Maharani Traders Material 3 theme — the native shopping redesign.
 *
 * Mapping rationale (royal blue + warm gold, over the existing web tokens):
 *  - `primary`   → ROYAL / DEEP BLUE ([MaharaniPalette.RoyalBlue600]): the
 *    shopping app bar, bottom navigation, primary buttons, selection, links and
 *    progress. One deep blue family carries the whole commerce chrome, so
 *    "where am I" and "what can I tap" are the same colour everywhere.
 *  - `secondary` → WARM GOLD ([MaharaniPalette.Saffron500]): the accent that
 *    makes offers, counts and highlights pop against the blue — offer badges,
 *    the selected segment's edge, banner accents, the brand-filter chip.
 *  - `tertiary`  → BRAND RED (#C8102E): pure identity — the crown mark, the
 *    "New" ribbon, the launcher and the splash. It is never used for a
 *    destructive action, so red keeps meaning "Maharani", not "warning".
 *  - `error`     → rose, used for failures and "Out of stock" only.
 *
 * Backgrounds are the cool blue-tinted greys from [MaharaniPalette] so white
 * cards sit on one continuous shopping surface while every content surface
 * stays white (or near-black in dark mode). Elevation is carried by surfaces,
 * not shadows, and gradients appear in exactly two places (the app bar and the
 * splash), so the result is colourful and premium rather than neon.
 *
 * Typography intentionally starts from the Material 3 defaults: the web's
 * Poppins is self-hosted with @fontsource, and bundling the Poppins TTFs for
 * Android (OFL licensed) is a design-system follow-up tracked in the migration
 * plan rather than something to fake here.
 */
private val LightColors = lightColorScheme(
  primary = MaharaniPalette.RoyalBlue600,
  onPrimary = MaharaniPalette.White,
  primaryContainer = MaharaniPalette.RoyalBlue50,
  onPrimaryContainer = MaharaniPalette.RoyalBlue800,
  inversePrimary = MaharaniPalette.RoyalBlue200,
  secondary = MaharaniPalette.Saffron500,
  onSecondary = MaharaniPalette.Ink950,
  secondaryContainer = MaharaniPalette.Saffron100,
  onSecondaryContainer = MaharaniPalette.Saffron800,
  // Brand red: identity only (crown, "New" ribbon, splash). Never a failure.
  tertiary = MaharaniPalette.BrandRed600,
  onTertiary = MaharaniPalette.White,
  tertiaryContainer = MaharaniPalette.BrandRed50,
  onTertiaryContainer = MaharaniPalette.BrandRed700,
  background = MaharaniPalette.PageLight,
  onBackground = MaharaniPalette.Ink900,
  surface = MaharaniPalette.White,
  onSurface = MaharaniPalette.Ink900,
  surfaceVariant = MaharaniPalette.Cool100,
  onSurfaceVariant = MaharaniPalette.Ink600,
  surfaceContainerLowest = MaharaniPalette.White,
  surfaceContainerLow = MaharaniPalette.Cool50,
  surfaceContainer = MaharaniPalette.Cool100,
  surfaceContainerHigh = MaharaniPalette.Cool200,
  surfaceContainerHighest = MaharaniPalette.Cool300,
  surfaceTint = MaharaniPalette.RoyalBlue600,
  inverseSurface = MaharaniPalette.Ink900,
  inverseOnSurface = MaharaniPalette.Ink50,
  outline = MaharaniPalette.Cool300,
  outlineVariant = MaharaniPalette.Cool200,
  error = MaharaniPalette.OutOfStockRose,
  onError = MaharaniPalette.White,
  errorContainer = MaharaniPalette.OutOfStockRoseSurface,
  onErrorContainer = MaharaniPalette.OutOfStockRose,
  scrim = MaharaniPalette.Black,
)

private val DarkColors = darkColorScheme(
  primary = MaharaniPalette.RoyalBlue400,
  onPrimary = MaharaniPalette.Ink950,
  primaryContainer = MaharaniPalette.RoyalBlue800,
  onPrimaryContainer = MaharaniPalette.RoyalBlue100,
  inversePrimary = MaharaniPalette.RoyalBlue600,
  secondary = MaharaniPalette.Saffron300,
  onSecondary = MaharaniPalette.Ink950,
  secondaryContainer = MaharaniPalette.Saffron900,
  onSecondaryContainer = MaharaniPalette.Saffron100,
  tertiary = MaharaniPalette.BrandRed400,
  onTertiary = MaharaniPalette.Ink950,
  tertiaryContainer = MaharaniPalette.BrandRed900,
  onTertiaryContainer = MaharaniPalette.BrandRed100,
  background = MaharaniPalette.PageDark,
  onBackground = MaharaniPalette.Ink50,
  surface = MaharaniPalette.SurfaceDark,
  onSurface = MaharaniPalette.Ink50,
  surfaceVariant = MaharaniPalette.SurfaceDarkHigh,
  onSurfaceVariant = MaharaniPalette.Ink300,
  surfaceContainerLowest = MaharaniPalette.PageDark,
  surfaceContainerLow = MaharaniPalette.SurfaceDark,
  surfaceContainer = MaharaniPalette.SurfaceDarkHigh,
  surfaceContainerHigh = Color(0xFF26313E),
  surfaceContainerHighest = Color(0xFF2E3A48),
  surfaceTint = MaharaniPalette.RoyalBlue400,
  inverseSurface = MaharaniPalette.Ink100,
  inverseOnSurface = MaharaniPalette.Ink900,
  outline = Color(0xFF33404E),
  outlineVariant = Color(0xFF26313E),
  error = Color(0xFFFB7185),
  onError = Color(0xFF4C0519),
  errorContainer = Color(0xFF4C0519),
  onErrorContainer = Color(0xFFFFE4E6),
  scrim = MaharaniPalette.Black,
)

/**
 * One radius language for the whole app: cards 16, tiles 12, pills fully round.
 * Screens take these from [MaterialTheme.shapes] rather than rounding ad hoc.
 */
private val MaharaniShapes = Shapes(
  extraSmall = RoundedCornerShape(6.dp),
  small = RoundedCornerShape(10.dp),
  medium = RoundedCornerShape(14.dp),
  large = RoundedCornerShape(16.dp),
  extraLarge = RoundedCornerShape(24.dp),
)

internal val LocalMaharaniExtraColors = staticCompositionLocalOf { LightExtraColors }

/** Extended brand tokens: `MaharaniTheme.colors.action`, `.inStock`, … */
object MaharaniThemeTokens {
  val colors: MaharaniExtraColors
    @Composable
    @ReadOnlyComposable
    get() = LocalMaharaniExtraColors.current
}

@Composable
fun MaharaniTheme(
  darkTheme: Boolean = isSystemInDarkTheme(),
  content: @Composable () -> Unit,
) {
  val extraColors = if (darkTheme) DarkExtraColors else LightExtraColors
  CompositionLocalProvider(LocalMaharaniExtraColors provides extraColors) {
    MaterialTheme(
      colorScheme = if (darkTheme) DarkColors else LightColors,
      typography = MaharaniTypography,
      shapes = MaharaniShapes,
      content = content,
    )
  }
}
