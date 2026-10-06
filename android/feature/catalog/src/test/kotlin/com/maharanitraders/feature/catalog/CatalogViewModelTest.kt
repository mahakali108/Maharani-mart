package com.maharanitraders.feature.catalog

import com.google.common.truth.Truth.assertThat
import com.maharanitraders.core.model.CatalogQuery
import com.maharanitraders.core.model.CatalogSort
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
}
