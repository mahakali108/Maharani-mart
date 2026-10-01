package com.maharanitraders.core.designsystem.theme

import androidx.compose.material3.Typography
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

/**
 * Material 3 type scale with the hierarchy the web uses for dense B2B screens:
 * compact titles, readable body, unambiguous money figures.
 *
 * Font family stays the platform default for now (see `MaharaniTheme`).
 * Sizes respect the user's font-scale setting — no screen may disable it.
 */
val MaharaniTypography = Typography(
  displaySmall = TextStyle(fontSize = 30.sp, lineHeight = 36.sp, fontWeight = FontWeight.SemiBold),
  headlineMedium = TextStyle(fontSize = 24.sp, lineHeight = 30.sp, fontWeight = FontWeight.SemiBold),
  headlineSmall = TextStyle(fontSize = 20.sp, lineHeight = 26.sp, fontWeight = FontWeight.SemiBold),
  titleLarge = TextStyle(fontSize = 18.sp, lineHeight = 24.sp, fontWeight = FontWeight.SemiBold),
  titleMedium = TextStyle(fontSize = 16.sp, lineHeight = 22.sp, fontWeight = FontWeight.Medium),
  titleSmall = TextStyle(fontSize = 14.sp, lineHeight = 20.sp, fontWeight = FontWeight.Medium),
  bodyLarge = TextStyle(fontSize = 16.sp, lineHeight = 24.sp),
  bodyMedium = TextStyle(fontSize = 14.sp, lineHeight = 20.sp),
  bodySmall = TextStyle(fontSize = 12.sp, lineHeight = 16.sp),
  labelLarge = TextStyle(fontSize = 14.sp, lineHeight = 20.sp, fontWeight = FontWeight.Medium),
  labelMedium = TextStyle(fontSize = 12.sp, lineHeight = 16.sp, fontWeight = FontWeight.Medium),
  labelSmall = TextStyle(fontSize = 11.sp, lineHeight = 14.sp, fontWeight = FontWeight.Medium),
)
