package com.maharanitraders.app.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.requiredSize
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
import com.maharanitraders.feature.orders.OrderHistoryUiState
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
}
