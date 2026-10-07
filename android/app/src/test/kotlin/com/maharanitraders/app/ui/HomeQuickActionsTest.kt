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
    )

    val actions = homeQuickActions(routes)

    assertThat(actions).hasSize(8)
    assertThat(actions.map { it.route }).containsExactly(
      MaharaniRoutes.CATALOG,
      MaharaniRoutes.QUICK_ORDER,
      MaharaniRoutes.ORDERS,
      MaharaniRoutes.CART,
      MaharaniRoutes.CATEGORIES,
      MaharaniRoutes.BRANDS,
      MaharaniRoutes.COINS,
      MaharaniRoutes.COUPONS,
    ).inOrder()
    // The tones come from the design system's families, in the documented
    // order (red shop, violet tools, green history, amber money), so adding a
    // tile is a deliberate colour decision rather than a default.
    assertThat(actions.map { it.tone }).containsExactly(
      AccentTone.BRAND,
      AccentTone.VIOLET,
      AccentTone.GREEN,
      AccentTone.AMBER,
      AccentTone.BLUE,
      AccentTone.BLUE,
      AccentTone.AMBER,
      AccentTone.ROSE,
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
