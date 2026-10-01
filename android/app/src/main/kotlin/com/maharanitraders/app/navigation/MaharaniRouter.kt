package com.maharanitraders.app.navigation

import com.maharanitraders.core.model.NavigationPolicy
import com.maharanitraders.core.model.SessionSnapshot
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
 * The single source of truth for "where may this account go" is the
 * server-issued [NavigationPolicy]; the app contributes only presentation
 * (labels, phases, ordering).
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
      destinations = destinationsFor(policy),
    )
  }

  /**
   * Destinations visible to this account: Home, plus every catalog entry whose
   * workspace the server granted. Entries for other workspaces are hidden
   * entirely (no disabled-but-visible cross-workspace links).
   */
  fun destinationsFor(policy: NavigationPolicy): List<MaharaniDestination> =
    MaharaniCatalog.destinations.filter { destination ->
      destination.workspace == null || policy.canEnter(destination.workspace)
    }
}
