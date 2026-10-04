package com.maharanitraders.feature.orders.ui

import org.junit.Assert.assertEquals
import org.junit.Test

class OrderStatusHeadingTest {
  @Test
  fun `recovered cancellation is not shown as confirmed`() {
    assertEquals("Order cancelled", orderStatusHeading("cancelled"))
    assertEquals("Order cancelled", orderStatusHeading(" CANCELED "))
  }

  @Test
  fun `heading reflects actual server status`() {
    assertEquals("Order received", orderStatusHeading("pending"))
    assertEquals("Order processing", orderStatusHeading("processing"))
    assertEquals("Order delivered", orderStatusHeading("delivered"))
    assertEquals("Order status", orderStatusHeading("unknown_future_status"))
  }
}
