package com.maharanitraders.app.ui

import com.maharanitraders.app.navigation.MaharaniRoutes
import com.maharanitraders.core.designsystem.theme.AccentTone
import com.maharanitraders.feature.catalog.HomeQuickAction
import com.maharanitraders.feature.catalog.HomeQuickActionIcon

/**
 * The home screen's shortcuts, built from the destinations THIS session may open.
 *
 * WHY IT IS BUILT HERE
 * The route table lives in `:app` and the authorisation lives on the server
 * (`NavigationPolicy`, delivered in the session snapshot). So the shell — the
 * one place that has both — decides which tiles exist, and the home screen just
 * draws the list it is handed. That is what makes "no dead navigation" structural
 * rather than a promise: a route the account cannot open is never passed down,
 * and a tile can therefore never lead to a permission error.
 *
 * The list is capped at [MAX_ACTIONS] so the shop is still visible without
 * scrolling: these are shortcuts, not a second navigation drawer. A tile that
 * would push the shop below the fold is a worse trade than a tile that is one
 * tap further away in the drawer.
 *
 * Colour is part of the design system, not decoration: amber for money and
 * savings, violet for ordering tools, green for history, blue for the directory
 * and reports, rose for saved things, red for the shop itself.
 */
internal fun homeQuickActions(availableRoutes: Set<String>): List<HomeQuickAction> {
  val candidates = listOf(
    HomeQuickAction(MaharaniRoutes.CATALOG, "Shop now", HomeQuickActionIcon.SHOP, AccentTone.BRAND),
    HomeQuickAction(MaharaniRoutes.QUICK_ORDER, "Quick order", HomeQuickActionIcon.QUICK_ORDER, AccentTone.VIOLET),
    HomeQuickAction(MaharaniRoutes.ORDERS, "My orders", HomeQuickActionIcon.ORDERS, AccentTone.GREEN),
    HomeQuickAction(MaharaniRoutes.CART, "Cart", HomeQuickActionIcon.CART, AccentTone.AMBER),
    HomeQuickAction(MaharaniRoutes.CATEGORIES, "Categories", HomeQuickActionIcon.CATEGORY, AccentTone.BLUE),
    HomeQuickAction(MaharaniRoutes.BRANDS, "Brands", HomeQuickActionIcon.BRAND, AccentTone.BLUE),
    HomeQuickAction(MaharaniRoutes.COINS, "Coins", HomeQuickActionIcon.COINS, AccentTone.AMBER),
    HomeQuickAction(MaharaniRoutes.COUPONS, "Coupons", HomeQuickActionIcon.COUPONS, AccentTone.ROSE),
    // Beyond the first two rows: still real, simply not worth pushing the shop
    // off the first screen for.
    HomeQuickAction(MaharaniRoutes.SAVED_CARTS, "Saved carts", HomeQuickActionIcon.SAVED_CARTS, AccentTone.VIOLET),
    HomeQuickAction(MaharaniRoutes.FAVORITES, "Favourites", HomeQuickActionIcon.FAVORITES, AccentTone.ROSE),
    HomeQuickAction(MaharaniRoutes.SUPPORT, "Support", HomeQuickActionIcon.SUPPORT, AccentTone.BLUE),
    HomeQuickAction(MaharaniRoutes.NOTIFICATIONS, "Alerts", HomeQuickActionIcon.NOTIFICATIONS, AccentTone.VIOLET),
    HomeQuickAction(MaharaniRoutes.REPORTS, "Reports", HomeQuickActionIcon.REPORTS, AccentTone.GREEN),
  )
  return candidates.filter { it.route in availableRoutes }.take(MAX_ACTIONS)
}

/** Four per row, two rows: the shop stays above the fold on a 360dp phone. */
private const val MAX_ACTIONS = 8
