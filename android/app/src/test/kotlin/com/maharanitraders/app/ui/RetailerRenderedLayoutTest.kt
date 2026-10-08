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
@Config(sdk = [35], qualifiers = "w412dp-h900dp-xhdpi")
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
  @Test fun categories360() { render(360) { catalog(CatalogTab.CATEGORIES) }; compose.onNodeWithText("Staples and groceries").assertIsDisplayed() }
  @Test fun brands393() { render(393) { catalog(CatalogTab.BRANDS) }; compose.onNodeWithText("Test supplier").assertIsDisplayed() }
  @Test fun home412() {
    render(412) {
      HomeContent(HomeUiState(loading = false, home = RetailerHome(emptyList(), categories, brands, products, null)),
        onRetry = {}, onOpenCatalog = {}, onOpenCategory = {}, onOpenBrand = {}, onOpenDirectory = {}, onOpenProduct = {})
    }
    compose.onNodeWithText("Shop by category").assertIsDisplayed()
  }
  @Test fun orders360EmptyAndRetryReachable() {
    render(360) { OrderHistoryContent(OrderHistoryUiState(loading = false), {}, {}, {}) }
    compose.onNodeWithText("No orders yet").assertIsDisplayed()
    compose.onNodeWithText("Refresh").assertIsDisplayed().performClick()
  }
  @Test fun account393() {
    val snapshot = SessionSnapshot(SessionUser("test", null, UserRole.RETAILER, "Test shop owner", null, true),
      RetailerContext(RetailerStatus.ACTIVE, "Test shop"), null,
      NavigationPolicy("/retailer/home", listOf(Workspace.RETAILER), setOf("orders.create", "orders.view.own")))
    render(393) { AccountScreen(snapshot, {}) }
    compose.onNodeWithText("Test shop owner").assertIsDisplayed()
  }
}
