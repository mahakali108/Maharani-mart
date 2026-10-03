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
 * Mapping rationale (native commerce chrome over the existing web tokens):
 *  - `primary`  → the marketplace blue (#2874F0 family): shopping app bar,
 *    selection, links and progress — the colour the web already reserves for
 *    retailer buy flows, promoted to the app's primary surface colour.
 *  - `secondary`→ brand red (#C8102E): the crown mark, identity accents and
 *    "New" ribbons. The launcher and splash keep the same red, so the brand
 *    stays one mark across icon, splash and app.
 *  - `tertiary` → saffron: the restrained wholesale accent.
 *  - `error`    → rose, used for failures and "Out of stock".
 *
 * Backgrounds are the cool blue-tinted greys from [MaharaniPalette] so white
 * cards sit on one continuous shopping surface, Flipkart-style, while every
 * content surface stays white (or near-black in dark mode).
 *
 * Typography intentionally starts from the Material 3 defaults: the web's
 * Poppins is self-hosted with @fontsource, and bundling the Poppins TTFs for
 * Android (OFL licensed) is a design-system follow-up tracked in the migration
 * plan rather than something to fake here.
 */
private val LightColors = lightColorScheme(
  primary = MaharaniPalette.ActionBlue600,
  onPrimary = MaharaniPalette.White,
  primaryContainer = MaharaniPalette.ActionBlue100,
  onPrimaryContainer = MaharaniPalette.ActionBlue900,
  inversePrimary = MaharaniPalette.ActionBlue200,
  secondary = MaharaniPalette.BrandRed600,
  onSecondary = MaharaniPalette.White,
  secondaryContainer = MaharaniPalette.BrandRed50,
  onSecondaryContainer = MaharaniPalette.BrandRed700,
  tertiary = MaharaniPalette.Saffron500,
  onTertiary = MaharaniPalette.Ink950,
  tertiaryContainer = MaharaniPalette.Saffron100,
  onTertiaryContainer = MaharaniPalette.Saffron700,
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
  surfaceTint = MaharaniPalette.ActionBlue600,
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
  primary = MaharaniPalette.ActionBlue400,
  onPrimary = MaharaniPalette.Ink950,
  primaryContainer = MaharaniPalette.ActionBlue800,
  onPrimaryContainer = MaharaniPalette.ActionBlue100,
  inversePrimary = MaharaniPalette.ActionBlue600,
  secondary = MaharaniPalette.BrandRed400,
  onSecondary = MaharaniPalette.Ink950,
  secondaryContainer = MaharaniPalette.BrandRed900,
  onSecondaryContainer = MaharaniPalette.BrandRed100,
  tertiary = MaharaniPalette.Saffron300,
  onTertiary = MaharaniPalette.Ink950,
  tertiaryContainer = MaharaniPalette.Saffron700,
  onTertiaryContainer = MaharaniPalette.Saffron100,
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
  surfaceTint = MaharaniPalette.ActionBlue400,
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
