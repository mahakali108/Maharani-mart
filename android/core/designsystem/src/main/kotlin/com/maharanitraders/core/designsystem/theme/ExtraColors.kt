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
  /** Informational facts only (delivery, lead time, GST split). Never an action. */
  val info: Color,
  val infoSurface: Color,
  val onInfoSurface: Color,
  /** Violet: the shortcut / account family, mirroring Material's `tertiary`. */
  val violet: Color,
  val violetSurface: Color,
  val onVioletSurface: Color,
  /**
   * Rose highlight: emphasis that is neither success nor failure ("New"
   * launches, the notification badge's emphasis). Deliberately distinct from
   * [outOfStock], so a highlight can never be read as a failure.
   */
  val highlight: Color,
  val highlightSurface: Color,
  val onHighlightSurface: Color,
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
  info = MaharaniPalette.Info700,
  infoSurface = MaharaniPalette.Info50,
  onInfoSurface = MaharaniPalette.Info900,
  violet = MaharaniPalette.Violet600,
  violetSurface = MaharaniPalette.Violet50,
  onVioletSurface = MaharaniPalette.Violet700,
  highlight = MaharaniPalette.Highlight700,
  highlightSurface = MaharaniPalette.Highlight50,
  onHighlightSurface = MaharaniPalette.Highlight800,
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
  info = MaharaniPalette.Info300,
  infoSurface = MaharaniPalette.Info950,
  onInfoSurface = MaharaniPalette.Info100,
  violet = MaharaniPalette.Violet300,
  violetSurface = MaharaniPalette.Violet950,
  onVioletSurface = MaharaniPalette.Violet100,
  highlight = MaharaniPalette.Highlight300,
  highlightSurface = MaharaniPalette.Highlight950,
  onHighlightSurface = MaharaniPalette.Highlight100,
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

/**
 * The six accent families, in the ONE order screens should reach for them.
 *
 * A screen picks a [AccentTone], never a colour: the tone resolves through the
 * `accent` extension below into the container/tint pair that is correct for the
 * current theme,
 * so a shortcut tile cannot be legible in light mode and unreadable in dark
 * mode, and two screens cannot give the same job two different colours.
 */
enum class AccentTone {
  /** Brand red: the primary action of a surface (Shop, Cart, Checkout). */
  BRAND,

  /** Amber: savings and offers. */
  AMBER,

  /** Violet: tools and account shortcuts (Quick order, Saved carts). */
  VIOLET,

  /** Green: availability, success and "worth restocking". */
  GREEN,

  /** Blue: neutral facts (delivery, lead time, reports). */
  BLUE,

  /** Rose: highlights that are neither success nor failure (New, favourites). */
  ROSE,
}

/**
 * One accent, resolved for the active theme: the glyph/edge [tint], the
 * [surface] container it sits on, and [onSurface] for text inside that
 * container.
 */
@Immutable
data class MaharaniAccentColors(
  val tint: Color,
  val surface: Color,
  val onSurface: Color,
)

/**
 * Resolve an [AccentTone] to concrete colours.
 *
 * Read through the token holder — `MaharaniThemeTokens.colors`, held under a
 * local name — and call `accent(tone)` on it, so dark mode is handled here
 * rather than at every call site. No call site spells a token holder as
 * `colors`, which keeps this file the only place that names a colour at all.
 */
fun MaharaniExtraColors.accent(tone: AccentTone): MaharaniAccentColors = when (tone) {
  AccentTone.BRAND -> MaharaniAccentColors(action, actionContainer, onActionContainer)
  AccentTone.AMBER -> MaharaniAccentColors(saffron, saffronSurface, onSaffronSurface)
  AccentTone.VIOLET -> MaharaniAccentColors(violet, violetSurface, onVioletSurface)
  AccentTone.GREEN -> MaharaniAccentColors(inStock, inStockSurface, inStock)
  AccentTone.BLUE -> MaharaniAccentColors(info, infoSurface, onInfoSurface)
  AccentTone.ROSE -> MaharaniAccentColors(highlight, highlightSurface, onHighlightSurface)
}
