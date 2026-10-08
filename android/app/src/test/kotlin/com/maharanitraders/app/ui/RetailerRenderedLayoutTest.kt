package com.maharanitraders.app.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.requiredSize
import androidx.compose.foundation.layout.requiredWidth
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.dp
import com.maharanitraders.core.designsystem.theme.MaharaniTheme
import com.maharanitraders.core.model.*
import com.maharanitraders.feature.catalog.*
import com.maharanitraders.feature.catalog.ui.*
import com.maharanitraders.feature.catalog.ui.components.*
import com.maharanitraders.feature.orders.*
import com.maharanitraders.feature.orders.ui.*
import com.maharanitraders.app.navigation.*
import com.maharanitraders.feature.orders.ui.OrderHistoryContent
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** JVM-rendered real Compose surfaces. Fixtures are test-only, NOT production data.
 * These checks do not assert live API/session integration or replace device screenshots. */
@RunWith(RobolectricTestRunner::class)
@Config(application = android.app.Application::class, sdk = [35], qualifiers = "w412dp-h900dp-xhdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class RetailerRenderedLayoutTest {
  @get:Rule val compose = createComposeRule()
  private val categories = listOf(CatalogCategory("category", "Staples and groceries", null, 2, "Food"))
  private val brands = listOf(CatalogBrand("brand", "Test supplier", null, 2))
  private val pack = CatalogPack("pack", "1 kg pouch", 12, 6, 12500, 15000, 150000, emptyList(), PackAvailability.IN_STOCK)
  private val products = (1..4).map { CatalogProduct("p$it", "Long product name for compact retailer cards $it", "Test supplier", null, false, "category", "brand", false, false, pack.copy(packId = "pack$it")) }

  private fun render(width: Int, content: @Composable () -> Unit) {
    compose.setContent {
      MaharaniTheme(darkTheme = false) {
        Box(Modifier.requiredSize(width.dp, 800.dp).testTag("viewport")) { content() }
      }
    }
  }
  @Composable
  private fun catalog(tab: CatalogTab = CatalogTab.PRODUCTS) {
    CatalogContent(
      state = CatalogUiState(loading = false, products = products, categories = categories, brands = brands,
        categoriesLoaded = true, brandsLoaded = true, tab = tab),
      onSearchChange = {}, onSelectCategory = {}, onSelectSort = {}, onToggleInStock = {},
      onClearBrand = {}, onClearFilters = {}, onRetry = {}, onLoadMore = {}, onOpenProduct = {},
      onQuickAddToCart = { _, _ -> },
    )
  }
  private fun catalogChecks(width: Int) {
    render(width) { catalog() }
    compose.onNodeWithTag(CatalogScreenTags.TAB_CATEGORIES).assertIsDisplayed().assertHeightIsAtLeast(48.dp)
    compose.onNodeWithTag(CatalogScreenTags.TAB_BRANDS).assertIsDisplayed().assertHeightIsAtLeast(48.dp)
    compose.onAllNodesWithTag(PRODUCT_CARD_TAG).onFirst().assertIsDisplayed()
    compose.onNodeWithTag("${ADD_TO_CART_TAG}_pack1").assertIsDisplayed().assertHeightIsAtLeast(48.dp)
    val cards = compose.onAllNodesWithTag(PRODUCT_CARD_TAG).fetchSemanticsNodes()
    check(cards.size >= 2)
    // Two real rendered columns rather than merely asserting a dimension token.
    check(cards[0].boundsInRoot.top == cards[1].boundsInRoot.top)
    check(cards[0].boundsInRoot.right <= cards[1].boundsInRoot.left)
    val root = compose.onNodeWithTag("viewport").fetchSemanticsNode().boundsInRoot
    check(cards.take(2).all { it.boundsInRoot.left >= root.left && it.boundsInRoot.right <= root.right })
  }
  @Test fun catalog360() = catalogChecks(360)
  @Test fun catalog393() = catalogChecks(393)
  @Test fun catalog412() = catalogChecks(412)
  private fun categoryChecks(width: Int) {
    render(width) { catalog(CatalogTab.CATEGORIES) }
    compose.onNodeWithText("Staples and groceries").assertIsDisplayed()
    compose.onNodeWithText("Food · 2 items").assertIsDisplayed()
  }
  @Test fun categories360() = categoryChecks(360)
  @Test fun categories393() = categoryChecks(393)
  @Test fun categories412() = categoryChecks(412)
  private fun brandChecks(width: Int) {
    render(width) { catalog(CatalogTab.BRANDS) }
    compose.onNodeWithText("Test supplier").assertIsDisplayed()
  }
  @Test fun brands360() = brandChecks(360)
  @Test fun brands393() = brandChecks(393)
  @Test fun brands412() = brandChecks(412)
  private fun homeChecks(width: Int) {
    render(width) {
      HomeContent(HomeUiState(loading = false, home = RetailerHome(emptyList(), categories, brands, products, null)),
        onRetry = {}, onOpenCatalog = {}, onOpenCategory = {}, onOpenBrand = {}, onOpenDirectory = {}, onOpenProduct = {})
    }
    compose.onNodeWithText("Shop by category").assertIsDisplayed()
  }
  @Test fun home360() = homeChecks(360)
  @Test fun home393() = homeChecks(393)
  @Test fun home412() = homeChecks(412)
  private fun orderChecks(width: Int) {
    render(width) { OrderHistoryContent(OrderHistoryUiState(loading = false), {}, {}, {}) }
    compose.onNodeWithText("No orders yet").assertIsDisplayed()
    compose.onNodeWithText("Refresh").assertIsDisplayed().performClick()
  }
  @Test fun orders360() = orderChecks(360)
  @Test fun orders393() = orderChecks(393)
  @Test fun orders412() = orderChecks(412)
  private fun accountChecks(width: Int) {
    val snapshot = SessionSnapshot(SessionUser("test", null, UserRole.RETAILER, "Test shop owner", null, true),
      RetailerContext(RetailerStatus.ACTIVE, "Test shop"), null,
      NavigationPolicy("/retailer/home", listOf(Workspace.RETAILER), setOf("orders.create", "orders.view.own")))
    render(width) { AccountScreen(snapshot, {}) }
    compose.onNodeWithText("Test shop owner").assertIsDisplayed()
  }
  @Test fun account360() = accountChecks(360)
  @Test fun account393() = accountChecks(393)
  @Test fun account412() = accountChecks(412)
  private fun detailChecks(width: Int) {
    val detailPack = ProductPackDetail("pack", "1 kg pouch", 12, 6, true, 12500, 75000, 5.0, 15000, 150000,
      emptyList(), PackAvailability.IN_STOCK, true, emptyList(), null)
    val detail = ProductDetail("p1", "Long product detail name", "Test supplier", "category", "Staples", "kg", null,
      5.0, 2, false, false, false, emptyList(), listOf(detailPack))
    render(width) {
      ProductDetailContent(ProductDetailUiState(loading = false, detail = detail), {}, {}, {}, { _, _ -> }, true)
    }
    compose.onNodeWithTag(ProductDetailTags.ADD_TO_CART).assertIsDisplayed().assertHeightIsAtLeast(48.dp)
  }
  @Test fun detail360() = detailChecks(360)
  @Test fun detail393() = detailChecks(393)
  @Test fun detail412() = detailChecks(412)
  @Composable private fun detailFixture() {
    val detailPack = ProductPackDetail("pack", "1 kg pouch", 12, 6, true, 12500, 75000, 5.0, 15000, 150000,
      emptyList(), PackAvailability.IN_STOCK, true, emptyList(), null)
    val detail = ProductDetail("p1", "Long product detail name", "Test supplier", "category", "Staples", "kg", null,
      5.0, 2, false, false, false, emptyList(), listOf(detailPack))
    ProductDetailContent(ProductDetailUiState(loading = false, detail = detail), {}, {}, {}, { _, _ -> }, true)
  }
  private fun quoteChecks(width: Int) {
    val address = DeliveryAddress("address", "Test shop", "Test road", null, null, true)
    render(width) { QuoteTotals(CheckoutQuote(emptyList(), 87500, 4375, 1000, 90875, 5000, 500, 4500, null, address)) }
    for(label in listOf("Subtotal", "GST", "Coupon discount", "Grand total", "Coins available", "Coins applied", "Coins balance after applying"))
      compose.onNodeWithText(label).assertIsDisplayed()
  }
  @Test fun serverTotals360() = quoteChecks(360)
  @Test fun serverTotals393() = quoteChecks(393)
  @Test fun serverTotals412() = quoteChecks(412)
  private val cartLine = CartLine("line", "pack", "p1", "Long grocery product name for compact shopping", "Test supplier", null,
    "1 kg pouch", 7, "pieces", 1, 6, 12, 12500, 87500, 5.0, "in_stock", true, null)
  private var increaseCalls = 0
  private var checkoutCalls = 0
  @Composable private fun cart() {
    CartContent(CartCheckoutUiState(cartLoading = false, cart = CartSnapshot(listOf(cartLine), null, false, 1, 7)),
      CartUiActions(
      applyCoupon = {},
      beginCheckout = { checkoutCalls++ },
      checkPendingOrder = {},
      clearCart = {},
      clearMessage = {},
      clearSelection = {},
      consumeBulkMessage = {},
      decrement = { _ -> },
      dismissNotices = {},
      increment = { _ -> increaseCalls++ },
      moveSelectedToFavourites = {},
      refreshCart = {},
      removeCartLine = { _ -> },
      removeCoupon = {},
      removeSelected = {},
      selectAllOrderable = {},
      setCouponInput = { _ -> },
      toggleLineSelection = { _ -> },
    ), {}, {}, false, null, null, "", {}, {}, false)
  }
  private fun cartChecks(width: Int) {
    render(width) { cart() }
    compose.onNodeWithTag(CommerceTags.CART_ITEM_IMAGE).assertIsDisplayed()
    compose.onNodeWithTag("${CommerceTags.CART_QUANTITY}_plus_line").performScrollTo().assertIsDisplayed().assertHeightIsAtLeast(48.dp).performClick()
    check(increaseCalls > 0)
    compose.onNodeWithTag("cart_remove_line").performScrollTo().assertHeightIsAtLeast(48.dp)
    compose.onNodeWithText("MOQ 6 pcs · increment 1").performScrollTo().assertIsDisplayed()
    compose.onNodeWithTag(CommerceTags.CART_CHECKOUT).performScrollTo().assertIsDisplayed().assertHeightIsAtLeast(48.dp).performClick()
    check(checkoutCalls > 0)
    val viewport = compose.onNodeWithTag("viewport").fetchSemanticsNode().boundsInRoot
    val cta = compose.onNodeWithTag(CommerceTags.CART_CHECKOUT).fetchSemanticsNode().boundsInRoot
    check(cta.left >= viewport.left && cta.right <= viewport.right)
  }
  @Test fun cart360() = cartChecks(360)
  @Test fun cart393() = cartChecks(393)
  @Test fun cart412() = cartChecks(412)
  private val order = RetailerOrder("order", "TEST-2026-001", "confirmed", 87500, 4375, 1000, 90875,
    "2026-10-08T10:00:00Z", "2026-10-08T10:00:00Z", null, null,
    listOf(OrderItem("item", "p1", "pack", "Test grocery product", "1 kg pouch", 7, "pieces", 7, 12, 12500, 5.0, 87500)), 500, 90375)
  private fun populatedOrderChecks(width: Int) {
    render(width) { OrderHistoryContent(OrderHistoryUiState(loading = false, orders = listOf(order)), {}, {}, {}) }
    compose.onNodeWithText("TEST-2026-001").assertIsDisplayed()
    compose.onNodeWithText("Test grocery product · 7 pieces").assertIsDisplayed()
    compose.onNodeWithTag("order_reorder_order").assertIsDisplayed().assertHeightIsAtLeast(48.dp).performClick()
  }
  @Test fun populatedOrders360() = populatedOrderChecks(360)
  @Test fun populatedOrders393() = populatedOrderChecks(393)
  @Test fun populatedOrders412() = populatedOrderChecks(412)
  private fun shellChecks(width: Int) {
    val snapshot = SessionSnapshot(SessionUser("test", null, UserRole.RETAILER, "Test owner", null, true),
      RetailerContext(RetailerStatus.ACTIVE, "Test shop"), null,
      NavigationPolicy("/retailer/home", listOf(Workspace.RETAILER), setOf("orders.create", "orders.view.own")))
    val source = object : ShellRenderSource {
      override val cartCount = 1
      override val unreadCount = 2
      @Composable override fun Content(route: String, request: CatalogRequest, navigate: (String) -> Unit) {
        when (route) {
          MaharaniRoutes.HOME -> HomeContent(HomeUiState(loading = false, home = RetailerHome(emptyList(), categories, brands, products, null)),
            {}, { navigate(MaharaniRoutes.CATALOG) }, onOpenCategory = { navigate(MaharaniRoutes.CATEGORIES) },
            onOpenBrand = { navigate(MaharaniRoutes.BRANDS) }, onOpenDirectory = { navigate(if(it == CatalogTab.CATEGORIES) MaharaniRoutes.CATEGORIES else MaharaniRoutes.BRANDS) },
            onOpenProduct = { navigate(MaharaniRoutes.productDetail(it)) })
          MaharaniRoutes.CATALOG, MaharaniRoutes.CATEGORIES, MaharaniRoutes.BRANDS -> CatalogContent(
            CatalogUiState(loading = false, products = products, categories = categories, brands = brands, categoriesLoaded = true, brandsLoaded = true,
              tab = if(route == MaharaniRoutes.CATEGORIES) CatalogTab.CATEGORIES else if(route == MaharaniRoutes.BRANDS) CatalogTab.BRANDS else CatalogTab.PRODUCTS),
            onSearchChange = {}, onSelectTab = { navigate(if(it == CatalogTab.CATEGORIES) MaharaniRoutes.CATEGORIES else if(it == CatalogTab.BRANDS) MaharaniRoutes.BRANDS else MaharaniRoutes.CATALOG) },
            onSelectCategory = { navigate(MaharaniRoutes.CATALOG) }, onSelectSort = {}, onToggleInStock = {}, onClearBrand = {}, onClearFilters = {}, onRetry = {}, onLoadMore = {},
            onOpenProduct = { navigate(MaharaniRoutes.productDetail(it)) })
          MaharaniRoutes.CART -> cart()
          MaharaniRoutes.ORDERS -> OrderHistoryContent(OrderHistoryUiState(loading = false, orders = listOf(order)), {}, {}, {})
          MaharaniRoutes.ACCOUNT -> AccountScreen(snapshot, {})
          MaharaniRoutes.PRODUCT_DETAIL -> detailFixture()
          else -> androidx.compose.material3.Text("Test destination $route")
        }
      }
    }
    compose.setContent {
      MaharaniTheme(darkTheme = false) {
        // Shell must fill the actual Activity window; an oversized required
        // height would place its bottom navigation outside the test window.
        Box(Modifier.requiredWidth(width.dp).fillMaxHeight().testTag("viewport")) {
          AuthenticatedShell(snapshot, {}, source)
        }
      }
    }
    compose.onNodeWithTag(ShellTags.BRAND).assertIsDisplayed()
    // NavigationBarItem merges descendant semantics; badge is a real child.
    compose.onNodeWithTag(ShellTags.CART_BADGE, useUnmergedTree = true).assertIsDisplayed()
    for (route in listOf(MaharaniRoutes.CATALOG, MaharaniRoutes.BRANDS, MaharaniRoutes.ORDERS, MaharaniRoutes.CART, MaharaniRoutes.HOME)) {
      compose.onNodeWithTag("shell_tab_$route").performClick().assertIsSelected()
      compose.onNodeWithTag(ShellTags.BOTTOM_BAR).assertIsDisplayed()
    }
    compose.onNodeWithTag("shell_tab_${MaharaniRoutes.CATALOG}").performClick()
    compose.onNodeWithTag(CatalogScreenTags.TAB_CATEGORIES).performClick()
    compose.onNodeWithTag("shell_tab_${MaharaniRoutes.CATALOG}").assertIsSelected()
    compose.onNodeWithTag("shell_tab_${MaharaniRoutes.CATALOG}").performClick()
    compose.waitUntil(timeoutMillis = 5000) { compose.onAllNodesWithTag(PRODUCT_CARD_TAG).fetchSemanticsNodes().isNotEmpty() }
    compose.onAllNodesWithTag(PRODUCT_CARD_TAG).onFirst().performClick()
    compose.onNodeWithTag(ProductDetailTags.ADD_TO_CART).assertIsDisplayed().assertHeightIsAtLeast(48.dp)
    // Detail has its own back app bar; use the real back glyph to return.
    compose.onNodeWithContentDescription("Navigate back").performClick()
    compose.onNodeWithTag(ShellTags.OPEN_ACCOUNT).performClick()
    compose.onNodeWithText("Test owner").assertIsDisplayed()
  }
  @Test fun shell360() = shellChecks(360)
  @Test fun shell393() = shellChecks(393)
  @Test fun shell412() = shellChecks(412)

}
