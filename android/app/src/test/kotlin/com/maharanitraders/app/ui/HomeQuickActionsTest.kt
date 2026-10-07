package com.maharanitraders.app.ui

import com.google.common.truth.Truth.assertThat
import com.maharanitraders.app.navigation.MaharaniRoutes
import com.maharanitraders.core.designsystem.theme.AccentTone
import org.junit.Test

/**
 * The home dashboard's shortcut tiles and its order-status wording.
 *
 * The rule the shortcuts exist to enforce: a tile is drawn ONLY for a route the
 * server-verified session can open. That is what makes "no dead navigation"
 * structural — the screen cannot advertise a workspace the account lacks, and
 * tapping a tile can never produce an authorisation error.
 */
class HomeQuickActionsTest {

  @Test
  fun `a full retailer session gets the capped first screen of shortcuts`() {
    val routes = setOf(
      MaharaniRoutes.CATALOG,
      MaharaniRoutes.QUICK_ORDER,
      MaharaniRoutes.ORDERS,
      MaharaniRoutes.CART,
      MaharaniRoutes.CATEGORIES,
      MaharaniRoutes.BRANDS,
      MaharaniRoutes.COINS,
      MaharaniRoutes.COUPONS,
      MaharaniRoutes.SAVED_CARTS,
      MaharaniRoutes.FAVORITES,
      MaharaniRoutes.SUPPORT,
      MaharaniRoutes.NOTIFICATIONS,
      MaharaniRoutes.REPORTS,
      MaharaniRoutes.BUY_AGAIN,
    )

    val actions = homeQuickActions(routes)

    assertThat(actions).hasSize(8)
    assertThat(actions.map { it.route }).containsExactly(
      MaharaniRoutes.CATALOG,
      MaharaniRoutes.CATEGORIES,
      MaharaniRoutes.BRANDS,
      MaharaniRoutes.QUICK_ORDER,
      // Reordering is a wholesale shop's most repeated job, so "Buy again"
      // earns a first-row tile ahead of the account destinations.
      MaharaniRoutes.BUY_AGAIN,
      MaharaniRoutes.ORDERS,
      MaharaniRoutes.FAVORITES,
      MaharaniRoutes.CART,
    ).inOrder()
    // The tones come from the design system's families, in the documented
    // order (red shop, violet tools, green history, amber money), so adding a
    // tile is a deliberate colour decision rather than a default.
    assertThat(actions.map { it.tone }).containsExactly(
      AccentTone.BRAND,
      AccentTone.BLUE,
      AccentTone.BLUE,
      AccentTone.VIOLET,
      AccentTone.VIOLET,
      AccentTone.GREEN,
      AccentTone.ROSE,
      AccentTone.AMBER,
    ).inOrder()
    // Eight distinct glyphs: no two shortcuts look alike on the grid.
    assertThat(actions.map { it.icon }.toSet()).hasSize(8)
  }

  @Test
  fun `a restricted session gets only the shortcuts it can open`() {
    val actions = homeQuickActions(setOf(MaharaniRoutes.CATALOG, MaharaniRoutes.ORDERS))

    assertThat(actions.map { it.route }).containsExactly(MaharaniRoutes.CATALOG, MaharaniRoutes.ORDERS)
      .inOrder()
  }

  @Test
  fun `buy again is only offered to a session that can reorder`() {
    // A session without the orders destinations must not be offered a reorder
    // shortcut: the tile would open a screen that cannot work.
    val actions = homeQuickActions(
      setOf(MaharaniRoutes.CATALOG, MaharaniRoutes.BUY_AGAIN, MaharaniRoutes.ORDERS),
    )
    assertThat(actions.map { it.route }).containsExactly(
      MaharaniRoutes.CATALOG,
      MaharaniRoutes.BUY_AGAIN,
      MaharaniRoutes.ORDERS,
    ).inOrder()

    assertThat(homeQuickActions(setOf(MaharaniRoutes.CATALOG)).map { it.route })
      .containsExactly(MaharaniRoutes.CATALOG)
  }

  @Test
  fun `no available route means no tiles at all`() {
    assertThat(homeQuickActions(emptySet())).isEmpty()
  }

  @Test
  fun `order statuses are worded exactly as the orders tab words them`() {
    assertThat(homeOrderStatusLabel("pending")).isEqualTo("Order received")
    assertThat(homeOrderStatusLabel("CONFIRMED")).isEqualTo("Order confirmed")
    assertThat(homeOrderStatusLabel(" processing ")).isEqualTo("Order processing")
    assertThat(homeOrderStatusLabel("packed")).isEqualTo("Order packed")
    assertThat(homeOrderStatusLabel("dispatched")).isEqualTo("Order dispatched")
    assertThat(homeOrderStatusLabel("delivered")).isEqualTo("Order delivered")
    assertThat(homeOrderStatusLabel("cancelled")).isEqualTo("Order cancelled")
    assertThat(homeOrderStatusLabel("returned")).isEqualTo("Order returned")

    // A status this build does not know is shown as the SERVER sent it: the app
    // never rounds an unknown state into a friendlier word.
    assertThat(homeOrderStatusLabel("escalated")).isEqualTo("escalated")
  }
}
