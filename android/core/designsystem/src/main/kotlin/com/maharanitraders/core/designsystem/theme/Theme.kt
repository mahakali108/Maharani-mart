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
 * Maharani Traders Material 3 theme — the native shopping UI.
 *
 * Mapping rationale (MAHARANI RED, over the existing web tokens):
 *  - `primary`   → BRAND RED ([MaharaniPalette.BrandRed600], the same #C8102E
 *    as the launcher asset and the web's `primary`): app bar, the selected
 *    segment, bottom-navigation selection, primary buttons, links and progress.
 *    One red family carries the whole commerce chrome, so "where am I" and
 *    "what can I tap" are the same colour everywhere.
 *  - `primaryContainer` → the soft pink supporting surface
 *    ([MaharaniPalette.BrandRed50]) used behind selected tiles and the
 *    bottom-navigation indicator.
 *  - `secondary` → WARM AMBER ([MaharaniPalette.Saffron500]): the SAVINGS
 *    family — offer badges, wholesale emphasis, banner accents.
 *  - `tertiary`  → VIOLET ([MaharaniPalette.Violet600]): the SHORTCUT/account
 *    family — Quick order, Saved carts, Security, Reorder and the "Starting
 *    soon" coupon state.
 *  - `error`     → rose, used for failures and "Out of stock" only.
 *
 * Beyond Material's slots the app carries three more coherent families in
 * [MaharaniExtraColors], so screens never pick a colour ad hoc:
 *  - GREEN  `inStock`      — availability and success;
 *  - BLUE   `info`         — neutral facts (delivery, lead time, GST split);
 *  - ROSE   `highlight`    — emphasis that is neither success nor failure
 *    ("New" launches, notification badges).
 *
 * Backgrounds are WARM NEUTRALS ([MaharaniPalette.NeutralPage] and friends) so
 * white cards sit on one continuous surface while every content surface stays
 * white (or near-black in dark mode). Blue is never chrome — it is only ever
 * the `info` fact token — so the biggest colour on screen stays the brand red,
 * the second the page itself, and the accents (amber, violet, green, blue,
 * rose) each keep exactly one job.
 * Elevation is carried by surfaces, not shadows, and gradients appear in
 * exactly two places (the app bar and the splash).
 *
 * Typography intentionally starts from the Material 3 defaults: the web's
 * Poppins is self-hosted with @fontsource, and bundling the Poppins TTFs for
 * Android (OFL licensed) is a design-system follow-up tracked in the migration
 * plan rather than something to fake here.
 */
private val LightColors = lightColorScheme(
  primary = MaharaniPalette.BrandRed600,
  onPrimary = MaharaniPalette.White,
  primaryContainer = MaharaniPalette.BrandRed50,
  onPrimaryContainer = MaharaniPalette.BrandRed700,
  inversePrimary = MaharaniPalette.BrandRed200,
  secondary = MaharaniPalette.Saffron500,
  onSecondary = MaharaniPalette.Ink950,
  secondaryContainer = MaharaniPalette.Saffron100,
  onSecondaryContainer = MaharaniPalette.Saffron800,
  // Violet: the SHORTCUT / account identity family (Quick order, Saved carts,
  // Security, Reorder). Red stays the action colour, amber the savings colour,
  // violet the "tools" colour — one hue per job, no screen inventing its own.
  tertiary = MaharaniPalette.Violet600,
  onTertiary = MaharaniPalette.White,
  tertiaryContainer = MaharaniPalette.Violet50,
  onTertiaryContainer = MaharaniPalette.Violet700,
  background = MaharaniPalette.NeutralPage,
  onBackground = MaharaniPalette.Ink900,
  surface = MaharaniPalette.White,
  onSurface = MaharaniPalette.Ink900,
  surfaceVariant = MaharaniPalette.Neutral100,
  onSurfaceVariant = MaharaniPalette.Ink600,
  surfaceContainerLowest = MaharaniPalette.White,
  surfaceContainerLow = MaharaniPalette.Neutral50,
  surfaceContainer = MaharaniPalette.Neutral100,
  surfaceContainerHigh = MaharaniPalette.Neutral200,
  surfaceContainerHighest = MaharaniPalette.Neutral300,
  surfaceTint = MaharaniPalette.BrandRed600,
  inverseSurface = MaharaniPalette.Ink900,
  inverseOnSurface = MaharaniPalette.Ink50,
  outline = MaharaniPalette.Neutral300,
  outlineVariant = MaharaniPalette.Neutral200,
  error = MaharaniPalette.OutOfStockRose,
  onError = MaharaniPalette.White,
  errorContainer = MaharaniPalette.OutOfStockRoseSurface,
  onErrorContainer = MaharaniPalette.OutOfStockRose,
  scrim = MaharaniPalette.Black,
)

private val DarkColors = darkColorScheme(
  primary = MaharaniPalette.BrandRed300,
  onPrimary = MaharaniPalette.Ink950,
  primaryContainer = MaharaniPalette.BrandRed900,
  onPrimaryContainer = MaharaniPalette.BrandRed100,
  inversePrimary = MaharaniPalette.BrandRed600,
  secondary = MaharaniPalette.Saffron300,
  onSecondary = MaharaniPalette.Ink950,
  secondaryContainer = MaharaniPalette.Saffron900,
  onSecondaryContainer = MaharaniPalette.Saffron100,
  tertiary = MaharaniPalette.Violet300,
  onTertiary = MaharaniPalette.Ink950,
  tertiaryContainer = MaharaniPalette.Violet900,
  onTertiaryContainer = MaharaniPalette.Violet100,
  background = MaharaniPalette.PageDark,
  onBackground = MaharaniPalette.Ink50,
  surface = MaharaniPalette.SurfaceDark,
  onSurface = MaharaniPalette.Ink50,
  surfaceVariant = MaharaniPalette.SurfaceDarkHigh,
  onSurfaceVariant = MaharaniPalette.Ink300,
  surfaceContainerLowest = MaharaniPalette.PageDark,
  surfaceContainerLow = MaharaniPalette.SurfaceDark,
  surfaceContainer = MaharaniPalette.SurfaceDarkHigh,
  surfaceContainerHigh = Color(0xFF2E292C),
  surfaceContainerHighest = Color(0xFF393235),
  surfaceTint = MaharaniPalette.BrandRed300,
  inverseSurface = MaharaniPalette.Ink100,
  inverseOnSurface = MaharaniPalette.Ink900,
  outline = Color(0xFF3D373A),
  outlineVariant = Color(0xFF2E292C),
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
