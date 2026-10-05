package com.maharanitraders.app.navigation

/**
 * Where a notification's link takes the shopper in this app.
 *
 * An alert's `link_url` is the web route its producer wrote — `/retailer/cart`,
 * `/retailer/orders`, `/admin/…`, and so on. Only the retailer destinations this
 * build actually renders are mapped, and only from a RELATIVE path: an absolute
 * URL is not something the app will hop to, because there is no browser surface
 * here and no intent is launched. Everything else returns null, which the feed
 * renders as an alert without a chevron — an honest "this alert is information",
 * not a dead tap.
 *
 * `/retailer/orders/<id>` maps to the Orders tab on purpose. The tab is a real
 * screen over the real history; the per-order screen does not exist yet, and
 * sending someone to a fabricated order page would.
 */
object NotificationLinkRouter {

  /** The native route for one alert link, or null when this build cannot open it. */
  fun routeFor(linkUrl: String?): String? {
    val path = linkUrl?.trim()?.takeIf { it.isNotEmpty() } ?: return null
    if (!path.startsWith("/")) return null
    if (path.startsWith("//")) return null // protocol-relative: an absolute URL in disguise

    // Strip a query/fragment, then compare path segments — no regex, so a link
    // cannot be coaxed into matching by trailing punctuation.
    val clean = path.substringBefore('#').substringBefore('?').trimEnd('/')
    val segments = clean.split('/').filter { it.isNotEmpty() }
    if (segments.size < 2 || segments[0] != "retailer") return null

    return when (segments[1]) {
      "home" -> MaharaniRoutes.HOME
      "catalog" -> if (segments.size == 2) MaharaniRoutes.CATALOG else null
      "categories" -> MaharaniRoutes.CATEGORIES
      "cart" -> if (segments.size == 2) MaharaniRoutes.CART else null
      "orders" -> MaharaniRoutes.ORDERS
      "favorites" -> MaharaniRoutes.FAVORITES
      "notifications" -> MaharaniRoutes.NOTIFICATIONS
      "coupons" -> MaharaniRoutes.COUPONS
      "account" -> if (segments.size == 2) MaharaniRoutes.ACCOUNT else null
      else -> null
    }
  }
}
