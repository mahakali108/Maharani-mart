package com.maharanitraders.feature.orders

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Cart warnings are a DIFF of two server answers — never a rule the app
 * invented. These cases pin that: the app may say "the server changed this
 * line", and it may never change the line itself.
 */
class CartNoticesTest {

  private fun line(
    id: String = "line-1",
    price: Long? = 10_000,
    availability: String = "in_stock",
    orderable: Boolean = true,
    message: String? = null,
  ) = CartLine(
    id = id,
    packId = "pack-1",
    productId = "product-1",
    productName = "Rice",
    packName = "5 kg",
    quantity = 6,
    quantityUnit = "pieces",
    quantityIncrement = 1,
    moq = 6,
    unitsPerCase = 12,
    unitPricePaise = price,
    lineTotalPaise = price?.let { it * 6 },
    gstPercent = 5.0,
    availability = availability,
    orderable = orderable,
    message = message,
  )

  @Test
  fun `no previous snapshot means no warnings`() {
    assertTrue(cartNotices(emptyList(), listOf(line())).isEmpty())
  }

  @Test
  fun `an unchanged cart is silent`() {
    val before = listOf(line())
    assertTrue(cartNotices(before, listOf(line())).isEmpty())
  }

  @Test
  fun `a re-priced line is reported with both rates`() {
    val notices = cartNotices(listOf(line(price = 10_000)), listOf(line(price = 11_500)))
    assertEquals(1, notices.size)
    assertEquals(CartNoticeKind.PRICE_CHANGED, notices.single().kind)
    assertEquals("Rice", notices.single().productName)
    assertTrue(notices.single().detail.contains("₹100"))
    assertTrue(notices.single().detail.contains("₹115"))
  }

  @Test
  fun `a price that could not be read is not reported as a price change`() {
    // null either side means "the server could not price this" — that is the
    // NOT_ORDERABLE case, and calling it a change would be a lie about money.
    assertTrue(cartNotices(listOf(line(price = 10_000)), listOf(line(price = null))).isEmpty())
  }

  @Test
  fun `stock going and coming back are both reported`() {
    val out = cartNotices(
      listOf(line(availability = "in_stock")),
      listOf(line(availability = "out_of_stock", orderable = false)),
    )
    assertEquals(CartNoticeKind.STOCK_CHANGED, out.single().kind)
    assertTrue(out.single().detail.contains("out of stock"))

    val back = cartNotices(
      listOf(line(availability = "out_of_stock")),
      listOf(line(availability = "in_stock")),
    )
    assertTrue(back.single().detail.contains("Back in stock"))
  }

  @Test
  fun `the server's own refusal is shown as the server worded it`() {
    val notices = cartNotices(
      listOf(line()),
      listOf(
        line(
          availability = "out_of_stock",
          orderable = false,
          message = "Only 8 available now.",
        ),
      ),
    )
    val refusal = notices.first { it.kind == CartNoticeKind.NOT_ORDERABLE }
    assertEquals("Only 8 available now.", refusal.detail)
    // The availability change is reported too: the two are different facts and
    // a shopkeeper needs both to decide what to do with the line.
    assertTrue(notices.any { it.kind == CartNoticeKind.STOCK_CHANGED })
  }

  @Test
  fun `a line the server no longer returns is not reported as a change`() {
    // A disappearance is either this shopper's own removal or something the
    // cart endpoint has already explained; guessing would raise a false alarm.
    assertTrue(cartNotices(listOf(line(id = "gone")), listOf(line(id = "kept"))).isEmpty())
  }
}
