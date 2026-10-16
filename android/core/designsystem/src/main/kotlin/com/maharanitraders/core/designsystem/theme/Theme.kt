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
import androidx.compose.ui.unit.dp

/**
 * Shared web/native Maharani theme. The generated palette is sourced from
 * `design/tokens.json`; semantic aliases below keep every native screen on the
 * same violet, ivory, mint, sky, peach, amber, navy and slate roles as the web.
 * Errors and unavailable stock deliberately use neutral lavender/slate rather
 * than a red-family colour.
 */
private val LightColors = lightColorScheme(
  primary = MaharaniPalette.ActionPrimary,
  onPrimary = MaharaniPalette.ActionOnPrimary,
  primaryContainer = MaharaniPalette.Lavender100,
  onPrimaryContainer = MaharaniPalette.Lavender800,
  inversePrimary = MaharaniPalette.Violet300,
  secondary = MaharaniPalette.Peach700,
  onSecondary = MaharaniPalette.FoundationWhite,
  secondaryContainer = MaharaniPalette.Peach100,
  onSecondaryContainer = MaharaniPalette.Peach800,
  tertiary = MaharaniPalette.Sky700,
  onTertiary = MaharaniPalette.FoundationWhite,
  tertiaryContainer = MaharaniPalette.Sky100,
  onTertiaryContainer = MaharaniPalette.Sky800,
  background = MaharaniPalette.SurfacePage,
  onBackground = MaharaniPalette.TextPrimary,
  surface = MaharaniPalette.SurfaceCard,
  onSurface = MaharaniPalette.TextPrimary,
  surfaceVariant = MaharaniPalette.Slate100,
  onSurfaceVariant = MaharaniPalette.TextSecondary,
  surfaceContainerLowest = MaharaniPalette.SurfaceCard,
  surfaceContainerLow = MaharaniPalette.SurfaceSubtle,
  surfaceContainer = MaharaniPalette.Slate100,
  surfaceContainerHigh = MaharaniPalette.Slate200,
  surfaceContainerHighest = MaharaniPalette.Slate300,
  surfaceTint = MaharaniPalette.ActionPrimary,
  inverseSurface = MaharaniPalette.Navy900,
  inverseOnSurface = MaharaniPalette.FoundationWhite,
  outline = MaharaniPalette.Slate500,
  outlineVariant = MaharaniPalette.SurfaceBorder,
  error = MaharaniPalette.StatusErrorIcon,
  onError = MaharaniPalette.FoundationWhite,
  errorContainer = MaharaniPalette.StatusErrorSurface,
  onErrorContainer = MaharaniPalette.StatusErrorText,
  scrim = MaharaniPalette.FoundationBlack,
)

private val DarkColors = darkColorScheme(
  primary = MaharaniPalette.Violet300,
  onPrimary = MaharaniPalette.Violet950,
  primaryContainer = MaharaniPalette.Violet900,
  onPrimaryContainer = MaharaniPalette.Violet100,
  inversePrimary = MaharaniPalette.Violet600,
  secondary = MaharaniPalette.Peach300,
  onSecondary = MaharaniPalette.Peach950,
  secondaryContainer = MaharaniPalette.Peach950,
  onSecondaryContainer = MaharaniPalette.Peach100,
  tertiary = MaharaniPalette.Sky300,
  onTertiary = MaharaniPalette.Sky950,
  tertiaryContainer = MaharaniPalette.Sky950,
  onTertiaryContainer = MaharaniPalette.Sky100,
  background = MaharaniPalette.Navy950,
  onBackground = MaharaniPalette.Navy50,
  surface = MaharaniPalette.Navy900,
  onSurface = MaharaniPalette.Navy50,
  surfaceVariant = MaharaniPalette.Navy800,
  onSurfaceVariant = MaharaniPalette.Navy300,
  surfaceContainerLowest = MaharaniPalette.Navy950,
  surfaceContainerLow = MaharaniPalette.Navy900,
  surfaceContainer = MaharaniPalette.Navy800,
  surfaceContainerHigh = MaharaniPalette.Navy700,
  surfaceContainerHighest = MaharaniPalette.Slate900,
  surfaceTint = MaharaniPalette.Violet300,
  inverseSurface = MaharaniPalette.Navy100,
  inverseOnSurface = MaharaniPalette.Navy900,
  outline = MaharaniPalette.Navy500,
  outlineVariant = MaharaniPalette.Navy700,
  error = MaharaniPalette.Lavender300,
  onError = MaharaniPalette.Lavender950,
  errorContainer = MaharaniPalette.Lavender950,
  onErrorContainer = MaharaniPalette.Lavender100,
  scrim = MaharaniPalette.FoundationBlack,
)

/** One radius language for the whole app, mirroring the web's rounded cards. */
private val MaharaniShapes = Shapes(
  extraSmall = RoundedCornerShape(6.dp),
  small = RoundedCornerShape(10.dp),
  medium = RoundedCornerShape(14.dp),
  large = RoundedCornerShape(16.dp),
  extraLarge = RoundedCornerShape(24.dp),
)

internal val LocalMaharaniExtraColors = staticCompositionLocalOf { LightExtraColors }

/** Extended semantic roles used by reusable Compose components. */
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
