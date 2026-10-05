package com.maharanitraders.app.navigation

import com.maharanitraders.core.model.SessionSnapshot
import com.maharanitraders.core.model.UserRole
import com.maharanitraders.core.model.Workspace

/**
 * Result of turning the server's navigation policy into shell routing.
 *
 * `Unsupported` is a first-class outcome: if the server describes an account
 * this build cannot route (unknown workspace, home route the policy does not
 * permit, empty home route), the app shows an explicit screen and offers sign
 * out — it never guesses a destination and never falls back to a privileged
 * area.
 */
sealed interface SessionRouting {

  data class Ready(
    val start: MaharaniDestination,
    val destinations: List<MaharaniDestination>,
  ) : SessionRouting

  data class Unsupported(val reason: String) : SessionRouting
}

/**
 * Pure routing decisions — no Compose, no Android, fully unit-tested.
 *
 * The single source of truth for "where may this account go" is the server-issued
 * navigation policy and verified role; the app contributes presentation (labels,
 * phases, ordering) while commerce endpoints enforce the same permission gates.
 */
object MaharaniRouter {

  /**
   * Maps the server's home route (a path such as `/retailer/home`) onto the
   * workspace whose first path segment it uses. Returns `null` for anything
   * unrecognised, including a bare `/` — an account whose landing workspace
   * cannot be determined must not be routed anywhere.
   */
  fun workspaceForServerHomeRoute(homeRoute: String): Workspace? {
    val segments = homeRoute.trim().trim('/').split('/').filter { it.isNotEmpty() }
    val first = segments.firstOrNull() ?: return null
    return Workspace.fromId(first)
  }

  fun resolveSession(snapshot: SessionSnapshot): SessionRouting {
    val policy = snapshot.navigation

    if (!policy.isUsable) {
      return SessionRouting.Unsupported("The server did not provide a landing page for this account.")
    }

    val homeWorkspace = workspaceForServerHomeRoute(policy.homeRoute)
      ?: return SessionRouting.Unsupported("The server's landing page is not recognised by this app version.")

    if (!policy.canEnter(homeWorkspace)) {
      return SessionRouting.Unsupported("This account is not permitted to enter its own landing workspace.")
    }

    val home = MaharaniCatalog.byRoute(MaharaniRoutes.HOME)
      ?: return SessionRouting.Unsupported("Internal navigation configuration error.")

    return SessionRouting.Ready(
      start = home,
      destinations = destinationsFor(snapshot),
    )
  }

  /**
   * Destinations visible to this account: Home, plus every catalog entry whose
   * workspace the server granted. Cart and order history are also restricted
   * to the retailer role because their existing commerce APIs are retailer-only;
   * a salesman who can enter the retailer catalogue does not gain these routes.
   * Visibility is UX only—the endpoints still enforce role and permission.
   */
  fun destinationsFor(snapshot: SessionSnapshot): List<MaharaniDestination> =
    MaharaniCatalog.destinations.filter { destination ->
      val workspaceAllowed = destination.workspace == null || snapshot.navigation.canEnter(destination.workspace)
      workspaceAllowed && isRoleAndPermissionAllowed(destination.route, snapshot)
    }

  private fun isRoleAndPermissionAllowed(route: String, snapshot: SessionSnapshot): Boolean = when (route) {
    // `retailer_favorites` is a retailer table and its mobile endpoints are
    // retailer-scoped, so the destination follows the same boundary.
    MaharaniRoutes.FAVORITES -> snapshot.role == UserRole.RETAILER
    MaharaniRoutes.CART -> snapshot.role == UserRole.RETAILER
      && snapshot.navigation.can("orders.create")
      && snapshot.navigation.can("orders.view.own")
    MaharaniRoutes.ORDERS -> snapshot.role == UserRole.RETAILER
      && snapshot.navigation.can("orders.view.own")
    else -> true
  }
}
