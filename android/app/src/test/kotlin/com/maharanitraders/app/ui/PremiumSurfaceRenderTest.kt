package com.maharanitraders.app.ui

import android.app.Application
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.getUnclippedBoundsInRoot
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.unit.dp
import com.google.common.truth.Truth.assertThat
import com.maharanitraders.core.designsystem.theme.MaharaniDimens
import com.maharanitraders.core.designsystem.theme.MaharaniTheme
import com.maharanitraders.core.model.CatalogBrand
import com.maharanitraders.core.model.CatalogCategory
import com.maharanitraders.core.model.CatalogPack
import com.maharanitraders.core.model.CatalogProduct
import com.maharanitraders.core.model.CatalogQuery
import com.maharanitraders.core.model.HomeScheme
import com.maharanitraders.core.model.PackAvailability
import com.maharanitraders.core.model.PromoBanner
import com.maharanitraders.core.model.RetailerHome
import com.maharanitraders.core.model.SearchSuggestion
import com.maharanitraders.core.model.SearchSuggestions
import com.maharanitraders.feature.catalog.CatalogFilterDraft
import com.maharanitraders.feature.catalog.HomePromo
import com.maharanitraders.feature.catalog.HomeUiState
import com.maharanitraders.feature.catalog.ui.CatalogFilterButton
import com.maharanitraders.feature.catalog.ui.CatalogFilterSheet
import com.maharanitraders.feature.catalog.ui.CatalogFilterTags
import com.maharanitraders.feature.catalog.ui.HomeContent
import com.maharanitraders.feature.catalog.ui.HomeOfferTags
import com.maharanitraders.feature.catalog.ui.HomeScreenTags
import com.maharanitraders.feature.catalog.ui.SearchSuggestionPanel
import com.maharanitraders.feature.catalog.ui.SearchSuggestionTags
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * RENDERED tests: these composables are really composed, measured and laid out by
 * Robolectric's Android runtime, and every assertion is made against the
 * resulting semantics tree — not against a re-implementation, a token that only
 * claims a size, or a screenshot a human has to look at.
 *
 * WHY THIS FILE EXISTS
 * A layout bug is invisible to a unit test. "Every touch target is 48dp" as a
 * constant in `MaharaniDimens` says nothing about whether a chip row still fits
 * 360dp once the label, the leading icon and the horizontal padding are added up;
 * only measuring the laid-out node does. So these tests render the surfaces this
 * change added at the three widths the acceptance pass names, and assert what a
 * design review would have caught:
 *
 *  - nothing is wider than the window it is in (no clipping, no overflow);
 *  - the controls a shopper must be able to hit really clear 48dp once laid out;
 *  - a failed read and an empty answer render as two DIFFERENT surfaces.
 *
 * WHY A PLAIN `Application`
 * `@Config(application = Application::class)` keeps the Hilt application out of
 * the test. Nothing here needs the graph: every surface under test is the
 * stateless composable the screen calls, fed a state built in the test. That is
 * also what makes these honest — they render the SAME function production
 * renders, with the SAME arguments, rather than a Hilt-injected screen whose
 * ViewModel would have to be faked anyway.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], application = Application::class)
class PremiumSurfaceRenderTest {

  @get:Rule
  val compose = createComposeRule()

  /**
   * The three widths the responsive acceptance pass is specified at.
   *
   * 360dp is the narrowest phone still in wide use and the one every overflow bug
   * shows up on first; 393dp and 412dp are the current Pixel widths. The first two
   * qualifier strings are AOSP's own device definitions (SmallPhone, Pixel 5);
   * 412dp is one wider than AOSP's 411dp Pixel 8 so the widest breakpoint named in
   * the acceptance criteria is covered too.
   */
  private object Widths {
    const val NARROW_360 = "w360dp-h640dp-normal-long-notround-any-xhdpi-keyshidden-nonav"
    const val MEDIUM_393 = "w393dp-h851dp-normal-long-notround-any-440dpi-keyshidden-nonav"
    const val WIDE_412 = "w412dp-h892dp-normal-long-notround-any-420dpi-keyshidden-nonav"
  }

  // ------------------------------------------------------------------ fixtures

  private fun pack(id: String) = CatalogPack(
    packId = "pack-$id",
    packName = "5kg Sack",
    unitsPerCase = 4,
    moq = 4,
    unitPricePaise = 815_000,
    mrpPaise = 960_000,
    derivedCasePricePaise = 3_260_000,
    tiers = emptyList(),
    availability = PackAvailability.IN_STOCK,
  )

  private fun product(id: String, offer: Boolean = false) = CatalogProduct(
    id = id,
    name = "Sona Masoori Rice $id",
    brandName = "Maharani",
    // Null on purpose: a real URL would make the image loader open a socket in a
    // JVM test, and the card's monogram fallback is a supported rendered state.
    imageUrl = null,
    isNewLaunch = false,
    categoryId = "c1",
    brandId = "b1",
    hasOffer = offer,
    isFavorite = false,
    pack = pack(id),
  )

  private val schemes = listOf(
    HomeScheme(
      id = "s1",
      name = "Diwali wholesale week",
      description = "Extra slab rates on staples",
      isFestival = true,
      startsAt = "2026-10-01T00:00:00.000Z",
      endsAt = "2026-11-05T00:00:00.000Z",
    ),
    HomeScheme(
      id = "s2",
      name = "Monsoon staples",
      description = null,
      isFestival = false,
      startsAt = "2026-10-01T00:00:00.000Z",
      endsAt = "2026-10-09T00:00:00.000Z",
    ),
  )

  private val home = RetailerHome(
    banners = listOf(
      PromoBanner(
        id = "banner-1",
        title = "Wholesale week",
        subtitle = "Slab rates on staples",
        imageUrl = null,
        ctaLabel = "Shop now",
        linkUrl = "/retailer/catalog",
      ),
    ),
    categories = listOf(
      CatalogCategory(id = "c1", name = "Rice & Grains", imageUrl = null, productCount = 12),
      CatalogCategory(id = "c2", name = "Edible Oils", imageUrl = null, productCount = null),
    ),
    brands = listOf(
      CatalogBrand(id = "b1", name = "India Gate", logoUrl = null, productCount = 5),
      CatalogBrand(id = "b2", name = "Fortune", logoUrl = null, productCount = null),
    ),
    products = listOf(product("p1"), product("p2"), product("p3")),
    nextCursor = null,
    schemes = schemes,
    schemesUnavailable = false,
  )

  /** 2026-10-08T00:00:00Z — the same pinned clock `HomePromoTest` uses. */
  private val nowMillis = 1_791_417_600_000L

  private fun homeState(
    deals: List<CatalogProduct> = listOf(product("d1", offer = true), product("d2", offer = true)),
    promotions: List<HomePromo.OfferCard> = HomePromo.cards(schemes, nowMillis),
    offers: List<HomeScheme> = schemes,
    offersUnavailable: Boolean = false,
  ) = HomeUiState(
    loading = false,
    refreshing = false,
    home = home,
    recent = listOf(product("n1")),
    recentLoading = false,
    deals = deals,
    dealsLoading = false,
    offers = offers,
    offersUnavailable = offersUnavailable,
    promotions = promotions,
    errorMessage = null,
    offline = false,
    retryable = true,
  )

  private fun setHome(state: HomeUiState = homeState()) {
    compose.setContent {
      MaharaniTheme(darkTheme = false) {
        HomeContent(
          state = state,
          onRetry = {},
          onOpenCatalog = {},
          onOpenCategory = {},
          onOpenBrand = {},
          onOpenDirectory = {},
          onOpenProduct = {},
          onOpenOffers = {},
          onOpenDeals = {},
          // Pinned: a strip that rolls on a timer is not what these assertions
          // are about, and a test that waits for an animation it did not ask for
          // is a flaky test.
          tickerAutoAdvance = false,
          onQuickAddToCart = { _, _ -> },
        )
      }
    }
    compose.waitForIdle()
  }

  // ---------------------------------------------------------------- assertions

  /**
   * Nothing may be wider than the window it is in.
   *
   * This is the assertion behind "no clipping, no overlap, no hidden CTA": a node
   * whose unclipped bounds escape the root has been pushed off the screen by
   * something beside it, and on a real phone that is a control the shopper can see
   * part of and cannot reach.
   */
  private fun assertInsideRoot(vararg tags: String) {
    val root = compose.onRoot().getUnclippedBoundsInRoot()
    tags.forEach { tag ->
      val nodes = compose.onAllNodesWithTag(tag)
      val count = nodes.fetchSemanticsNodes().size
      assertThat(count).isGreaterThan(0)
      repeat(count) { index ->
        val bounds = nodes[index].getUnclippedBoundsInRoot()
        assertThat(bounds.left).isAtLeast(root.left)
        assertThat(bounds.right).isAtMost(root.right)
      }
    }
  }

  /** The same containment check, against a parent node instead of the root. */
  private fun assertInside(parentTag: String, vararg tags: String) {
    val parent = compose.onNodeWithTag(parentTag).getUnclippedBoundsInRoot()
    tags.forEach { tag ->
      val bounds = compose.onNodeWithTag(tag).getUnclippedBoundsInRoot()
      assertThat(bounds.left).isAtLeast(parent.left)
      assertThat(bounds.right).isAtMost(parent.right)
    }
  }

  private fun assertTouchTarget(tag: String) {
    val bounds = compose.onAllNodesWithTag(tag).onFirst().getUnclippedBoundsInRoot()
    assertThat(bounds.height).isAtLeast(MaharaniDimens.touchTarget)
  }

  private fun assertNotExists(tag: String) {
    assertThat(compose.onAllNodesWithTag(tag).fetchSemanticsNodes()).isEmpty()
  }

  // --------------------------------------------------------------------- home

  @Test
  @Config(qualifiers = Widths.NARROW_360)
  fun `the promotional home renders inside 360dp`() = assertHomeRenders()

  @Test
  @Config(qualifiers = Widths.MEDIUM_393)
  fun `the promotional home renders inside 393dp`() = assertHomeRenders()

  @Test
  @Config(qualifiers = Widths.WIDE_412)
  fun `the promotional home renders inside 412dp`() = assertHomeRenders()

  private fun assertHomeRenders() {
    setHome()

    // The admin ticker leads the page and names a campaign the fixture published.
    compose.onNodeWithTag(HomeOfferTags.TICKER).assertIsDisplayed()
    compose.onNodeWithTag(HomeOfferTags.TICKER_LINE).assertIsDisplayed()
    // Both the strip and the rail card name the same campaign, so the text is
    // asserted across all matches rather than on one ambiguous node.
    assertThat(
      compose.onAllNodesWithText("Diwali wholesale week").fetchSemanticsNodes().size,
    ).isAtLeast(2)
    // The deadline is counted from the row's own window by the pinned clock, and
    // it is the fact that makes a shopper tap — so it is asserted, not assumed.
    compose.onAllNodesWithText("Ends in 28 days").onFirst().assertIsDisplayed()

    // The offers rail draws one card per published campaign, and no more.
    compose.onNodeWithTag(HomeOfferTags.OFFER_RAIL).assertIsDisplayed()
    assertThat(compose.onAllNodesWithTag(HomeOfferTags.OFFER_CARD).fetchSemanticsNodes())
      .hasSize(2)

    // The Deals rail is present, and the discovery grid and the two directory
    // rails are still where they were: the promotional surfaces are additions to
    // the hierarchy, not replacements for it.
    compose.onNodeWithTag(HomeOfferTags.DEALS_ROW).assertIsDisplayed()
    compose.onNodeWithTag(HomeScreenTags.CATEGORY_ROW).assertIsDisplayed()
    compose.onNodeWithTag(HomeScreenTags.BRAND_ROW).assertIsDisplayed()
    compose.onNodeWithTag(HomeScreenTags.PRODUCT_GRID).assertIsDisplayed()

    // The RAILS are asserted to sit inside the window; their CARDS are not, on
    // purpose. A rail is a horizontal scroller, so the last card legitimately
    // continues past the viewport — that is what makes it a rail. Asserting a card
    // inside the window would either fail on a correct layout or force the rail to
    // stop scrolling, and both are worse than the assertion is worth.
    assertInsideRoot(
      HomeOfferTags.TICKER,
      HomeOfferTags.OFFER_RAIL,
      HomeOfferTags.DEALS_ROW,
      HomeScreenTags.CATEGORY_ROW,
      HomeScreenTags.BRAND_ROW,
    )
    // The ticker and the campaign cards are tappable, so they are controls: 48dp
    // minimum, measured after layout.
    assertTouchTarget(HomeOfferTags.TICKER)
    assertTouchTarget(HomeOfferTags.OFFER_CARD)
  }

  @Test
  @Config(qualifiers = Widths.NARROW_360)
  fun `a home with no published campaign draws no promotional surface at 360dp`() {
    setHome(homeState(deals = emptyList(), promotions = emptyList(), offers = emptyList()))

    // No scheme means no strip and no rail — and, just as importantly, no
    // fabricated "no offers right now" copy in their place.
    assertNotExists(HomeOfferTags.TICKER)
    assertNotExists(HomeOfferTags.OFFER_RAIL)
    assertNotExists(HomeOfferTags.OFFERS_UNAVAILABLE)
    compose.onNodeWithTag(HomeScreenTags.PRODUCT_GRID).assertIsDisplayed()
  }

  @Test
  @Config(qualifiers = Widths.NARROW_360)
  fun `a FAILED offer read is not rendered as a shop with no offers at 360dp`() {
    setHome(
      homeState(
        deals = emptyList(),
        promotions = emptyList(),
        offers = emptyList(),
        offersUnavailable = true,
      ),
    )

    // The distinction the whole design turns on: an outage says so, in one line,
    // while the shop underneath stays perfectly usable.
    compose.onNodeWithTag(HomeOfferTags.OFFERS_UNAVAILABLE).assertIsDisplayed()
    compose.onNodeWithText(
      "Live offers could not load. Prices, stock and totals are unaffected.",
    ).assertIsDisplayed()
    compose.onNodeWithTag(HomeScreenTags.PRODUCT_GRID).assertIsDisplayed()
    assertInsideRoot(HomeOfferTags.OFFERS_UNAVAILABLE)
  }

  // ----------------------------------------------------------- filter sheet

  @Test
  @Config(qualifiers = Widths.NARROW_360)
  fun `the filter sheet fits 360dp and its controls clear 48dp`() = assertFilterSheet()

  @Test
  @Config(qualifiers = Widths.MEDIUM_393)
  fun `the filter sheet fits 393dp and its controls clear 48dp`() = assertFilterSheet()

  @Test
  @Config(qualifiers = Widths.WIDE_412)
  fun `the filter sheet fits 412dp and its controls clear 48dp`() = assertFilterSheet()

  private fun assertFilterSheet() {
    compose.setContent {
      MaharaniTheme(darkTheme = false) {
        CatalogFilterSheet(
          initialDraft = CatalogFilterDraft(
            minPriceText = "100",
            maxPriceText = "500",
            minDiscountPercent = 10,
            offersOnly = true,
          ),
          error = null,
          onDismiss = {},
          onClearAll = {},
          onApply = {},
        )
      }
    }
    compose.waitForIdle()

    // A bottom sheet lives in its own window, so containment is asserted against
    // the sheet itself rather than against `onRoot()` — which would find two roots
    // here and refuse to pick one.
    compose.onNodeWithTag(CatalogFilterTags.SHEET).assertExists()
    compose.onNodeWithTag(CatalogFilterTags.MIN_PRICE).assertIsDisplayed()
    compose.onNodeWithTag(CatalogFilterTags.MAX_PRICE).assertIsDisplayed()
    compose.onAllNodesWithTag(CatalogFilterTags.DISCOUNT_CHIP).onFirst().assertExists()
    compose.onAllNodesWithTag(CatalogFilterTags.MOQ_CHIP).onFirst().assertExists()
    compose.onNodeWithTag(CatalogFilterTags.OFFERS_SWITCH).assertIsDisplayed()
    compose.onNodeWithTag(CatalogFilterTags.NEW_SWITCH).assertIsDisplayed()
    compose.onNodeWithTag(CatalogFilterTags.IN_STOCK_SWITCH).assertIsDisplayed()

    // Both footer buttons are the sheet's whole point, so both are held to the
    // platform minimum — measured after layout, not declared in a token.
    compose.onNodeWithTag(CatalogFilterTags.CLEAR_ALL).assertIsDisplayed()
    compose.onNodeWithTag(CatalogFilterTags.APPLY).assertIsDisplayed()
    assertTouchTarget(CatalogFilterTags.CLEAR_ALL)
    assertTouchTarget(CatalogFilterTags.APPLY)
    assertTouchTarget(CatalogFilterTags.OFFERS_SWITCH)

    // Apply names what it is about to do: four bounds are set in this draft.
    compose.onNodeWithText("Apply 4 filters").assertIsDisplayed()

    // The two price boxes share one row, so neither may be squeezed off it, and
    // the footer must end inside the sheet.
    val min = compose.onNodeWithTag(CatalogFilterTags.MIN_PRICE).getUnclippedBoundsInRoot()
    val max = compose.onNodeWithTag(CatalogFilterTags.MAX_PRICE).getUnclippedBoundsInRoot()
    assertThat(min.right).isAtMost(max.left)
    assertInside(
      CatalogFilterTags.SHEET,
      CatalogFilterTags.MIN_PRICE,
      CatalogFilterTags.MAX_PRICE,
      CatalogFilterTags.APPLY,
      CatalogFilterTags.CLEAR_ALL,
    )
  }

  @Test
  @Config(qualifiers = Widths.NARROW_360)
  fun `a refused draft says why inside the sheet at 360dp`() {
    compose.setContent {
      MaharaniTheme(darkTheme = false) {
        CatalogFilterSheet(
          initialDraft = CatalogFilterDraft(minPriceText = "900", maxPriceText = "100"),
          error = CatalogFilterDraft.PRICE_RANGE_MESSAGE,
          onDismiss = {},
          onClearAll = {},
          onApply = {},
        )
      }
    }
    compose.waitForIdle()

    // The refusal is rendered INSTEAD of a reloaded list, so it has to be visible
    // where the shopper is looking: inside the sheet, in its own words.
    compose.onNodeWithTag(CatalogFilterTags.ERROR).assertIsDisplayed()
    compose.onNodeWithText(CatalogFilterDraft.PRICE_RANGE_MESSAGE).assertIsDisplayed()
    assertInside(CatalogFilterTags.SHEET, CatalogFilterTags.ERROR)
  }

  @Test
  @Config(qualifiers = Widths.NARROW_360)
  fun `the filter entry point badges its count and clears 48dp at 360dp`() {
    compose.setContent {
      MaharaniTheme(darkTheme = false) {
        CatalogFilterButton(activeCount = 3, onClick = {})
      }
    }
    compose.waitForIdle()

    // A shopper returning to a short catalogue has to be able to see WHY it is
    // short without opening anything.
    compose.onNodeWithTag(CatalogFilterTags.OPEN).assertIsDisplayed()
    compose.onNodeWithText("Filters \u00B7 3").assertIsDisplayed()
    assertTouchTarget(CatalogFilterTags.OPEN)
  }

  @Test
  @Config(qualifiers = Widths.WIDE_412)
  fun `every filter the sheet can set is counted in the badge at 412dp`() {
    val draft = CatalogFilterDraft(
      minPriceText = "100",
      maxPriceText = "500",
      minDiscountPercent = 20,
      maxMoq = 5,
      offersOnly = true,
      newOnly = true,
      inStockOnly = true,
    )
    // The badge text is a function of the draft the sheet is holding, and the
    // count is what tells a shopper a short list is deliberate rather than broken.
    assertThat(draft.activeCount).isEqualTo(7)

    compose.setContent {
      MaharaniTheme(darkTheme = false) {
        CatalogFilterButton(activeCount = draft.activeCount, onClick = {})
      }
    }
    compose.waitForIdle()
    compose.onNodeWithText("Filters \u00B7 7").assertIsDisplayed()
    assertTouchTarget(CatalogFilterTags.OPEN)
  }

  // -------------------------------------------------------- suggestion panel

  @Test
  @Config(qualifiers = Widths.NARROW_360)
  fun `the suggestion panel renders all three entity kinds at 360dp`() = assertSuggestionRows()

  @Test
  @Config(qualifiers = Widths.MEDIUM_393)
  fun `the suggestion panel renders all three entity kinds at 393dp`() = assertSuggestionRows()

  @Test
  @Config(qualifiers = Widths.WIDE_412)
  fun `the suggestion panel renders all three entity kinds at 412dp`() = assertSuggestionRows()

  private fun assertSuggestionRows() {
    compose.setContent {
      MaharaniTheme(darkTheme = false) {
        SearchSuggestionPanel(
          suggestions = SearchSuggestions(
            query = "rice",
            searched = true,
            suggestions = listOf(
              SearchSuggestion.Product(
                id = "p1",
                label = "Sona Masoori Rice 5kg",
                brandName = "India Gate",
                packName = "5kg Sack",
                imageUrl = null,
                matchedBarcode = true,
              ),
              SearchSuggestion.Brand(id = "b1", label = "India Gate", logoUrl = null),
              SearchSuggestion.Category(id = "c1", label = "Rice & Grains", parentName = "Staples"),
            ),
          ),
          loading = false,
          error = null,
          term = "rice",
          onRetry = {},
          onSelectProduct = {},
          onSelectBrand = { _, _ -> },
          onSelectCategory = {},
          onDismiss = {},
        )
      }
    }
    compose.waitForIdle()

    compose.onNodeWithTag(SearchSuggestionTags.PANEL).assertIsDisplayed()
    compose.onNodeWithTag(SearchSuggestionTags.PRODUCT_ROW).assertIsDisplayed()
    compose.onNodeWithTag(SearchSuggestionTags.BRAND_ROW).assertIsDisplayed()
    compose.onNodeWithTag(SearchSuggestionTags.CATEGORY_ROW).assertIsDisplayed()
    // A barcode hit says how it matched instead of hiding it behind a name.
    compose.onNodeWithText("Barcode match").assertIsDisplayed()
    // The caption carries the pack, because "5kg Sack" is what the shopper was
    // really looking for when they typed a barcode.
    compose.onNodeWithText("India Gate \u00B7 5kg Sack").assertIsDisplayed()
    compose.onNodeWithText("Category in Staples").assertIsDisplayed()

    // A suggestion is a tap target, so it is held to the same minimum as an add to
    // cart — however little ink the row uses.
    assertTouchTarget(SearchSuggestionTags.PRODUCT_ROW)
    assertTouchTarget(SearchSuggestionTags.BRAND_ROW)
    assertTouchTarget(SearchSuggestionTags.CATEGORY_ROW)
    assertTouchTarget(SearchSuggestionTags.DISMISS)
    assertInsideRoot(
      SearchSuggestionTags.PANEL,
      SearchSuggestionTags.PRODUCT_ROW,
      SearchSuggestionTags.BRAND_ROW,
      SearchSuggestionTags.CATEGORY_ROW,
    )
  }

  @Test
  @Config(qualifiers = Widths.NARROW_360)
  fun `a failed suggestion read is not rendered as no match at 360dp`() {
    setPanel(
      suggestions = SearchSuggestions.NONE,
      error = "Search suggestions are unavailable",
      term = "rice",
    )

    compose.onNodeWithTag(SearchSuggestionTags.ERROR).assertIsDisplayed()
    compose.onNodeWithTag(SearchSuggestionTags.RETRY).assertIsDisplayed()
    // The one thing this panel must never do: report an outage as an empty answer.
    // The product list underneath may well have results.
    assertNotExists(SearchSuggestionTags.EMPTY)
    assertTouchTarget(SearchSuggestionTags.RETRY)
  }

  @Test
  @Config(qualifiers = Widths.NARROW_360)
  fun `an answered search with nothing in it says so and offers no retry at 360dp`() {
    setPanel(
      suggestions = SearchSuggestions(query = "zzz", searched = true, suggestions = emptyList()),
      error = null,
      term = "zzz",
    )

    compose.onNodeWithTag(SearchSuggestionTags.EMPTY).assertIsDisplayed()
    assertNotExists(SearchSuggestionTags.ERROR)
    // A retry for a read that succeeded would be a control that cannot change
    // anything — the clearest kind of dead end.
    assertNotExists(SearchSuggestionTags.RETRY)
    // And it points the shopper back at the list that is still working.
    compose.onNodeWithText(
      "No product, brand or category matches \u201Czzz\u201D. " +
        "The list below still shows the product results.",
    ).assertIsDisplayed()
  }

  @Test
  @Config(qualifiers = Widths.NARROW_360)
  fun `a suggestion read in flight shows a spinner rather than an empty answer at 360dp`() {
    setPanel(suggestions = SearchSuggestions.NONE, error = null, term = "ri", loading = true)

    compose.onNodeWithTag(SearchSuggestionTags.LOADING).assertIsDisplayed()
    assertNotExists(SearchSuggestionTags.EMPTY)
  }

  private fun setPanel(
    suggestions: SearchSuggestions,
    error: String?,
    term: String,
    loading: Boolean = false,
  ) {
    compose.setContent {
      MaharaniTheme(darkTheme = false) {
        SearchSuggestionPanel(
          suggestions = suggestions,
          loading = loading,
          error = error,
          term = term,
          onRetry = {},
          onSelectProduct = {},
          onSelectBrand = { _, _ -> },
          onSelectCategory = {},
          onDismiss = {},
        )
      }
    }
    compose.waitForIdle()
  }

  // ------------------------------------------------------------------ invariants

  @Test
  fun `the touch target every assertion above is measured against is the platform minimum`() {
    // If this ever changes, every 48dp assertion in this file changes meaning, so
    // the value is pinned here rather than trusted.
    assertThat(MaharaniDimens.touchTarget).isEqualTo(48.dp)
  }

  @Test
  fun `an untouched query badges nothing`() {
    val draft = CatalogFilterDraft.from(CatalogQuery.DEFAULT)

    // "Filters · 0" would be a claim that something is being counted when nothing
    // is; the bar reads plain "Filters" until a bound is really set.
    assertThat(draft.activeCount).isEqualTo(0)
    assertThat(draft.isUntouched).isTrue()
  }
}
