package com.maharanitraders.feature.orders

import com.maharanitraders.core.model.PackAvailability
import com.maharanitraders.core.model.ProductDetail
import com.maharanitraders.core.model.ProductPackDetail
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Buy again is the screen that could most easily lie about money, so these cases
 * pin the two rules that matter:
 *
 *   1. the candidate list is THIS retailer's own order history — frequency and
 *      recency from real rows, nothing synthesised;
 *   2. a candidate is offered only after the CURRENT catalogue row has been
 *      read, and a pack that is gone, out of stock or unpriced is not offered.
 */
class BuyAgainTest {

  private fun item(
    packId: String,
    productId: String = "product-$packId",
    pieces: Int = 6,
  ) = OrderItem(
    id = "item-$packId",
    productId = productId,
    packId = packId,
    productName = "Product $packId",
    packName = "1 kg",
    quantity = pieces,
    quantityUnit = "pieces",
    quantityPieces = pieces,
    unitsPerCase = 12,
    unitPricePaise = 9_000,
    gstPercent = 5.0,
    lineTotalPaise = 54_000,
  )

  private fun order(id: String, placedAt: String, items: List<OrderItem>) = RetailerOrder(
    id = id,
    orderNumber = "MT-$id",
    status = "delivered",
    subtotalPaise = 54_000,
    gstTotalPaise = 2_500,
    discountTotalPaise = 0,
    grandTotalPaise = 56_500,
    placedAt = placedAt,
    updatedAt = placedAt,
    notes = null,
    shippingAddressLine = "Market Road",
    items = items,
    coinsUsedPaise = null,
    balanceAfterCoinsPaise = null,
  )

  private fun detail(packId: String, price: Long?, availability: PackAvailability) = ProductDetail(
    id = "product-$packId",
    name = "Product $packId",
    brandName = "Brand",
    categoryId = null,
    categoryName = null,
    unit = "kg",
    hsnCode = null,
    gstPercent = 5.0,
    leadTimeDays = 0,
    isNewLaunch = false,
    isFavorite = false,
    hasOffer = false,
    images = emptyList(),
    packs = listOf(
      ProductPackDetail(
        packId = packId,
        packName = "1 kg",
        unitsPerCase = 12,
        moq = 12,
        allowLoosePieces = true,
        unitPricePaise = price,
        lineTotalAtMoqPaise = price?.let { it * 12 },
        gstPercent = 5.0,
        mrpPaise = null,
        derivedCasePricePaise = price?.let { it * 12 },
        tiers = emptyList(),
        availability = availability,
        selected = true,
        images = emptyList(),
        message = null,
      ),
    ),
  )

  @Test
  fun `frequency beats recency, and recency breaks ties`() {
    val orders = listOf(
      order("new", "2026-10-05T10:00:00Z", listOf(item("once"))),
      order("older", "2026-10-01T10:00:00Z", listOf(item("thrice"), item("twice"))),
      order("oldest", "2026-09-01T10:00:00Z", listOf(item("thrice"), item("twice"))),
      order("oldest2", "2026-08-01T10:00:00Z", listOf(item("thrice"))),
    )

    val ranked = buyAgainCandidates(orders)
    assertEquals(listOf("thrice", "twice", "once"), ranked.map { it.packId })
    assertEquals(3, ranked.first().timesOrdered)
    assertEquals(2, ranked[1].timesOrdered)
  }

  @Test
  fun `the most recent order supplies the suggested quantity and the date`() {
    val orders = listOf(
      order("new", "2026-10-05T10:00:00Z", listOf(item("pack", pieces = 24))),
      order("old", "2026-09-05T10:00:00Z", listOf(item("pack", pieces = 6))),
    )
    val candidate = buyAgainCandidates(orders).single()
    assertEquals(24, candidate.lastPieces)
    assertEquals("2026-10-05T10:00:00Z", candidate.lastOrderedAt)
  }

  @Test
  fun `a line with no pack is skipped rather than guessed at`() {
    val orders = listOf(order("o", "2026-10-05T10:00:00Z", listOf(item("pack").copy(packId = null))))
    assertTrue(buyAgainCandidates(orders).isEmpty())
  }

  @Test
  fun `the list is capped so the screen stays a shortcut, not a history page`() {
    val orders = listOf(
      order(
        "o",
        "2026-10-05T10:00:00Z",
        (1..20).map { index -> item("pack-$index") },
      ),
    )
    assertEquals(MAX_BUY_AGAIN_ITEMS, buyAgainCandidates(orders).size)
  }

  @Test
  fun `a priced, in-stock pack is ready and starts at the current minimum`() {
    val item = BuyAgainItem(candidate = buyAgainCandidates(listOf(order("o", "2026-10-05T10:00:00Z", listOf(item("p", pieces = 4))))).single())
    val revalidated = revalidateBuyAgainItem(item, detail("p", price = 8_000, availability = PackAvailability.IN_STOCK))

    assertEquals(BuyAgainStatus.READY, revalidated.status)
    assertEquals(8_000L, revalidated.current?.unitPricePaise)
    // The old order was 4 pieces; today's minimum is 12, so 12 is suggested —
    // a suggestion below the minimum would simply be refused by the cart.
    assertEquals(12, revalidated.suggestedQuantity())
  }

  @Test
  fun `an out-of-stock pack is not offered, and an unpriced pack is not offered`() {
    val candidate = buyAgainCandidates(listOf(order("o", "2026-10-05T10:00:00Z", listOf(item("p"))))).single()
    val item = BuyAgainItem(candidate = candidate)

    val out = revalidateBuyAgainItem(item, detail("p", price = 8_000, availability = PackAvailability.OUT_OF_STOCK))
    assertEquals(BuyAgainStatus.UNAVAILABLE, out.status)

    val unpriced = revalidateBuyAgainItem(item, detail("p", price = null, availability = PackAvailability.IN_STOCK))
    assertEquals(BuyAgainStatus.UNKNOWN, unpriced.status)
    assertNull(unpriced.current?.unitPricePaise)
  }

  @Test
  fun `a pack the catalogue no longer publishes is not swapped for another pack`() {
    val candidate = buyAgainCandidates(listOf(order("o", "2026-10-05T10:00:00Z", listOf(item("p"))))).single()
    val item = BuyAgainItem(candidate = candidate)
    // The detail row carries a DIFFERENT pack: matching it would silently
    // change the size, the minimum and the price of what the shop reorders.
    val other = detail("other", price = 5_000, availability = PackAvailability.IN_STOCK)
    val revalidated = revalidateBuyAgainItem(item, other)

    assertEquals(BuyAgainStatus.UNAVAILABLE, revalidated.status)
  }

  @Test
  fun `repeated packs in one pasted list are merged into one line`() {
    val merged = mergeBulkSelections(
      listOf(
        QuickOrderQuantity("pack-1", 2),
        QuickOrderQuantity("pack-2", 5),
        QuickOrderQuantity("pack-1", 3),
      ),
    )
    assertEquals(listOf(QuickOrderQuantity("pack-1", 5), QuickOrderQuantity("pack-2", 5)), merged)
  }

  @Test
  fun `merging ignores blank packs and keeps the first-seen order`() {
    val merged = mergeBulkSelections(
      listOf(
        QuickOrderQuantity("pack-b", 1),
        QuickOrderQuantity("", 4),
        QuickOrderQuantity("pack-a", 2),
      ),
    )
    assertEquals(listOf("pack-b", "pack-a"), merged.map { it.packId })
  }
}
