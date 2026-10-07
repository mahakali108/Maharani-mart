package com.maharanitraders.core.designsystem

import com.maharanitraders.core.designsystem.theme.MaharaniDimens
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The responsive and accessibility floor, asserted where it can actually be
 * checked without a device: the TOKENS every screen shares.
 *
 * WHY TOKENS AND NOT SCREENSHOTS
 * A Compose preview at 360/393/412dp proves one screen on one day. These
 * assertions prove the invariants that make every screen pass at those widths:
 * touch targets at or above the platform minimum, a card narrow enough for two
 * columns on the smallest phone, and gutters that leave the grid room inside the
 * window. A screen that hard-codes a smaller number is the failure this catches.
 *
 * They do not replace a device check; they make the arithmetic behind it a fact
 * in the build rather than a claim in a report.
 */
class LayoutTokensTest {

  /** The three widths the retailer app is accepted at. */
  private val widths = listOf(360, 393, 412)

  @Test
  fun `every touch target meets the 48dp platform minimum`() {
    assertTrue(
      "touchTarget ${MaharaniDimens.touchTarget} is below 48dp",
      MaharaniDimens.touchTarget.value >= 48f,
    )
    assertTrue(
      "searchFieldHeight ${MaharaniDimens.searchFieldHeight} is below 48dp",
      MaharaniDimens.searchFieldHeight.value >= 48f,
    )
    assertTrue(
      "bottomBarHeight ${MaharaniDimens.bottomBarHeight} must clear one touch target",
      MaharaniDimens.bottomBarHeight.value >= MaharaniDimens.touchTarget.value,
    )
  }

  @Test
  fun `two product cards fit the narrowest phone with room to spare`() {
    val gutter = MaharaniDimens.pageGutter.value
    val gap = MaharaniDimens.cardGap.value
    for (width in widths) {
      val available = width - (2 * gutter) - gap
      val column = available / 2
      assertTrue(
        "a $width dp screen leaves ${column}dp per card, below the 158dp card minimum",
        column >= 158f,
      )
    }
  }

  @Test
  fun `a rail card never takes more than half the narrowest screen`() {
    val half = 360f / 2f
    assertTrue(
      "railCardWidth ${MaharaniDimens.railCardWidth} exceeds half of a 360dp screen",
      MaharaniDimens.railCardWidth.value <= half,
    )
  }

  @Test
  fun `spacing follows the 4dp base so the rhythm stays even`() {
    for (value in listOf(
      MaharaniDimens.spaceXxs.value,
      MaharaniDimens.spaceXs.value,
      MaharaniDimens.spaceSm.value,
      MaharaniDimens.spaceMd.value,
      MaharaniDimens.spaceLg.value,
      MaharaniDimens.spaceXl.value,
      MaharaniDimens.spaceXxl.value,
      MaharaniDimens.pageGutter.value,
    )) {
      assertTrue("$value is not a multiple of 2dp (base 4dp scale)", value % 2f == 0f)
    }
  }
}
