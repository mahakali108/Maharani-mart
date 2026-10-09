package com.maharanitraders.feature.catalog

import com.google.common.truth.Truth.assertThat
import com.maharanitraders.core.model.CatalogQuery
import com.maharanitraders.core.model.CatalogSort
import com.maharanitraders.core.model.SearchSuggestion
import com.maharanitraders.core.network.dto.CatalogSearchBrandDto
import com.maharanitraders.core.network.dto.CatalogSearchCategoryDto
import com.maharanitraders.core.network.dto.CatalogSearchDto
import com.maharanitraders.core.network.dto.CatalogSearchProductDto
import com.maharanitraders.core.network.dto.ApiEnvelope
import com.maharanitraders.core.network.dto.CatalogBrandDto
import com.maharanitraders.core.network.dto.CatalogBrandsDto
import com.maharanitraders.core.network.dto.CatalogCategoriesDto
import com.maharanitraders.core.network.dto.CatalogCategoryDto
import com.maharanitraders.core.network.dto.CatalogPackDto
import com.maharanitraders.core.network.dto.CatalogProductDto
import com.maharanitraders.core.network.dto.ListMetaDto
import com.maharanitraders.core.network.dto.PageDto
import java.io.IOException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Before
import org.junit.Test

/**
 * Catalogue behaviour: the three panes, the real filters, the real failure modes
 * and the pagination rules.
 *
 * The pagination rules tested here are the ones that are easy to get wrong and
 * expensive to notice in production: a list that never ends, a list that repeats
 * rows, and a list that blanks itself when the next batch fails.
 *
 * The pane tests are the ones the brief calls out explicitly — categories load,
 * brands load, a category filters the products, a brand filters the products,
 * the panes navigate, and an empty or failed read is reported honestly. They run
 * against the REAL [NetworkCatalogRepository] with only the Retrofit interface
 * faked, so the query parameters under test are the ones the app really sends.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class CatalogViewModelTest {

  private val dispatcher = StandardTestDispatcher()

  @Before
  fun setUp() = Dispatchers.setMain(dispatcher)

  @After
  fun tearDown() = Dispatchers.resetMain()

  private fun api(): FakeCatalogApi = FakeCatalogApi().apply {
    categoriesResult = ApiEnvelope(
      CatalogCategoriesDto(
        categories = listOf(
          CatalogCategoryDto(id = "c1", name = "Rice", productCount = 3),
          CatalogCategoryDto(id = "c2", name = "Oils", productCount = null),
        ),
      ),
    )
    brandsResult = ApiEnvelope(
      CatalogBrandsDto(
        brands = listOf(
          CatalogBrandDto(id = "b1", name = "India Gate", productCount = 5),
          CatalogBrandDto(id = "b2", name = "Fortune", productCount = null),
        ),
      ),
    )
  }

  private fun viewModel(api: FakeCatalogApi) = CatalogViewModel(
    repository = catalogRepository(api, dispatcher),
    favorites = favoritesStore(api, dispatcher),
    history = localHistoryStore(),
  )

  private fun envelope(
    ids: List<String>,
    nextCursor: String? = null,
    hasMore: Boolean = false,
    resultCount: Int? = null,
    resultCapped: Boolean = false,
  ) = ApiEnvelope(
    data = ids.map { id ->
      CatalogProductDto(
        id = id,
        name = "Product $id",
        pack = CatalogPackDto(packId = "pack-$id", packName = "500g", moq = 4, unitPricePaise = 100),
      )
    },
    page = PageDto(nextCursor = nextCursor, hasMore = hasMore, limit = 24),
    meta = ListMetaDto(resultCount = resultCount, resultCapped = resultCapped),
  )

  // ---------------------------------------------------------------------------
  // Panes: the taxonomy and the products are one catalogue
  // ---------------------------------------------------------------------------

  @Test
  fun `loads the categories, the brands and the first batch on start`() = runTest(dispatcher) {
    val api = api()
    api.productPages.addLast(envelope(listOf("p1", "p2"), resultCount = 2))

    val viewModel = viewModel(api)
    advanceUntilIdle()

    val state = viewModel.state.value
    assertThat(state.loading).isFalse()
    assertThat(state.categories.map { it.name }).containsExactly("Rice", "Oils").inOrder()
    assertThat(state.brands.map { it.name }).containsExactly("India Gate", "Fortune").inOrder()
    assertThat(state.products.map { it.id }).containsExactly("p1", "p2").inOrder()
    assertThat(state.resultCount).isEqualTo(2)
    // A missing aggregate is reported as missing, not as zero.
    assertThat(state.categories[1].productCount).isNull()
    assertThat(state.brands[1].productCount).isNull()
    // Both directory reads answered, so neither pane shows a spinner.
    assertThat(state.categoriesLoaded).isTrue()
    assertThat(state.brandsLoaded).isTrue()
    assertThat(state.directoryLoading).isFalse()
  }

  @Test
  fun `reads the two directory endpoints once, not once per pane switch`() = runTest(dispatcher) {
    val api = api()
    api.productPages.addLast(envelope(listOf("p1"), resultCount = 1))

    val viewModel = viewModel(api)
    advanceUntilIdle()
    val categoryCalls = api.categoryCalls

    viewModel.selectTab(CatalogTab.CATEGORIES)
    advanceUntilIdle()
    viewModel.selectTab(CatalogTab.BRANDS)
    advanceUntilIdle()
    viewModel.selectTab(CatalogTab.PRODUCTS)
    advanceUntilIdle()

    // Switching panes is free: the taxonomy is already in state.
    assertThat(api.categoryCalls).isEqualTo(categoryCalls)
    assertThat(viewModel.state.value.tab).isEqualTo(CatalogTab.PRODUCTS)
  }

  @Test
  fun `selecting a category filters the products and shows the results pane`() =
    runTest(dispatcher) {
      val api = api()
      repeat(3) { api.productPages.addLast(envelope(listOf("p$it"), resultCount = 1)) }

      val viewModel = viewModel(api)
      advanceUntilIdle()

      // The shopper is standing on the Categories pane when they tap a tile.
      viewModel.selectTab(CatalogTab.CATEGORIES)
      viewModel.selectCategory("c1")
      advanceUntilIdle()

      val request = api.productRequests.last()
      assertThat(request.categoryId).isEqualTo("c1")
      assertThat(request.cursor).isNull()
      // Selecting a category moves to the product list, so the filter's effect
      // is visible immediately.
      assertThat(viewModel.state.value.tab).isEqualTo(CatalogTab.PRODUCTS)
      assertThat(viewModel.state.value.selectedCategoryName).isEqualTo("Rice")
    }

  @Test
  fun `selecting a brand filters the products and carries its label`() = runTest(dispatcher) {
    val api = api()
    repeat(3) { api.productPages.addLast(envelope(listOf("p$it"), resultCount = 1)) }

    val viewModel = viewModel(api)
    advanceUntilIdle()

    viewModel.selectTab(CatalogTab.BRANDS)
    viewModel.selectBrand("b1", "India Gate")
    advanceUntilIdle()

    val request = api.productRequests.last()
    assertThat(request.brandId).isEqualTo("b1")
    assertThat(request.cursor).isNull()
    assertThat(viewModel.state.value.tab).isEqualTo(CatalogTab.PRODUCTS)
    assertThat(viewModel.state.value.brandLabel).isEqualTo("India Gate")
    assertThat(viewModel.state.value.selectedBrand?.name).isEqualTo("India Gate")

    // Clearing it (the chip's close action) drops both the filter and the label.
    viewModel.selectBrand(null)
    advanceUntilIdle()
    assertThat(api.productRequests.last().brandId).isNull()
    assertThat(viewModel.state.value.brandLabel).isNull()
  }

  /**
   * The catalogue's own load path, which is what "the Catalog is stuck loading"
   * actually was on a long-lived session: the request that opens the screen
   * carries filters from the home search box, a category rail or a brand tile,
   * and applying them field by field spent one catalogue read each (the server
   * allows 120/min, `lib/mobile/rate-limit.ts`). One request per deep link.
   */
  @Test
  fun `category and brand selections remain combined in the server product query`() = runTest(dispatcher) {
    val api = api()
    repeat(4) { api.productPages.addLast(envelope(listOf("p$it"), resultCount = 1)) }

    val viewModel = viewModel(api)
    advanceUntilIdle()

    viewModel.selectCategory("c1")
    advanceUntilIdle()
    viewModel.selectBrand("b1", "India Gate")
    advanceUntilIdle()

    val request = api.productRequests.last()
    assertThat(request.categoryId).isEqualTo("c1")
    assertThat(request.brandId).isEqualTo("b1")
    assertThat(viewModel.state.value.selectedCategoryName).isEqualTo("Rice")
    assertThat(viewModel.state.value.selectedBrand?.name).isEqualTo("India Gate")
  }

  @Test
  fun `applies a search, category and brand deep link in one request`() = runTest(dispatcher) {
    val api = api()
    repeat(4) { api.productPages.addLast(envelope(listOf("p$it"), resultCount = 1)) }

    val viewModel = viewModel(api)
    advanceUntilIdle()
    val afterInitialLoad = api.productRequests.size

    viewModel.applyInitialRequest(
      search = "basmati",
      categoryId = "c1",
      brandId = "b1",
      brandLabel = "India Gate",
      tab = CatalogTab.PRODUCTS,
    )
    advanceUntilIdle()

    // Exactly ONE further read for the whole deep link.
    assertThat(api.productRequests).hasSize(afterInitialLoad + 1)
    val request = api.productRequests.last()
    assertThat(request.search).isEqualTo("basmati")
    assertThat(request.categoryId).isEqualTo("c1")
    assertThat(request.brandId).isEqualTo("b1")
    assertThat(request.cursor).isNull()

    val state = viewModel.state.value
    assertThat(state.query.search).isEqualTo("basmati")
    assertThat(state.brandLabel).isEqualTo("India Gate")
    assertThat(state.tab).isEqualTo(CatalogTab.PRODUCTS)
  }

  @Test
  fun `an unfiltered deep link costs no extra request`() = runTest(dispatcher) {
    val api = api()
    repeat(2) { api.productPages.addLast(envelope(listOf("p1"), resultCount = 1)) }

    val viewModel = viewModel(api)
    advanceUntilIdle()
    val afterInitialLoad = api.productRequests.size

    // Opening the tab with no filter and the default pane: `init` already loaded
    // this exact query, so a second identical read would be pure waste.
    viewModel.applyInitialRequest()
    advanceUntilIdle()

    assertThat(api.productRequests).hasSize(afterInitialLoad)
  }

  @Test
  fun `a deep link can open the catalogue on its Categories pane`() = runTest(dispatcher) {
    val api = api()
    repeat(2) { api.productPages.addLast(envelope(listOf("p1"), resultCount = 1)) }

    val viewModel = viewModel(api)
    advanceUntilIdle()

    viewModel.applyInitialRequest(tab = CatalogTab.CATEGORIES)
    advanceUntilIdle()

    val state = viewModel.state.value
    assertThat(state.tab).isEqualTo(CatalogTab.CATEGORIES)
    // The taxonomy is already in state, so the pane renders without a reload.
    assertThat(state.visibleCategories.map { it.name }).containsExactly("Rice", "Oils")
    assertThat(state.visibleBrands.map { it.name }).containsExactly("India Gate", "Fortune")
  }

  @Test
  fun `narrows the directory panes on the device without a request`() = runTest(dispatcher) {
    val api = api()
    api.productPages.addLast(envelope(listOf("p1"), resultCount = 1))

    val viewModel = viewModel(api)
    advanceUntilIdle()
    val requests = api.productRequests.size
    val categoryCalls = api.categoryCalls

    viewModel.onDirectoryFilterChange("oil")

    val state = viewModel.state.value
    assertThat(state.visibleCategories.map { it.name }).containsExactly("Oils")
    assertThat(state.visibleBrands).isEmpty()
    // A local filter is local: no product request, no taxonomy request.
    assertThat(api.productRequests).hasSize(requests)
    assertThat(api.categoryCalls).isEqualTo(categoryCalls)

    // A term nothing matches is "no match" for the pane, not an empty shop.
    viewModel.onDirectoryFilterChange("nothing-like-this")
    assertThat(viewModel.state.value.categoriesNoMatch).isTrue()
    assertThat(viewModel.state.value.categoriesEmpty).isFalse()

    viewModel.onDirectoryFilterChange("")
    assertThat(viewModel.state.value.categoriesNoMatch).isFalse()
    assertThat(viewModel.state.value.visibleCategories).hasSize(2)
  }

  @Test
  fun `reports an empty taxonomy rather than an error when the shop publishes none`() =
    runTest(dispatcher) {
      val api = api()
      api.categoriesResult = ApiEnvelope(CatalogCategoriesDto())
      api.brandsResult = ApiEnvelope(CatalogBrandsDto())
      api.productPages.addLast(envelope(listOf("p1"), resultCount = 1))

      val viewModel = viewModel(api)
      advanceUntilIdle()

      val state = viewModel.state.value
      assertThat(state.categoriesEmpty).isTrue()
      assertThat(state.brandsEmpty).isTrue()
      assertThat(state.categoriesError).isNull()
      assertThat(state.brandsError).isNull()
      // An empty directory never hides the products that did load.
      assertThat(state.products).hasSize(1)
    }

  @Test
  fun `reports a taxonomy failure per pane and keeps the pane that loaded`() =
    runTest(dispatcher) {
      val api = api()
      api.nextCategoriesFailure = IOException("connection reset")
      api.productPages.addLast(envelope(listOf("p1"), resultCount = 1))

      val viewModel = viewModel(api)
      advanceUntilIdle()

      val state = viewModel.state.value
      assertThat(state.categoriesError).isNotNull()
      assertThat(state.categoriesOffline).isTrue()
      assertThat(state.categoriesLoaded).isTrue()
      assertThat(state.categoriesEmpty).isFalse()
      // The brand read succeeded, so the Brands pane shows real brands and no
      // error at all.
      assertThat(state.brandsError).isNull()
      assertThat(state.brands.map { it.name }).containsExactly("India Gate", "Fortune")
      // Products are unaffected by a taxonomy outage.
      assertThat(state.products).hasSize(1)
    }

  @Test
  fun `retrying the directories re-reads and clears the failure`() = runTest(dispatcher) {
    val api = api()
    api.nextCategoriesFailure = IOException("connection reset")
    api.productPages.addLast(envelope(listOf("p1"), resultCount = 1))

    val viewModel = viewModel(api)
    advanceUntilIdle()
    assertThat(viewModel.state.value.categoriesError).isNotNull()

    api.nextCategoriesFailure = null
    viewModel.retryDirectories()
    advanceUntilIdle()

    val state = viewModel.state.value
    assertThat(state.categoriesError).isNull()
    assertThat(state.categories.map { it.name }).containsExactly("Rice", "Oils").inOrder()
  }

  // ---------------------------------------------------------------------------
  // Products: filters, pagination and the failure modes
  // ---------------------------------------------------------------------------

  @Test
  fun `keeps the product list when the category strip fails`() = runTest(dispatcher) {
    val api = api()
    api.categoriesResult = ApiEnvelope(CatalogCategoriesDto())
    api.productPages.addLast(envelope(listOf("p1"), resultCount = 1))

    val viewModel = viewModel(api)
    advanceUntilIdle()

    assertThat(viewModel.state.value.categories).isEmpty()
    assertThat(viewModel.state.value.products).hasSize(1)
  }

  @Test
  fun `appends the next batch without repeating a row`() = runTest(dispatcher) {
    val api = api()
    api.productPages.addLast(
      envelope(listOf("p1", "p2"), nextCursor = "cursor-2", hasMore = true, resultCount = 3),
    )
    api.productPages.addLast(
      envelope(listOf("p2", "p3"), nextCursor = null, hasMore = false, resultCount = 3),
    )

    val viewModel = viewModel(api)
    advanceUntilIdle()
    assertThat(viewModel.state.value.products.map { it.id }).containsExactly("p1", "p2").inOrder()

    viewModel.loadMore()
    advanceUntilIdle()

    // `p2` came back in both batches; it must be rendered once.
    assertThat(viewModel.state.value.products.map { it.id })
      .containsExactly("p1", "p2", "p3").inOrder()
    assertThat(viewModel.state.value.hasMore).isFalse()
    assertThat(viewModel.state.value.endOfList).isTrue()
  }

  @Test
  fun `stops when the server hands back the same cursor`() = runTest(dispatcher) {
    val api = api()
    api.productPages.addLast(envelope(listOf("p1"), nextCursor = "stuck", hasMore = true))
    api.productPages.addLast(envelope(listOf("p2"), nextCursor = "stuck", hasMore = true))

    val viewModel = viewModel(api)
    advanceUntilIdle()
    viewModel.loadMore()
    advanceUntilIdle()

    // A non-advancing cursor means "stop", not "ask again forever".
    assertThat(viewModel.state.value.endOfList).isTrue()
    assertThat(viewModel.state.value.hasMore).isFalse()
  }

  @Test
  fun `ignores loadMore while a batch is in flight or the list has ended`() =
    runTest(dispatcher) {
      val api = api()
      api.productPages.addLast(envelope(listOf("p1"), nextCursor = null, hasMore = false))

      val viewModel = viewModel(api)
      advanceUntilIdle()
      val requests = api.productRequests.size

      viewModel.loadMore()
      viewModel.loadMore()
      advanceUntilIdle()

      assertThat(api.productRequests).hasSize(requests)
    }

  @Test
  fun `debounces the search and restarts the list from the top`() = runTest(dispatcher) {
    val api = api()
    api.productPages.addLast(envelope(listOf("p1"), resultCount = 1))
    api.productPages.addLast(envelope(listOf("rice"), resultCount = 1))

    val viewModel = viewModel(api)
    advanceUntilIdle()
    val beforeSearch = api.productRequests.size

    viewModel.onSearchChange("r")
    viewModel.onSearchChange("ri")
    viewModel.onSearchChange("rice")
    // Inside the debounce window: no request yet.
    advanceTimeBy(CatalogViewModel.SEARCH_DEBOUNCE_MS - 50)
    assertThat(api.productRequests).hasSize(beforeSearch)

    advanceUntilIdle()

    // One request for three keystrokes, and it carries no cursor.
    val last = api.productRequests.last()
    assertThat(last.search).isEqualTo("rice")
    assertThat(last.cursor).isNull()
    assertThat(api.productRequests).hasSize(beforeSearch + 1)
    assertThat(viewModel.state.value.products.map { it.id }).containsExactly("rice")
  }

  @Test
  fun `sends the category, sort and in-stock filters and can clear them`() =
    runTest(dispatcher) {
      val api = api()
      repeat(4) { api.productPages.addLast(envelope(listOf("p$it"), resultCount = 1)) }

      val viewModel = viewModel(api)
      advanceUntilIdle()

      viewModel.selectCategory("c1")
      advanceUntilIdle()
      assertThat(api.productRequests.last().categoryId).isEqualTo("c1")

      viewModel.selectSort(CatalogSort.PRICE_HIGH)
      advanceUntilIdle()
      assertThat(api.productRequests.last().sort).isEqualTo("price-high")

      viewModel.toggleInStockOnly()
      advanceUntilIdle()
      assertThat(api.productRequests.last().inStock).isEqualTo("1")
      assertThat(viewModel.state.value.query.inStockOnly).isTrue()
      assertThat(viewModel.state.value.selectedCategoryName).isEqualTo("Rice")

      viewModel.clearFilters()
      advanceUntilIdle()
      val cleared = api.productRequests.last()
      assertThat(cleared).isEqualTo(
        FakeCatalogApi.ProductRequest(
          search = null, categoryId = null, brandId = null, sort = null, inStock = null,
          favoritesOnly = null, cursor = null,
        ),
      )
      assertThat(viewModel.state.value.query).isEqualTo(CatalogQuery.DEFAULT)
    }

  @Test
  fun `does not re-request when the same category is selected twice`() = runTest(dispatcher) {
    val api = api()
    repeat(3) { api.productPages.addLast(envelope(listOf("p$it"), resultCount = 1)) }

    val viewModel = viewModel(api)
    advanceUntilIdle()
    viewModel.selectCategory("c1")
    advanceUntilIdle()
    val after = api.productRequests.size

    viewModel.selectCategory("c1")
    advanceUntilIdle()

    assertThat(api.productRequests).hasSize(after)
  }

  @Test
  fun `switching panes drops the previous pane's local filter`() = runTest(dispatcher) {
    val api = api()
    repeat(2) { api.productPages.addLast(envelope(listOf("p$it"), resultCount = 1)) }

    val viewModel = viewModel(api)
    advanceUntilIdle()

    viewModel.selectTab(CatalogTab.CATEGORIES)
    viewModel.onDirectoryFilterChange("ri")
    advanceUntilIdle()
    assertThat(viewModel.state.value.directoryFilter).isEqualTo("ri")
    assertThat(viewModel.state.value.visibleCategories.map { it.name }).containsExactly("Rice")
    val requests = api.productRequests.size

    viewModel.selectTab(CatalogTab.BRANDS)
    advanceUntilIdle()

    // The term belonged to the category list, and switching panes is still free.
    assertThat(viewModel.state.value.directoryFilter).isEmpty()
    assertThat(viewModel.state.value.visibleBrands).hasSize(2)
    assertThat(api.productRequests).hasSize(requests)
  }

  @Test
  fun `clearing the scope drops the category and the brand in one request`() =
    runTest(dispatcher) {
      val api = api()
      repeat(4) { api.productPages.addLast(envelope(listOf("p$it"), resultCount = 1)) }

      val viewModel = viewModel(api)
      advanceUntilIdle()

      // A category from the Categories pane, then a brand on top of it: exactly
      // the state the "All" control exists to undo.
      viewModel.selectCategory("c1")
      advanceUntilIdle()
      viewModel.selectBrand("b1", "India Gate")
      advanceUntilIdle()
      assertThat(viewModel.state.value.brandLabel).isEqualTo("India Gate")
      val before = api.productRequests.size

      viewModel.clearScope()
      advanceUntilIdle()

      // ONE read. Clearing both through selectCategory(null) + selectBrand(null)
      // fired two, and the first response could land after the second.
      assertThat(api.productRequests).hasSize(before + 1)
      val cleared = api.productRequests.last()
      assertThat(cleared.categoryId).isNull()
      assertThat(cleared.brandId).isNull()
      assertThat(viewModel.state.value.query.categoryId).isNull()
      assertThat(viewModel.state.value.query.brandId).isNull()
      assertThat(viewModel.state.value.brandLabel).isNull()
    }

  @Test
  fun `clearing an empty scope costs no request`() = runTest(dispatcher) {
    val api = api()
    api.productPages.addLast(envelope(listOf("p1"), resultCount = 1))

    val viewModel = viewModel(api)
    advanceUntilIdle()
    val requests = api.productRequests.size

    viewModel.clearScope()
    advanceUntilIdle()

    assertThat(api.productRequests).hasSize(requests)
  }

  @Test
  fun `the search action searches at once instead of waiting for the debounce`() =
    runTest(dispatcher) {
      val api = api()
      repeat(3) { api.productPages.addLast(envelope(listOf("p$it"), resultCount = 1)) }

      val viewModel = viewModel(api)
      advanceUntilIdle()
      val before = api.productRequests.size

      // Typing schedules a debounced read; the keyboard's search action must
      // replace it, not add to it: one term, one read.
      viewModel.onSearchChange("rice")
      viewModel.submitSearch()
      advanceUntilIdle()

      assertThat(api.productRequests).hasSize(before + 1)
      assertThat(api.productRequests.last().search).isEqualTo("rice")
    }

  @Test
  fun `does not re-request when the same pane is selected twice`() = runTest(dispatcher) {
    val api = api()
    api.productPages.addLast(envelope(listOf("p1"), resultCount = 1))

    val viewModel = viewModel(api)
    advanceUntilIdle()
    val requests = api.productRequests.size

    viewModel.selectTab(CatalogTab.CATEGORIES)
    viewModel.selectTab(CatalogTab.CATEGORIES)
    advanceUntilIdle()

    assertThat(api.productRequests).hasSize(requests)
    assertThat(viewModel.state.value.tab).isEqualTo(CatalogTab.CATEGORIES)
  }

  @Test
  fun `keeps the rows already on screen when a continuation fails`() = runTest(dispatcher) {
    val api = api()
    api.productPages.addLast(envelope(listOf("p1", "p2"), nextCursor = "c2", hasMore = true))

    val viewModel = viewModel(api)
    advanceUntilIdle()

    api.nextProductFailure = IOException("timeout")
    viewModel.loadMore()
    advanceUntilIdle()

    val state = viewModel.state.value
    assertThat(state.products.map { it.id }).containsExactly("p1", "p2").inOrder()
    assertThat(state.loadingMore).isFalse()
    assertThat(state.errorMessage).isNotNull()
    assertThat(state.offline).isTrue()
    // The failed batch is retryable from the footer without losing the list.
    assertThat(state.query).isEqualTo(CatalogQuery.DEFAULT)
  }

  @Test
  fun `surfaces a first-load failure with its retry affordance`() = runTest(dispatcher) {
    val api = api()
    api.nextProductFailure = IOException("no route to host")

    val viewModel = viewModel(api)
    advanceUntilIdle()

    val state = viewModel.state.value
    assertThat(state.products).isEmpty()
    assertThat(state.errorMessage).isNotNull()
    assertThat(state.offline).isTrue()
    assertThat(state.retryable).isTrue()
    assertThat(state.isEmpty).isFalse()
  }

  @Test
  fun `reports an empty state rather than an error when nothing matches`() =
    runTest(dispatcher) {
      val api = api()
      api.productPages.addLast(envelope(emptyList(), resultCount = 0))

      val viewModel = viewModel(api)
      advanceUntilIdle()

      val state = viewModel.state.value
      assertThat(state.isEmpty).isTrue()
      assertThat(state.errorMessage).isNull()
      assertThat(state.products).isEmpty()
      assertThat(state.errorMessage).isNull()
    }

  @Test
  fun `discloses a capped result set`() = runTest(dispatcher) {
    val api = api()
    api.productPages.addLast(
      envelope(listOf("p1"), resultCount = 240, resultCapped = true),
    )

    val viewModel = viewModel(api)
    advanceUntilIdle()

    assertThat(viewModel.state.value.resultCapped).isTrue()
    assertThat(viewModel.state.value.resultCount).isEqualTo(240)
  }

  @Test
  fun `de-duplicates by id across batches`() {
    val existing = listOf(
      com.maharanitraders.core.model.CatalogProduct(
        id = "a", name = "A", brandName = null, imageUrl = null, isNewLaunch = false,
        categoryId = null, brandId = null, hasOffer = false, isFavorite = false, pack = null,
      ),
    )
    val incoming = listOf(
      com.maharanitraders.core.model.CatalogProduct(
        id = "a", name = "A", brandName = null, imageUrl = null, isNewLaunch = false,
        categoryId = null, brandId = null, hasOffer = false, isFavorite = false, pack = null,
      ),
      com.maharanitraders.core.model.CatalogProduct(
        id = "b", name = "B", brandName = null, imageUrl = null, isNewLaunch = false,
        categoryId = null, brandId = null, hasOffer = false, isFavorite = false, pack = null,
      ),
    )

    assertThat(CatalogViewModel.dedupeById(existing, incoming).map { it.id })
      .containsExactly("a", "b").inOrder()
  }

  // ---------------------------------------------------------------------------
  // The filter sheet: every bound is the SERVER's, applied as one change
  // ---------------------------------------------------------------------------

  @Test
  fun `applying the sheet sends every bound in ONE catalogue read`() = runTest(dispatcher) {
    val api = api()
    api.productPages.addLast(envelope(listOf("p1")))
    val viewModel = viewModel(api)
    advanceUntilIdle()
    val requestsBefore = api.productRequests.size

    viewModel.applyFilters(
      CatalogFilterDraft(
        minPriceText = "100",
        maxPriceText = "500",
        minDiscountPercent = 10,
        maxMoq = 5,
        offersOnly = true,
        newOnly = true,
        inStockOnly = true,
      ),
    )
    advanceUntilIdle()

    // One tap on Apply is one request. Six filters applied field by field would be
    // six reads against the server's `read.catalog` budget (120/min), each one
    // discarding the last, and a healthy session starts answering 429.
    assertThat(api.productRequests.size - requestsBefore).isEqualTo(1)
    val sent = api.productRequests.last()
    assertThat(sent.minPrice).isEqualTo("100")
    assertThat(sent.maxPrice).isEqualTo("500")
    assertThat(sent.minDiscount).isEqualTo("10")
    assertThat(sent.maxMoq).isEqualTo("5")
    assertThat(sent.offersOnly).isEqualTo("1")
    assertThat(sent.newOnly).isEqualTo("1")
    assertThat(sent.inStock).isEqualTo("1")
    // The sheet closes on success, and takes its error with it.
    assertThat(viewModel.state.value.filtersOpen).isFalse()
    assertThat(viewModel.state.value.filterError).isNull()
  }

  @Test
  fun `a refused draft is reported and the list is deliberately NOT reloaded`() = runTest(dispatcher) {
    val api = api()
    api.productPages.addLast(envelope(listOf("p1")))
    val viewModel = viewModel(api)
    advanceUntilIdle()
    viewModel.openFilters()
    val requestsBefore = api.productRequests.size

    viewModel.applyFilters(CatalogFilterDraft(minPriceText = "900", maxPriceText = "100"))
    advanceUntilIdle()

    assertThat(viewModel.state.value.filterError)
      .isEqualTo(CatalogFilterDraft.PRICE_RANGE_MESSAGE)
    // Sending a bound the server would drop is the failure this refuses to have:
    // the shopper would see an unfiltered list behind a control that looks
    // applied, and checkout would price something the list never showed.
    assertThat(api.productRequests.size).isEqualTo(requestsBefore)
    assertThat(viewModel.state.value.filtersOpen).isTrue()
  }

  @Test
  fun `clear all keeps the search, the scope and the sort`() = runTest(dispatcher) {
    val api = api()
    api.productPages.addLast(envelope(listOf("p1")))
    val viewModel = viewModel(api)
    advanceUntilIdle()

    viewModel.applyInitialRequest(search = "rice", categoryId = "c1", brandId = "b1", brandLabel = "India Gate")
    viewModel.applyFilters(CatalogFilterDraft(minPriceText = "100", offersOnly = true))
    advanceUntilIdle()
    viewModel.selectSort(CatalogSort.PRICE_LOW)
    advanceUntilIdle()
    val requestsBefore = api.productRequests.size

    viewModel.clearAllFilters()
    advanceUntilIdle()

    val query = viewModel.state.value.query
    assertThat(query.search).isEqualTo("rice")
    assertThat(query.categoryId).isEqualTo("c1")
    assertThat(query.brandId).isEqualTo("b1")
    assertThat(query.sort).isEqualTo(CatalogSort.PRICE_LOW)
    assertThat(query.hasAdvancedFilters).isFalse()
    val sent = api.productRequests.last()
    assertThat(sent.minPrice).isNull()
    assertThat(sent.offersOnly).isNull()
    assertThat(sent.search).isEqualTo("rice")
    assertThat(sent.categoryId).isEqualTo("c1")
    assertThat(sent.brandId).isEqualTo("b1")
    assertThat(api.productRequests.size - requestsBefore).isEqualTo(1)
  }

  @Test
  fun `clear all with nothing set does not re-read the list`() = runTest(dispatcher) {
    val api = api()
    api.productPages.addLast(envelope(listOf("p1")))
    val viewModel = viewModel(api)
    advanceUntilIdle()
    val requestsBefore = api.productRequests.size

    viewModel.clearAllFilters()
    advanceUntilIdle()

    assertThat(api.productRequests.size).isEqualTo(requestsBefore)
  }

  @Test
  fun `applying what is already applied does not re-read the list`() = runTest(dispatcher) {
    val api = api()
    api.productPages.addLast(envelope(listOf("p1")))
    val viewModel = viewModel(api)
    advanceUntilIdle()
    viewModel.applyFilters(CatalogFilterDraft(minPriceText = "100"))
    advanceUntilIdle()
    val requestsBefore = api.productRequests.size

    // The shopper opened the sheet, looked at it and pressed Apply. That is not a
    // new question and must not cost a request.
    viewModel.applyFilters(CatalogFilterDraft.from(viewModel.state.value.query))
    advanceUntilIdle()

    assertThat(api.productRequests.size).isEqualTo(requestsBefore)
    assertThat(viewModel.state.value.filtersOpen).isFalse()
  }

  @Test
  fun `the sheet opens and closes without touching the result list`() = runTest(dispatcher) {
    val api = api()
    api.productPages.addLast(envelope(listOf("p1")))
    val viewModel = viewModel(api)
    advanceUntilIdle()
    val requestsBefore = api.productRequests.size

    assertThat(viewModel.state.value.filtersOpen).isFalse()
    viewModel.openFilters()
    assertThat(viewModel.state.value.filtersOpen).isTrue()
    viewModel.closeFilters()
    assertThat(viewModel.state.value.filtersOpen).isFalse()

    assertThat(api.productRequests.size).isEqualTo(requestsBefore)
  }

  @Test
  fun `a deep link can open the catalogue already narrowed to offers`() = runTest(dispatcher) {
    val api = api()
    api.productPages.addLast(envelope(listOf("p1")))
    val viewModel = viewModel(api)
    advanceUntilIdle()

    viewModel.applyInitialRequest(offersOnly = true)
    advanceUntilIdle()

    assertThat(viewModel.state.value.query.offersOnly).isTrue()
    assertThat(api.productRequests.last().offersOnly).isEqualTo("1")
  }

  // ---------------------------------------------------------------------------
  // Cross-entity suggestions: products, brands and categories for a typed term
  // ---------------------------------------------------------------------------

  private fun searchAnswer(
    query: String,
    product: String? = null,
    brand: String? = null,
    category: String? = null,
  ) = ApiEnvelope(
    CatalogSearchDto(
      query = query,
      searched = true,
      products = listOfNotNull(
        product?.let {
          CatalogSearchProductDto(id = it, name = "Product $it", matchKind = "name")
        },
      ),
      brands = listOfNotNull(
        brand?.let { CatalogSearchBrandDto(id = it, name = "Brand $it") },
      ),
      categories = listOfNotNull(
        category?.let { CatalogSearchCategoryDto(id = it, name = "Cat $it", parentName = "Rice") },
      ),
    ),
  )

  @Test
  fun `typing a long enough term reads products, brands AND categories`() = runTest(dispatcher) {
    val api = api()
    api.productPages.addLast(envelope(listOf("p1")))
    api.searchResult = searchAnswer("ric", product = "p9", brand = "b9", category = "c9")
    val viewModel = viewModel(api)
    advanceUntilIdle()

    viewModel.onSearchChange("ric")
    advanceUntilIdle()

    assertThat(api.searchRequests).containsExactly("ric")
    val state = viewModel.state.value
    assertThat(state.suggestionsVisible).isTrue()
    assertThat(state.suggestionsLoading).isFalse()
    assertThat(state.suggestionsError).isNull()
    val suggestions = state.suggestions.suggestions
    assertThat(suggestions).hasSize(3)
    assertThat(suggestions.filterIsInstance<SearchSuggestion.Product>().map { it.id })
      .containsExactly("p9")
    assertThat(suggestions.filterIsInstance<SearchSuggestion.Brand>().map { it.id })
      .containsExactly("b9")
    assertThat(suggestions.filterIsInstance<SearchSuggestion.Category>().map { it.id })
      .containsExactly("c9")
  }

  @Test
  fun `a term below the floor never reaches the endpoint`() = runTest(dispatcher) {
    val api = api()
    api.productPages.addLast(envelope(listOf("p1")))
    val viewModel = viewModel(api)
    advanceUntilIdle()

    viewModel.onSearchChange("r")
    advanceUntilIdle()

    // One character cannot be searched: the server's own floor is two. Calling it
    // anyway would spend rate-limit budget on an answer that is always empty.
    assertThat(api.searchCalls).isEqualTo(0)
    assertThat(viewModel.state.value.suggestionsVisible).isFalse()
    assertThat(viewModel.state.value.suggestions.isEmpty).isTrue()
  }

  @Test
  fun `a failed suggestion read is never reported as no match`() = runTest(dispatcher) {
    val api = api()
    // Two batches: the one the screen's first load takes, and the one the typed
    // term's own reload takes. Without the second, the reload would fall through
    // to the fake's empty answer and this test would be asserting on a list that
    // an unrelated code path emptied.
    api.productPages.addLast(envelope(listOf("p1", "p2")))
    api.productPages.addLast(envelope(listOf("p1", "p2")))
    api.nextSearchFailure = IOException("suggestions down")
    val viewModel = viewModel(api)
    advanceUntilIdle()

    viewModel.onSearchChange("rice")
    advanceUntilIdle()

    val state = viewModel.state.value
    assertThat(state.suggestionsError).isNotNull()
    // The product list is a DIFFERENT request and it worked: its rows stay on
    // screen, and the panel says the read failed instead of claiming the shop has
    // nothing matching "rice".
    assertThat(state.products.map { it.id }).containsExactly("p1", "p2").inOrder()
    assertThat(state.errorMessage).isNull()
  }

  @Test
  fun `moving the term on cancels a suggestion read that is still pending`() = runTest(dispatcher) {
    val api = api()
    api.productPages.addLast(envelope(listOf("p1")))
    api.searchResult = searchAnswer("ri", product = "stale")
    val viewModel = viewModel(api)
    advanceUntilIdle()

    viewModel.onSearchChange("ri")
    // The term moves on before the answer can be applied. The pending read is
    // cancelled rather than allowed to land: an answer for "ri" arriving next to a
    // list of results for "rice" is two different answers to two different
    // questions on one screen.
    viewModel.applyInitialRequest(search = "rice")
    advanceUntilIdle()

    val state = viewModel.state.value
    assertThat(state.suggestions.suggestions).isEmpty()
    // A cancelled read must leave the panel at rest, not spinning forever.
    assertThat(state.suggestionsLoading).isFalse()
    assertThat(state.suggestionsVisible).isFalse()
  }

  @Test
  fun `an answer the server sanitized still counts as current`() = runTest(dispatcher) {
    val api = api()
    api.productPages.addLast(envelope(listOf("p1")))
    // The shopper typed a comma; the server matched — and echoed — the sanitized
    // form. Refusing this would hide the panel for every punctuated term.
    api.searchResult = searchAnswer("rice 5kg", product = "p9")
    val viewModel = viewModel(api)
    advanceUntilIdle()

    viewModel.onSearchChange("rice, 5kg")
    advanceUntilIdle()

    assertThat(viewModel.state.value.suggestionsLoading).isFalse()
    assertThat(viewModel.state.value.suggestions.suggestions).hasSize(1)
  }

  @Test
  fun `submitting the search commits it and closes the panel`() = runTest(dispatcher) {
    val api = api()
    api.productPages.addLast(envelope(listOf("p1")))
    api.searchResult = searchAnswer("rice", product = "p9")
    val viewModel = viewModel(api)
    advanceUntilIdle()

    viewModel.onSearchChange("rice")
    advanceUntilIdle()
    assertThat(viewModel.state.value.suggestionsVisible).isTrue()

    viewModel.submitSearch()
    advanceUntilIdle()

    // The list is now the answer; the typing aid goes away rather than competing
    // with it (six products is not the result set).
    assertThat(viewModel.state.value.suggestionsVisible).isFalse()
  }

  @Test
  fun `taking a brand suggestion applies the brand and drops the typed term`() = runTest(dispatcher) {
    val api = api()
    api.productPages.addLast(envelope(listOf("p1")))
    api.searchResult = searchAnswer("fortu", brand = "b1")
    val viewModel = viewModel(api)
    advanceUntilIdle()

    viewModel.onSearchChange("fortu")
    advanceUntilIdle()
    viewModel.selectSuggestedBrand("b1", "Fortune")
    advanceUntilIdle()

    val state = viewModel.state.value
    // Keeping "fortu" as a product search AND as a brand filter would intersect
    // two constraints the shopper only ever meant as one, and can legitimately
    // return nothing.
    assertThat(state.query.search).isEmpty()
    assertThat(state.query.brandId).isEqualTo("b1")
    assertThat(state.brandLabel).isEqualTo("Fortune")
    assertThat(state.tab).isEqualTo(CatalogTab.PRODUCTS)
    assertThat(state.suggestionsVisible).isFalse()
    val sent = api.productRequests.last()
    assertThat(sent.brandId).isEqualTo("b1")
    assertThat(sent.search).isNull()
  }

  @Test
  fun `taking a category suggestion applies the category and drops the typed term`() = runTest(dispatcher) {
    val api = api()
    api.productPages.addLast(envelope(listOf("p1")))
    api.searchResult = searchAnswer("ric", category = "c1")
    val viewModel = viewModel(api)
    advanceUntilIdle()

    viewModel.onSearchChange("ric")
    advanceUntilIdle()
    viewModel.selectSuggestedCategory("c1")
    advanceUntilIdle()

    val state = viewModel.state.value
    assertThat(state.query.search).isEmpty()
    assertThat(state.query.categoryId).isEqualTo("c1")
    assertThat(state.suggestionsVisible).isFalse()
    assertThat(api.productRequests.last().categoryId).isEqualTo("c1")
  }

  @Test
  fun `taking a product suggestion closes the panel and remembers the term`() = runTest(dispatcher) {
    val api = api()
    api.productPages.addLast(envelope(listOf("p1")))
    api.searchResult = searchAnswer("rice", product = "p9")
    val viewModel = viewModel(api)
    advanceUntilIdle()

    viewModel.onSearchChange("rice")
    advanceUntilIdle()
    viewModel.selectSuggestedProduct("p9")
    advanceUntilIdle()

    // The screen opens the product; the ViewModel's job is to get out of the way
    // and to bank the term, because the shopper clearly meant it.
    assertThat(viewModel.state.value.suggestionsVisible).isFalse()
    assertThat(viewModel.recentSearches.value).contains("rice")
  }

  @Test
  fun `dismissing the panel keeps the term and the result list`() = runTest(dispatcher) {
    val api = api()
    api.productPages.addLast(envelope(listOf("p1")))
    api.searchResult = searchAnswer("rice", product = "p9")
    val viewModel = viewModel(api)
    advanceUntilIdle()

    viewModel.onSearchChange("rice")
    advanceUntilIdle()
    val requestsBefore = api.productRequests.size
    viewModel.dismissSuggestions()
    advanceUntilIdle()

    assertThat(viewModel.state.value.suggestionsVisible).isFalse()
    assertThat(viewModel.state.value.query.search).isEqualTo("rice")
    assertThat(api.productRequests.size).isEqualTo(requestsBefore)
  }

  @Test
  fun `leaving the products pane hides a panel only products draws`() = runTest(dispatcher) {
    val api = api()
    api.productPages.addLast(envelope(listOf("p1")))
    api.searchResult = searchAnswer("rice", product = "p9")
    val viewModel = viewModel(api)
    advanceUntilIdle()

    viewModel.onSearchChange("rice")
    advanceUntilIdle()
    viewModel.selectTab(CatalogTab.BRANDS)

    assertThat(viewModel.state.value.suggestionsVisible).isFalse()
    // And coming back does not resurrect a panel for a term nobody is looking at.
    viewModel.selectTab(CatalogTab.PRODUCTS)
    assertThat(viewModel.state.value.suggestionsVisible).isFalse()
  }

  @Test
  fun `suggestions are debounced, so typing a word costs one read`() = runTest(dispatcher) {
    val api = api()
    api.productPages.addLast(envelope(listOf("p1")))
    api.searchResult = searchAnswer("rice", product = "p9")
    val viewModel = viewModel(api)
    advanceUntilIdle()

    "rice".forEachIndexed { index, _ ->
      viewModel.onSearchChange("rice".substring(0, index + 1))
      advanceTimeBy(50L)
    }
    advanceUntilIdle()

    // Four keystrokes inside one debounce window are one question, not four — and
    // the one that is asked is the term the shopper finished typing.
    assertThat(api.searchCalls).isEqualTo(1)
    assertThat(api.searchRequests).containsExactly("rice")
  }
}
