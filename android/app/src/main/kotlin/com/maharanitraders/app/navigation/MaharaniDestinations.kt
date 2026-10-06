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

  /**
   * One order's full record, invoice and delivery note.
   *
   * Sub-screens of the orders tab rather than drawer destinations: they are
   * reached from the history list (and from each other), never from the shell
   * menu, and each carries the order id it belongs to.
   */
  const val ORDER_DETAIL = "orders/{orderId}"

  /** The concrete detail route for one order, for `NavController.navigate`. */
  fun orderDetail(orderId: String): String = "orders/$orderId"

  /** The GST invoice of one order, computed server-side. */
  const val ORDER_INVOICE = "orders/{orderId}/invoice"

  fun orderInvoice(orderId: String): String = "orders/$orderId/invoice"

  /** The delivery record of one order. */
  const val ORDER_DELIVERY = "orders/{orderId}/delivery"

  fun orderDelivery(orderId: String): String = "orders/$orderId/delivery"

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

  /**
   * The in-account security screen (change password). A sub-screen of the
   * account tab over the authenticated `POST /auth/password-update` endpoint,
   * reached from the account screen — not a drawer destination of its own.
   */
  const val SECURITY = "account/security"

  /** The help centre: static FAQs mirroring the web help page, plus the account's real shortcuts. */
  const val HELP = "help"

  /** The retailer's own shop profile (GET/PATCH /api/mobile/v1/profile). */
  const val PROFILE = "account/profile"

  /** Notification preferences (GET/PUT /api/mobile/v1/notifications/preferences). */
  const val NOTIFICATION_PREFERENCES = "account/notification-preferences"

  /** Saved carts: the caller's stored baskets (GET /api/mobile/v1/saved-carts). */
  const val SAVED_CARTS = "saved_carts"

  /** Support tickets and replies (GET/POST /api/mobile/v1/support/tickets). */
  const val SUPPORT = "support"

  /** Running schemes (GET /api/mobile/v1/schemes). */
  const val SCHEMES = "schemes"

  /** Purchase reports and statements (GET /api/mobile/v1/reports, /reports/statement). */
  const val REPORTS = "reports"
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
      route = MaharaniRoutes.PROFILE,
      label = "Shop profile",
      workspace = Workspace.RETAILER,
      phase = null,
      summary = "Edit owner contact and shop identity through the retailer-scoped profile API.",
    ),
    MaharaniDestination(
      route = MaharaniRoutes.NOTIFICATION_PREFERENCES,
      label = "Notification settings",
      workspace = Workspace.RETAILER,
      phase = null,
      summary = "Choose the in-app order, payment, Coins and offer update categories you receive.",
    ),
    MaharaniDestination(
      route = MaharaniRoutes.SECURITY,
      label = "Security & privacy",
      workspace = Workspace.RETAILER,
      phase = null,
      summary = "Change your password, revoke sessions, and submit data or account requests.",
    ),
    MaharaniDestination(
      route = MaharaniRoutes.SAVED_CARTS,
      label = "Saved carts",
      workspace = Workspace.RETAILER,
      phase = null,
      summary = "Save and restore owner-scoped cart lists, revalidated against current packs and minimums.",
    ),
    MaharaniDestination(
      route = MaharaniRoutes.SCHEMES,
      label = "Active schemes",
      workspace = Workspace.RETAILER,
      phase = null,
      summary = "Active schemes returned by the existing retailer service.",
    ),
    MaharaniDestination(
      route = MaharaniRoutes.REPORTS,
      label = "Purchase reports",
      workspace = Workspace.RETAILER,
      phase = null,
      summary = "Weekly and monthly purchase summaries and server-generated CSV statements.",
    ),
    MaharaniDestination(
      route = MaharaniRoutes.SUPPORT,
      label = "Support tickets",
      workspace = Workspace.RETAILER,
      phase = null,
      summary = "Private support tickets and owner-scoped retailer conversations.",
    ),
    MaharaniDestination(
      route = MaharaniRoutes.HELP,
      label = "Help centre",
      workspace = Workspace.RETAILER,
      phase = null,
      summary = "Configured support contact details and help for retailer commerce flows.",
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
