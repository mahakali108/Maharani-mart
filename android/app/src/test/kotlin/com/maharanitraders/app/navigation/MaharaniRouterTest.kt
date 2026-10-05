package com.maharanitraders.app.navigation

import com.maharanitraders.core.model.NavigationPolicy
import com.maharanitraders.core.model.SessionSnapshot
import com.maharanitraders.core.model.SessionUser
import com.maharanitraders.core.model.UserRole
import com.maharanitraders.core.model.Workspace
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Role gating for the native shell.
 *
 * The app is not the security boundary — the server re-checks every call — but
 * the shell must still never offer, or navigate to, a workspace the server did
 * not grant. These tests pin that behaviour, including the "unsupported
 * account" paths where the app must refuse to guess a destination.
 */
class MaharaniRouterTest {

  private fun snapshot(
    role: UserRole = UserRole.RETAILER,
    homeRoute: String = "/retailer/home",
    workspaces: List<Workspace> = listOf(Workspace.RETAILER),
    permissions: Set<String> = setOf("orders.create", "orders.view.own"),
  ) = SessionSnapshot(
    user = SessionUser(
      id = "user-1",
      email = "shop@example.com",
      role = role,
      fullName = "Shop Owner",
      phone = null,
      isActive = true,
    ),
    retailer = null,
    access = null,
    navigation = NavigationPolicy(homeRoute = homeRoute, workspaces = workspaces, permissions = permissions),
  )

  @Test
  fun `maps the server home route onto a workspace`() {
    assertEquals(Workspace.RETAILER, MaharaniRouter.workspaceForServerHomeRoute("/retailer/home"))
    assertEquals(Workspace.ADMIN, MaharaniRouter.workspaceForServerHomeRoute("/admin/dashboard"))
    assertEquals(Workspace.STAFF, MaharaniRouter.workspaceForServerHomeRoute("/staff/orders"))
    assertEquals(Workspace.SALESMAN, MaharaniRouter.workspaceForServerHomeRoute("/salesman/retailers"))
    assertEquals(Workspace.RETAILER, MaharaniRouter.workspaceForServerHomeRoute("retailer/products"))
  }

  @Test
  fun `refuses to route an unrecognised or empty home route`() {
    assertNull(MaharaniRouter.workspaceForServerHomeRoute("/"))
    assertNull(MaharaniRouter.workspaceForServerHomeRoute(""))
    assertNull(MaharaniRouter.workspaceForServerHomeRoute("   "))
    assertNull(MaharaniRouter.workspaceForServerHomeRoute("/dashboard"))
    assertNull(MaharaniRouter.workspaceForServerHomeRoute("/time-travel"))
  }

  @Test
  fun `a retailer only sees retailer destinations plus shared ones`() {
    val routing = MaharaniRouter.resolveSession(snapshot()) as SessionRouting.Ready
    val routes = routing.destinations.map { it.route }

    assertEquals(MaharaniRoutes.HOME, routing.start.route)
    assertEquals(MaharaniRoutes.HOME, routes.first())
    assertTrue(MaharaniRoutes.CATALOG in routes)
    // The native shopping redesign ships the category directory and the
    // account profile, so both are real screens for a retailer.
    assertTrue(MaharaniRoutes.CATEGORIES in routes)
    assertTrue(MaharaniRoutes.ACCOUNT in routes)
    assertTrue(MaharaniRoutes.CART in routes)
    assertTrue(MaharaniRoutes.FAVORITES in routes)
    assertTrue(MaharaniRoutes.COINS in routes)
    assertTrue(MaharaniRoutes.ORDERS in routes) // retailer-only history
    assertTrue(MaharaniRoutes.NOTIFICATIONS in routes)

    assertTrue("retailers must not see the admin workspace", MaharaniRoutes.ADMINISTRATION !in routes)
    assertTrue(MaharaniRoutes.WAREHOUSE !in routes)
    assertTrue(MaharaniRoutes.SALES_DESK !in routes)
  }

  @Test
  fun `retailer commerce destinations require the role and server permissions they call`() {
    val historyOnly = MaharaniRouter.destinationsFor(
      snapshot(permissions = setOf("orders.view.own")),
    ).map { it.route }
    assertTrue(MaharaniRoutes.ORDERS in historyOnly)
    assertTrue(MaharaniRoutes.CART !in historyOnly)

    val createOnly = MaharaniRouter.destinationsFor(
      snapshot(permissions = setOf("orders.create")),
    ).map { it.route }
    assertTrue(MaharaniRoutes.CART !in createOnly)
    assertTrue(MaharaniRoutes.ORDERS !in createOnly)
  }

  @Test
  fun `an admin sees administration but no retailer-only screens`() {
    val routing = MaharaniRouter.resolveSession(
      snapshot(
        role = UserRole.ADMIN,
        homeRoute = "/admin/dashboard",
        workspaces = listOf(Workspace.ADMIN),
      )
    ) as SessionRouting.Ready

    val routes = routing.destinations.map { it.route }
    assertTrue(MaharaniRoutes.ADMINISTRATION in routes)
    // The account profile is shared across roles; the retailer taxonomy is not.
    assertTrue(MaharaniRoutes.ACCOUNT in routes)
    assertTrue(MaharaniRoutes.CATEGORIES !in routes)
    assertTrue(MaharaniRoutes.CATALOG !in routes)
    assertTrue(MaharaniRoutes.CART !in routes)
    assertTrue(MaharaniRoutes.ORDERS !in routes)
    assertTrue(MaharaniRoutes.COINS !in routes)
    // Favourites are saved against a retailer account, so no other workspace
    // has one to show.
    assertTrue(MaharaniRoutes.FAVORITES !in routes)
  }

  @Test
  fun `warehouse staff see the warehouse workspace only`() {
    val routing = MaharaniRouter.resolveSession(
      snapshot(
        role = UserRole.STAFF,
        homeRoute = "/staff/orders",
        workspaces = listOf(Workspace.STAFF),
      )
    ) as SessionRouting.Ready

    val routes = routing.destinations.map { it.route }
    assertTrue(MaharaniRoutes.WAREHOUSE in routes)
    assertTrue(MaharaniRoutes.ADMINISTRATION !in routes)
    assertTrue(MaharaniRoutes.CATALOG !in routes)
  }

  @Test
  fun `a salesman whose account also holds the retailer workspace sees both`() {
    val routing = MaharaniRouter.resolveSession(
      snapshot(
        role = UserRole.SALESMAN,
        homeRoute = "/salesman/retailers",
        workspaces = listOf(Workspace.SALESMAN, Workspace.RETAILER),
      )
    ) as SessionRouting.Ready

    val routes = routing.destinations.map { it.route }
    assertTrue(MaharaniRoutes.SALES_DESK in routes)
    assertTrue(MaharaniRoutes.CATALOG in routes)
    assertTrue(MaharaniRoutes.CART !in routes)
    assertTrue(MaharaniRoutes.ORDERS !in routes)
  }

  @Test
  fun `an account whose home route is not granted is unsupported, never routed`() {
    val routing = MaharaniRouter.resolveSession(
      snapshot(homeRoute = "/admin/dashboard", workspaces = listOf(Workspace.RETAILER))
    )

    assertTrue(routing is SessionRouting.Unsupported)
  }

  @Test
  fun `an account with no landing page is unsupported`() {
    val routing = MaharaniRouter.resolveSession(snapshot(homeRoute = "   "))
    assertTrue(routing is SessionRouting.Unsupported)
  }

  @Test
  fun `destinations without a workspace are always available to signed-in users`() {
    val admin = snapshot(
      role = UserRole.ADMIN,
      homeRoute = "/admin/dashboard",
      workspaces = listOf(Workspace.ADMIN),
      permissions = emptySet(),
    )
    val routes = MaharaniRouter.destinationsFor(admin).map { it.route }

    assertTrue(MaharaniRoutes.HOME in routes)
    assertTrue(MaharaniRoutes.ORDERS !in routes)
    assertTrue(MaharaniRoutes.NOTIFICATIONS in routes)
  }

  @Test
  fun `every catalogue route is unique and resolvable`() {
    val catalog = MaharaniCatalog.destinations
    assertEquals(catalog.size, catalog.map { it.route }.toSet().size)
    catalog.forEach { destination ->
      assertEquals(destination, MaharaniCatalog.byRoute(destination.route))
    }
  }

  @Test
  fun `destinations that are not built yet always carry a phase label`() {
    // `phase` is what `DestinationSurface` renders as "Planned · Phase X" for a
    // destination that has no screen of its own, so a destination that DOES have
    // one must not carry a phase — that would label a shipped feature as planned.
    //
    // This list is exactly the set of branches `DestinationSurface` renders.
    // Add a route here only when its phase actually ships; the assertion below
    // still fails for any new unbuilt destination that forgot its phase.
    val built = setOf(
      MaharaniRoutes.HOME,
      MaharaniRoutes.CATALOG,
      MaharaniRoutes.CATEGORIES,
      MaharaniRoutes.FAVORITES,
      MaharaniRoutes.QUICK_ORDER,
      MaharaniRoutes.CART,
      MaharaniRoutes.ORDERS,
      MaharaniRoutes.COINS,
      MaharaniRoutes.NOTIFICATIONS,
      MaharaniRoutes.COUPONS,
      MaharaniRoutes.ACCOUNT,
    )

    MaharaniCatalog.destinations
      .filter { it.route !in built }
      .forEach { destination ->
        assertTrue(
          "${destination.route} must declare the phase that delivers it",
          destination.phase != null,
        )
      }
  }

  @Test
  fun `a destination with a real screen does not carry a planned phase label`() {
    // The other half of the rule above: the built set must not drift into
    // carrying a phase, or the drawer's placeholder branch would describe a
    // working screen as "Planned".
    val built = setOf(
      MaharaniRoutes.HOME,
      MaharaniRoutes.CATALOG,
      MaharaniRoutes.CATEGORIES,
      MaharaniRoutes.FAVORITES,
      MaharaniRoutes.QUICK_ORDER,
      MaharaniRoutes.CART,
      MaharaniRoutes.ORDERS,
      MaharaniRoutes.COINS,
      MaharaniRoutes.NOTIFICATIONS,
      MaharaniRoutes.COUPONS,
      MaharaniRoutes.ACCOUNT,
    )

    MaharaniCatalog.destinations
      .filter { it.route in built }
      .forEach { destination ->
        assertNull(
          "${destination.route} is built, so it must not declare a phase",
          destination.phase,
        )
      }
  }
}
