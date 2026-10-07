package com.maharanitraders.core.designsystem.theme

import androidx.compose.ui.unit.dp

/**
 * One spacing and sizing language for the native shopping UI.
 *
 * Screens compose these instead of ad-hoc dp literals, so a card on the home
 * rail, a card in the catalogue grid and a card on the product detail screen
 * breathe identically. Touch targets never go below [touchTarget] (the
 * platform accessibility minimum), which is also why text-only affordances are
 * padded out rather than left at their content height.
 */
object MaharaniDimens {

  // Spacing scale (4 dp base).
  val spaceXxs = 2.dp
  val spaceXs = 4.dp
  val spaceSm = 8.dp
  val spaceMd = 12.dp
  val spaceLg = 16.dp
  val spaceXl = 24.dp
  val spaceXxl = 32.dp

  /** Page gutter: the margin every screen keeps from the window edge. */
  val pageGutter = 16.dp

  /** Grid/rail gap between cards. */
  val cardGap = 10.dp

  /**
   * Inside a product card.
   *
   * 10dp rather than the 12dp page rhythm: at 360dp two cards leave ~159dp
   * each, and those 4dp decide whether a two-line product name fits or clips.
   * The card and its skeleton read the same token, so the loading grid and the
   * loaded grid have identical geometry and the images do not jump.
   */
  val cardPadding = 10.dp

  // Corner radii (mirror MaterialTheme.shapes; exposed for Canvas-drawn art).
  val radiusCard = 16.dp
  val radiusTile = 12.dp
  val radiusField = 26.dp
  val radiusChip = 8.dp
  val radiusPill = 999.dp

  // Touch and control sizes.
  val touchTarget = 48.dp

  /**
   * The search field is ALSO a touch target — it is the control every catalogue
   * visit starts with — so it carries the platform minimum rather than the 46 dp
   * that a pure text box would need. Two dp is invisible in a screenshot and is
   * the difference between meeting the accessibility minimum and missing it.
   */
  val searchFieldHeight = 48.dp
  val bottomBarHeight = 64.dp

  // Cards and imagery.
  val productImageRatio = 1f
  val railCardWidth = 168.dp
  val categoryTileWidth = 88.dp
  val categoryTileImage = 64.dp
  val brandTileWidth = 84.dp
  val bannerHeight = 156.dp
  val heroImageHeight = 300.dp

  /** Card elevation kept deliberately low: depth from surfaces, not shadows. */
  val cardElevation = 1.dp
  val appBarElevation = 2.dp
}
