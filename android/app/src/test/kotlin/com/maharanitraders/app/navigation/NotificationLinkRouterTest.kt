package com.maharanitraders.app.navigation

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Which alert links the native shell is allowed to open.
 *
 * The rules that matter are the ones a bad link could exploit or a shopper could
 * be misled by: only a RELATIVE retailer path is honoured, only a destination this
 * build actually renders is returned, and everything else maps to "no navigation"
 * rather than to a browser hop or to a screen that happens to be nearby.
 */
class NotificationLinkRouterTest {

  @Test
  fun `maps the retailer destinations this build renders`() {
    assertEquals(MaharaniRoutes.HOME, NotificationLinkRouter.routeFor("/retailer/home"))
    assertEquals(MaharaniRoutes.CATALOG, NotificationLinkRouter.routeFor("/retailer/catalog"))
    assertEquals(MaharaniRoutes.CATEGORIES, NotificationLinkRouter.routeFor("/retailer/categories"))
    assertEquals(MaharaniRoutes.CART, NotificationLinkRouter.routeFor("/retailer/cart"))
    assertEquals(MaharaniRoutes.ORDERS, NotificationLinkRouter.routeFor("/retailer/orders"))
    assertEquals(MaharaniRoutes.FAVORITES, NotificationLinkRouter.routeFor("/retailer/favorites"))
    assertEquals(MaharaniRoutes.NOTIFICATIONS, NotificationLinkRouter.routeFor("/retailer/notifications"))
    assertEquals(MaharaniRoutes.COUPONS, NotificationLinkRouter.routeFor("/retailer/coupons"))
    assertEquals(MaharaniRoutes.ACCOUNT, NotificationLinkRouter.routeFor("/retailer/account"))
  }

  @Test
  fun `an order-scoped link opens the order history`() {
    // The per-order screen does not exist in this build yet. The history tab is a
    // real screen over the same order, so the tap goes there — and not to a page
    // the app would have to invent.
    assertEquals(
      MaharaniRoutes.ORDERS,
      NotificationLinkRouter.routeFor("/retailer/orders/6f0c1b3e-0000-4000-8000-000000000001"),
    )
  }

  @Test
  fun `a query, a fragment or a trailing slash does not hide the route`() {
    assertEquals(MaharaniRoutes.CART, NotificationLinkRouter.routeFor("/retailer/cart/?utm=push"))
    assertEquals(MaharaniRoutes.ORDERS, NotificationLinkRouter.routeFor("/retailer/orders#recent"))
    assertEquals(MaharaniRoutes.NOTIFICATIONS, NotificationLinkRouter.routeFor("/retailer/notifications"))
    assertEquals(MaharaniRoutes.CATALOG, NotificationLinkRouter.routeFor("  /retailer/catalog  "))
  }

  @Test
  fun `a nested route this build does not have is not forced onto a tab`() {
    // `/retailer/cart/checkout` is not the cart, and `/retailer/catalog/rice` is
    // not the unfiltered catalogue: both answer null so the feed leaves them alone.
    assertNull(NotificationLinkRouter.routeFor("/retailer/cart/checkout"))
    assertNull(NotificationLinkRouter.routeFor("/retailer/catalog/rice"))
    assertNull(NotificationLinkRouter.routeFor("/retailer/support/ticket-1"))
  }

  @Test
  fun `staff and admin destinations are never opened from a retailer alert`() {
    assertNull(NotificationLinkRouter.routeFor("/admin/returns"))
    assertNull(NotificationLinkRouter.routeFor("/staff/orders"))
    assertNull(NotificationLinkRouter.routeFor("/retailer/admin/returns"))
  }

  @Test
  fun `an absolute or protocol-relative link is not followed anywhere`() {
    // There is no browser surface in this app, and a link from the server is not
    // a reason to launch one. The path is only matched when it is relative.
    assertNull(NotificationLinkRouter.routeFor("https://maharanitraders.test/retailer/cart"))
    assertNull(NotificationLinkRouter.routeFor("http://evil.example/retailer/cart"))
    assertNull(NotificationLinkRouter.routeFor("//evil.example/retailer/cart"))
    assertNull(NotificationLinkRouter.routeFor("retailer/cart"))
  }

  @Test
  fun `an absent or unusable link opens nothing`() {
    assertNull(NotificationLinkRouter.routeFor(null))
    assertNull(NotificationLinkRouter.routeFor(""))
    assertNull(NotificationLinkRouter.routeFor("   "))
    assertNull(NotificationLinkRouter.routeFor("/"))
    assertNull(NotificationLinkRouter.routeFor("javascript:alert(1)"))
    // Matching is exact and case-sensitive, so a decorated path cannot smuggle a
    // route through.
    assertNull(NotificationLinkRouter.routeFor("/RETAILER/cart"))
  }
}
