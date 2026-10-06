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

  @Test
  fun `a whole percentage is printed without a decimal tail`() {
    assertEquals("18%", formatPercent(18.0))
    assertEquals("5%", formatPercent(5.0))
  }

  @Test
  fun `a fractional percentage keeps its value and never leaks float noise`() {
    assertEquals("12.5%", formatPercent(12.5))
    // A numeric column read as 12.499999999 must not print its noise.
    assertEquals("12.5%", formatPercent(12.499999999))
    assertEquals("0.25%", formatPercent(0.25))
  }

  @Test
  fun `delivery statuses are named as the delivery workflow names them`() {
    assertEquals("Assigned to a delivery person", deliveryStatusLabel("assigned"))
    assertEquals("Out for delivery", deliveryStatusLabel("in_progress"))
    assertEquals("Delivered", deliveryStatusLabel("delivered"))
    assertEquals("Partially delivered", deliveryStatusLabel("partially_delivered"))
    assertEquals("Delivery attempt failed", deliveryStatusLabel("failed"))
    assertEquals("Returned to warehouse", deliveryStatusLabel("returned_to_warehouse"))
    // An unknown future status is shown readably rather than blank.
    assertEquals("Some new status", deliveryStatusLabel("some_new_status"))
  }
}
