package com.maharanitraders.core.designsystem.theme

import androidx.compose.runtime.Immutable
import androidx.compose.ui.graphics.Color

/**
 * Semantic roles not represented by Material 3's [androidx.compose.material3.ColorScheme].
 * Every value comes from the generated web/native registry in [MaharaniPalette],
 * so screens do not pick ad-hoc colours and light/dark mode stays coordinated.
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
  /** Sky information for delivery, lead time and other neutral facts. */
  val info: Color,
  val infoSurface: Color,
  val onInfoSurface: Color,
  /** Supporting violet identity for tools and account shortcuts. */
  val violet: Color,
  val violetSurface: Color,
  val onVioletSurface: Color,
  /** Quiet lavender emphasis for favourites and selected supporting content. */
  val highlight: Color,
  val highlightSurface: Color,
  val onHighlightSurface: Color,
  /** Maharani crown/wordmark accent, recoloured to the approved violet identity. */
  val brandMark: Color,
  val brandMarkSurface: Color,
  /** Peach for configured offers and merchandising. */
  val peach: Color,
  val peachSurface: Color,
  val onPeachSurface: Color,
  /** Amber for warnings and time-sensitive states, never red. */
  val amber: Color,
  val amberSurface: Color,
  val onAmberSurface: Color,
  /** The app bar's subtle two-stop violet treatment. */
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
  /** Neutral tile behind product artwork while it loads or when it is missing. */
  val imagePlaceholder: Color,
  val onImagePlaceholder: Color,
  /** Scrim under server-provided banner artwork. */
  val scrim: Color,
)

internal val LightExtraColors = MaharaniExtraColors(
  action = MaharaniPalette.ActionPrimary,
  actionContainer = MaharaniPalette.Violet50,
  onActionContainer = MaharaniPalette.Violet800,
  inStock = MaharaniPalette.StatusSuccessText,
  inStockSurface = MaharaniPalette.StatusSuccessSurface,
  outOfStock = MaharaniPalette.StatusOutOfStockText,
  outOfStockSurface = MaharaniPalette.StatusOutOfStockSurface,
  warning = MaharaniPalette.StatusWarningText,
  warningSurface = MaharaniPalette.StatusWarningSurface,
  info = MaharaniPalette.StatusInfoText,
  infoSurface = MaharaniPalette.StatusInfoSurface,
  onInfoSurface = MaharaniPalette.Sky900,
  violet = MaharaniPalette.Violet600,
  violetSurface = MaharaniPalette.Lavender50,
  onVioletSurface = MaharaniPalette.Lavender800,
  highlight = MaharaniPalette.Lavender700,
  highlightSurface = MaharaniPalette.Lavender100,
  onHighlightSurface = MaharaniPalette.Lavender800,
  brandMark = MaharaniPalette.ActionPrimary,
  brandMarkSurface = MaharaniPalette.Violet50,
  peach = MaharaniPalette.OfferText,
  peachSurface = MaharaniPalette.OfferSurface,
  onPeachSurface = MaharaniPalette.Peach800,
  amber = MaharaniPalette.StatusWarningText,
  amberSurface = MaharaniPalette.StatusWarningSurface,
  onAmberSurface = MaharaniPalette.Amber800,
  appBarStart = MaharaniPalette.Violet700,
  appBarEnd = MaharaniPalette.Violet600,
  onAppBar = MaharaniPalette.FoundationWhite,
  onAppBarMuted = MaharaniPalette.FoundationWhite.copy(alpha = 0.85f),
  appBarField = MaharaniPalette.FoundationWhite,
  onAppBarField = MaharaniPalette.TextPrimary,
  appBarFieldHint = MaharaniPalette.TextSecondary,
  skeletonBase = MaharaniPalette.Slate200,
  skeletonHighlight = MaharaniPalette.Slate100,
  imagePlaceholder = MaharaniPalette.Slate100,
  onImagePlaceholder = MaharaniPalette.Navy500,
  scrim = MaharaniPalette.FoundationBlack.copy(alpha = 0.60f),
)

internal val DarkExtraColors = MaharaniExtraColors(
  action = MaharaniPalette.Violet300,
  actionContainer = MaharaniPalette.Violet950,
  onActionContainer = MaharaniPalette.Violet100,
  inStock = MaharaniPalette.Mint200,
  inStockSurface = MaharaniPalette.Mint950,
  outOfStock = MaharaniPalette.Slate200,
  outOfStockSurface = MaharaniPalette.Slate900,
  warning = MaharaniPalette.Amber300,
  warningSurface = MaharaniPalette.Amber950,
  info = MaharaniPalette.Sky300,
  infoSurface = MaharaniPalette.Sky950,
  onInfoSurface = MaharaniPalette.Sky100,
  violet = MaharaniPalette.Violet300,
  violetSurface = MaharaniPalette.Violet950,
  onVioletSurface = MaharaniPalette.Violet100,
  highlight = MaharaniPalette.Lavender300,
  highlightSurface = MaharaniPalette.Lavender950,
  onHighlightSurface = MaharaniPalette.Lavender100,
  brandMark = MaharaniPalette.Violet300,
  brandMarkSurface = MaharaniPalette.Violet950,
  peach = MaharaniPalette.Peach300,
  peachSurface = MaharaniPalette.Peach950,
  onPeachSurface = MaharaniPalette.Peach100,
  amber = MaharaniPalette.Amber300,
  amberSurface = MaharaniPalette.Amber950,
  onAmberSurface = MaharaniPalette.Amber100,
  appBarStart = MaharaniPalette.Violet950,
  appBarEnd = MaharaniPalette.Violet900,
  onAppBar = MaharaniPalette.FoundationWhite,
  onAppBarMuted = MaharaniPalette.FoundationWhite.copy(alpha = 0.70f),
  appBarField = MaharaniPalette.Navy900,
  onAppBarField = MaharaniPalette.Navy50,
  appBarFieldHint = MaharaniPalette.Navy300,
  skeletonBase = MaharaniPalette.Slate800,
  skeletonHighlight = MaharaniPalette.Slate700,
  imagePlaceholder = MaharaniPalette.Slate900,
  onImagePlaceholder = MaharaniPalette.Navy300,
  scrim = MaharaniPalette.FoundationBlack.copy(alpha = 0.70f),
)

/** Semantic accents for reusable tiles and icon surfaces. */
enum class AccentTone {
  /** Maharani's violet primary action and identity. */
  BRAND,
  /** Amber for balances and warning-related metrics. */
  AMBER,
  /** Peach for configured offers and coupons. */
  PEACH,
  /** Supporting violet for tools and account shortcuts. */
  VIOLET,
  /** Mint for history and positive states. */
  MINT,
  /** Sky for directory, support and informational routes. */
  SKY,
  /** Lavender for favourites and quiet emphasis. */
  LAVENDER,
}

/** Container/tint pair resolved for the active theme. */
@Immutable
data class MaharaniAccentColors(
  val tint: Color,
  val surface: Color,
  val onSurface: Color,
)

/** Resolve an accent once so shared components stay consistent in both themes. */
fun MaharaniExtraColors.accent(tone: AccentTone): MaharaniAccentColors = when (tone) {
  AccentTone.BRAND -> MaharaniAccentColors(action, actionContainer, onActionContainer)
  AccentTone.AMBER -> MaharaniAccentColors(amber, amberSurface, onAmberSurface)
  AccentTone.PEACH -> MaharaniAccentColors(peach, peachSurface, onPeachSurface)
  AccentTone.VIOLET -> MaharaniAccentColors(violet, violetSurface, onVioletSurface)
  AccentTone.MINT -> MaharaniAccentColors(inStock, inStockSurface, inStock)
  AccentTone.SKY -> MaharaniAccentColors(info, infoSurface, onInfoSurface)
  AccentTone.LAVENDER -> MaharaniAccentColors(highlight, highlightSurface, onHighlightSurface)
}
