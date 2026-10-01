package com.maharanitraders.core.designsystem.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color

/**
 * Maharani Traders Material 3 theme.
 *
 * Mapping rationale (matches the web application):
 *  - `primary`  → brand red (#C8102E): app chrome, headers, wordmark surfaces.
 *  - `secondary`→ action blue (#2874F0): buy CTAs, links and selection — the
 *    web's retailer theme uses blue for exactly these.
 *  - `error`    → rose, used for failures and "Out of stock".
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
  secondary = MaharaniPalette.ActionBlue500,
  onSecondary = MaharaniPalette.White,
  secondaryContainer = MaharaniPalette.ActionBlue50,
  onSecondaryContainer = MaharaniPalette.ActionBlue700,
  tertiary = MaharaniPalette.BrandRed500,
  onTertiary = MaharaniPalette.White,
  background = MaharaniPalette.Ink50,
  onBackground = MaharaniPalette.Ink900,
  surface = MaharaniPalette.White,
  onSurface = MaharaniPalette.Ink900,
  surfaceVariant = MaharaniPalette.Ink100,
  onSurfaceVariant = MaharaniPalette.Ink700,
  outline = MaharaniPalette.Ink200,
  outlineVariant = MaharaniPalette.Ink100,
  error = MaharaniPalette.OutOfStockRose,
  onError = MaharaniPalette.White,
  errorContainer = MaharaniPalette.OutOfStockRoseSurface,
  onErrorContainer = MaharaniPalette.OutOfStockRose,
)

private val DarkColors = darkColorScheme(
  primary = MaharaniPalette.BrandRed500,
  onPrimary = MaharaniPalette.White,
  primaryContainer = MaharaniPalette.BrandRed700,
  onPrimaryContainer = MaharaniPalette.BrandRed50,
  secondary = MaharaniPalette.ActionBlue500,
  onSecondary = MaharaniPalette.White,
  secondaryContainer = MaharaniPalette.ActionBlue700,
  onSecondaryContainer = MaharaniPalette.ActionBlue50,
  tertiary = MaharaniPalette.BrandRed400,
  onTertiary = MaharaniPalette.Ink950,
  background = MaharaniPalette.Ink950,
  onBackground = MaharaniPalette.Ink50,
  surface = Color(0xFF1C1C1C),
  onSurface = MaharaniPalette.Ink50,
  surfaceVariant = Color(0xFF2A2A2A),
  onSurfaceVariant = MaharaniPalette.Ink200,
  outline = Color(0xFF3D3D3D),
  outlineVariant = Color(0xFF2A2A2A),
  error = Color(0xFFFB7185),
  onError = Color(0xFF4C0519),
  errorContainer = Color(0xFF4C0519),
  onErrorContainer = Color(0xFFFFE4E6),
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
      content = content,
    )
  }
}
