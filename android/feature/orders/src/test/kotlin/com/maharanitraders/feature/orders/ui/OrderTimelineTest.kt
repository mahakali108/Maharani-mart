package com.maharanitraders.feature.orders.ui

import com.maharanitraders.feature.orders.OrderStatusEntry
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The order timeline shows ONLY what the server recorded.
 *
 * These cases exist because the tempting implementation is a fixed six-stage
 * ladder with the un-reached stages greyed out — which would tell a shopkeeper
 * their order is "out for delivery" when the backend has no such row. The
 * timeline is the order's own history, and nothing else.
 */
class OrderTimelineTest {

  private fun entry(status: String, at: String) = OrderStatusEntry(
    id = "h-$status",
    status = status,
    note = null,
    createdAt = at,
  )

  @Test
  fun `an order with no history shows its current status alone`() {
    val steps = orderTimeline(emptyList(), "pending")
    assertEquals(1, steps.size)
    assertEquals("Order received", steps.single().heading)
    assertEquals(OrderTimelineState.CURRENT, steps.single().state)
  }

  @Test
  fun `recorded steps are kept in order and the current one is marked`() {
    val history = listOf(
      entry("pending", "2026-10-01T09:00:00Z"),
      entry("confirmed", "2026-10-01T10:00:00Z"),
      entry("delivered", "2026-10-02T10:00:00Z"),
    )
    val steps = orderTimeline(history, "confirmed")

    assertEquals(listOf("Order received", "Order confirmed", "Order delivered"), steps.map { it.heading })
    assertEquals(
      listOf(OrderTimelineState.DONE, OrderTimelineState.CURRENT, OrderTimelineState.LATER),
      steps.map { it.state },
    )
  }

  @Test
  fun `a status recorded twice marks the LAST occurrence as current`() {
    val history = listOf(
      entry("delivered", "2026-10-01T10:00:00Z"),
      entry("returned", "2026-10-02T10:00:00Z"),
      entry("delivered", "2026-10-03T10:00:00Z"),
    )
    val steps = orderTimeline(history, "delivered")
    // The second "delivered" row is the order's current state, so everything
    // recorded before it — including the return in between — is history, not
    // something still to come.
    assertEquals(OrderTimelineState.DONE, steps[0].state)
    assertEquals(OrderTimelineState.DONE, steps[1].state)
    assertEquals(OrderTimelineState.CURRENT, steps[2].state)
  }

  @Test
  fun `a row recorded after the current status stays visible but is not 'now'`() {
    val history = listOf(
      entry("confirmed", "2026-10-01T10:00:00Z"),
      entry("delivered", "2026-10-02T10:00:00Z"),
    )
    val steps = orderTimeline(history, "confirmed")
    assertEquals(OrderTimelineState.CURRENT, steps[0].state)
    assertEquals(OrderTimelineState.LATER, steps[1].state)
  }

  @Test
  fun `a status the history does not contain falls back to the newest row`() {
    val history = listOf(
      entry("pending", "2026-10-01T09:00:00Z"),
      entry("confirmed", "2026-10-01T10:00:00Z"),
    )
    val steps = orderTimeline(history, "dispatched")
    assertEquals(OrderTimelineState.CURRENT, steps.last().state)
    // The steps are still the rows the server sent — no invented "dispatched".
    assertEquals(2, steps.size)
  }

  @Test
  fun `notes and timestamps travel with their step`() {
    val steps = orderTimeline(
      listOf(OrderStatusEntry(id = "h", status = "packed", note = "Left the warehouse", createdAt = "2026-10-01T11:00:00Z")),
      "packed",
    )
    assertEquals("Left the warehouse", steps.single().note)
    assertEquals("2026-10-01T11:00:00Z", steps.single().at)
  }
}
