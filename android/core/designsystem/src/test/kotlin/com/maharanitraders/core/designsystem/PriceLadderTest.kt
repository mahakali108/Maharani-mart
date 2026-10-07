package com.maharanitraders.core.designsystem

import com.maharanitraders.core.designsystem.components.nextSlabHint
import com.maharanitraders.core.designsystem.components.quantityLadder
import com.maharanitraders.core.model.PriceTier
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The quantity ladder is the one place a slab range is turned into words, so
 * these cases pin the conversion that a shopkeeper would otherwise be charged
 * for: the server stores a HALF-OPEN `[min, max)` range, and printing the
 * stored max would advertise a rate the cart will not honour.
 */
class PriceLadderTest {

  private fun tier(min: Int, max: Int?, paise: Long) = PriceTier(minQuantity = min, maxQuantity = max, unitPricePaise = paise)

  @Test
  fun `a single slab is not a ladder`() {
    assertTrue(quantityLadder(listOf(tier(1, null, 8_000))).isEmpty())
    assertTrue(quantityLadder(emptyList()).isEmpty())
  }

  @Test
  fun `an exclusive max is printed as the last quantity it covers`() {
    val rows = quantityLadder(listOf(tier(1, 7, 8_000), tier(7, 21, 7_500), tier(21, null, 7_000)))
    assertEquals(listOf("1–6 pcs", "7–20 pcs", "21+ pcs"), rows.map { it.rangeLabel })
    assertEquals(listOf("₹80 / pc", "₹75 / pc", "₹70 / pc"), rows.map { it.priceLabel })
  }

  @Test
  fun `a one-piece slab is singular and never prints an empty range`() {
    val rows = quantityLadder(listOf(tier(1, 2, 8_000), tier(2, null, 7_000)))
    assertEquals("1 pc", rows.first().rangeLabel)
    assertEquals("2+ pcs", rows.last().rangeLabel)
  }

  @Test
  fun `the ladder keeps the server's own order and rates`() {
    val rows = quantityLadder(listOf(tier(50, null, 6_000), tier(1, 50, 8_000)))
    // No sorting on the device: the sequence is the engine's, and reordering it
    // could put a cheaper slab under a smaller quantity.
    assertEquals("50+ pcs", rows.first().rangeLabel)
    assertEquals("₹60 / pc", rows.first().priceLabel)
  }

  @Test
  fun `the next-slab hint is only offered when the next slab is cheaper`() {
    val tiers = listOf(tier(1, 7, 8_000), tier(7, 21, 7_500), tier(21, null, 7_000))
    assertEquals("7+ pc at ₹75 / pc", nextSlabHint(tiers, 4))
    assertEquals("21+ pc at ₹70 / pc", nextSlabHint(tiers, 8))
    // Already on the last (cheapest) slab: nothing left to promise.
    assertNull(nextSlabHint(tiers, 25))
  }

  @Test
  fun `a ladder whose higher slabs are not cheaper is not advertised as an offer`() {
    val inverted = listOf(tier(1, 5, 8_000), tier(5, null, 9_000))
    assertNull(nextSlabHint(inverted, 2))
  }

  @Test
  fun `a zero or negative quantity has no slab to hint at`() {
    val tiers = listOf(tier(1, 7, 8_000), tier(7, null, 7_500))
    assertNull(nextSlabHint(tiers, 0))
    assertNull(nextSlabHint(tiers, -3))
    assertNull(nextSlabHint(emptyList(), 4))
  }
}
