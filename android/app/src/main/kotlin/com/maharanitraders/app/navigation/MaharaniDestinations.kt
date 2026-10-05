package com.maharanitraders.app.navigation

import com.maharanitraders.core.model.Workspace

/** Migration phase that delivers a destination's real UI. */
enum class MigrationPhase(val label: String) {
  /** Phase C — authentication & role handling. */
  AUTH("Phase C"),
  /** Phase D — retailer catalog, search and product detail. */
  CATALOG("Phase D"),
  /** Phase E — cart, checkout, orders and transaction safety. */
  ORDERS("Phase E"),
  /** Phase F — coins, notifications and banners. */
  ENGAGEMENT("Phase F"),
  /** Phase G — sales, warehouse and admin workspaces. */
  OPERATIONS("Phase G"),
}

/**
 * One navigable destination of the native shell.
 *
 * [workspace] is the server's own workspace id (`Workspace`), or `null` for
 * destinations every signed-in role may open. Nothing here encodes a
 * permission, a price or an identifier: the server decides what the account may
 * enter (`NavigationPolicy`), and this catalog only decides what the drawer
 * shows.
 */
data class MaharaniDestination(
  val route: String,
  val label: String,
  val workspace: Workspace?,
  val phase: MigrationPhase?,
  val summary: String,
)

object MaharaniRoutes {
  const val HOME = "home"
  const val CATALOG = "catalog"
  const val CATEGORIES = "categories"
  const val ACCOUNT = "account"
  /**
   * Product detail, parameterised by product OR pack id.
   *
   * The catalogue links to the variant the shopper was looking at, and the
   * server accepts either id for the same product — so the route does not need
   * to know which one it was given.
   */
  const val PRODUCT_DETAIL = "catalog/product/{productId}"

  /** The concrete route for one product, for `NavController.navigate`. */
  fun productDetail(productId: String): String = "catalog/product/$productId"

  const val FAVORITES = "favorites"
  /**
   * Quick order. A retailer shopping tool reached from the drawer: it searches
   * the real catalogue and adds through the real cart, exactly like the web
   * quick-order page.
   */
  const val QUICK_ORDER = "quick_order"
  const val CART = "cart"
  const val ORDERS = "orders"
  /**
   * The delivery address book. A sub-screen of the account tab, reached from
   * the account screen (and conceptually the same list checkout picks from), so
   * it is not a drawer destination of its own.
   */
  const val ADDRESS_BOOK = "account/addresses"
  const val COINS = "coins"
  const val NOTIFICATIONS = "notifications"
  const val COUPONS = "coupons"
  const val SALES_DESK = "sales_desk"
  const val WAREHOUSE = "warehouse"
  const val ADMINISTRATION = "administration"
}

/**
 * The destination catalog.
 *
 * Ordering is the order the drawer shows. Destinations whose phase has not
 * shipped render an explicit "planned" surface rather than mock data — the
 * migration contract forbids pretending a workflow exists.
 */
object MaharaniCatalog {

  val destinations: List<MaharaniDestination> = listOf(
    MaharaniDestination(
      route = MaharaniRoutes.HOME,
      label = "Home",
      workspace = null,
      phase = null,
      summary = "Your signed-in account and the workspaces the server allows.",
    ),
    MaharaniDestination(
      route = MaharaniRoutes.CATALOG,
      label = "Catalog",
      workspace = Workspace.RETAILER,
      // Phase D shipped: this destination now renders a real screen, so it no
      // longer carries a "planned" phase label.
      phase = null,
      summary = "Product catalogue, pack sizes, live availability and pricing from the existing backend.",
    ),
    MaharaniDestination(
      route = MaharaniRoutes.CATEGORIES,
      label = "Categories",
      workspace = Workspace.RETAILER,
      // Shipped with the native shopping redesign: a real directory over the
      // existing taxonomy endpoints, so no planned-phase label.
      phase = null,
      summary = "The shop's real category and brand directory, with live product counts.",
    ),
    MaharaniDestination(
      route = MaharaniRoutes.FAVORITES,
      label = "Favourites",
      workspace = Workspace.RETAILER,
      // Shipped: a real list over `GET /catalog/products?fav=1`, with the
      // server-owned favourite set behind it. No planned-phase label.
      phase = null,
      summary = "The products you saved, priced and stocked exactly as the catalogue shows them.",
    ),
    MaharaniDestination(
      route = MaharaniRoutes.QUICK_ORDER,
      label = "Quick order",
      workspace = Workspace.RETAILER,
      // Shipped: a name search and a pasted-list matcher over the quick-order
      // endpoints, with every add going through the revalidating cart API.
      phase = null,
      summary = "Restock known items fast: search by name or paste a list, priced by the server.",
    ),
    MaharaniDestination(
      route = MaharaniRoutes.CART,
      label = "Cart",
      workspace = Workspace.RETAILER,
      phase = null,
      summary = "Persistent server cart, authoritative checkout quote and idempotent order confirmation.",
    ),
    MaharaniDestination(
      route = MaharaniRoutes.ORDERS,
      label = "Orders",
      workspace = Workspace.RETAILER,
      phase = null,
      summary = "The retailer's actual order history, status, timestamps, totals and item snapshots.",
    ),
    MaharaniDestination(
      route = MaharaniRoutes.ACCOUNT,
      label = "Account",
      workspace = null,
      // Shipped with the native shopping redesign: the verified session, shown
      // as a profile screen. No new data, no new endpoint.
      phase = null,
      summary = "Your signed-in profile, shop status and access period, exactly as the server reports them.",
    ),
    MaharaniDestination(
      route = MaharaniRoutes.COINS,
      label = "Maharani Coins",
      workspace = Workspace.RETAILER,
      phase = null,
      summary = "Coin balance and ledger-backed redemption — always computed by the server.",
    ),
    MaharaniDestination(
      route = MaharaniRoutes.NOTIFICATIONS,
      label = "Notifications",
      workspace = null,
      phase = null,
      summary = "In-app notifications from order activity, account messages and marketplace news.",
    ),
    MaharaniDestination(
      route = MaharaniRoutes.COUPONS,
      label = "Coupons",
      workspace = Workspace.RETAILER,
      phase = null,
      summary = "Active coupons and offers you can apply to your next order.",
    ),
    MaharaniDestination(
      route = MaharaniRoutes.SALES_DESK,
      label = "Sales desk",
      workspace = Workspace.SALESMAN,
      phase = MigrationPhase.OPERATIONS,
      summary = "Salesman order capture for assigned retailers.",
    ),
    MaharaniDestination(
      route = MaharaniRoutes.WAREHOUSE,
      label = "Warehouse",
      workspace = Workspace.STAFF,
      phase = MigrationPhase.OPERATIONS,
      summary = "Pack-stock maintenance and order fulfilment for the active warehouse.",
    ),
    MaharaniDestination(
      route = MaharaniRoutes.ADMINISTRATION,
      label = "Administration",
      workspace = Workspace.ADMIN,
      phase = MigrationPhase.OPERATIONS,
      summary = "Retailer approvals, banners, catalogue and retention status (read-only dry runs).",
    ),
  )

  fun byRoute(route: String): MaharaniDestination? = destinations.firstOrNull { it.route == route }
}
