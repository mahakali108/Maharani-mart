package com.maharanitraders.feature.catalog

import com.google.common.truth.Truth.assertThat
import com.maharanitraders.core.model.CatalogQuery
import com.maharanitraders.core.model.CatalogSort
import com.maharanitraders.core.network.dto.ApiEnvelope
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
 * Catalogue list behaviour: pagination, filtering and the failure modes.
 *
 * The pagination rules tested here are the ones that are easy to get wrong and
 * expensive to notice in production: a list that never ends, a list that repeats
 * rows, and a list that blanks itself when the next batch fails.
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
  }

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

  @Test
  fun `loads the categories and the first batch on start`() = runTest(dispatcher) {
    val api = api()
    api.productPages.addLast(envelope(listOf("p1", "p2"), resultCount = 2))

    val viewModel = CatalogViewModel(repository = catalogRepository(api, dispatcher))
    advanceUntilIdle()

    val state = viewModel.state.value
    assertThat(state.loading).isFalse()
    assertThat(state.categories.map { it.name }).containsExactly("Rice", "Oils").inOrder()
    assertThat(state.products.map { it.id }).containsExactly("p1", "p2").inOrder()
    assertThat(state.resultCount).isEqualTo(2)
    // A missing aggregate is reported as missing, not as zero.
    assertThat(state.categories[1].productCount).isNull()
  }

  @Test
  fun `keeps the product list when the category strip fails`() = runTest(dispatcher) {
    val api = api()
    api.categoriesResult = ApiEnvelope(CatalogCategoriesDto())
    api.productPages.addLast(envelope(listOf("p1"), resultCount = 1))

    val viewModel = CatalogViewModel(repository = catalogRepository(api, dispatcher))
    advanceUntilIdle()

    assertThat(viewModel.state.value.categories).isEmpty()
    assertThat(viewModel.state.value.products).hasSize(1)
  }

  @Test
  fun `appends the next batch without repeating a row`() = runTest(dispatcher) {
    val api = api()
    api.productPages.addLast(envelope(listOf("p1", "p2"), nextCursor = "cursor-2", hasMore = true, resultCount = 3))
    api.productPages.addLast(envelope(listOf("p2", "p3"), nextCursor = null, hasMore = false, resultCount = 3))

    val viewModel = CatalogViewModel(repository = catalogRepository(api, dispatcher))
    advanceUntilIdle()
    assertThat(viewModel.state.value.products.map { it.id }).containsExactly("p1", "p2").inOrder()

    viewModel.loadMore()
    advanceUntilIdle()

    // `p2` came back in both batches; it must be rendered once.
    assertThat(viewModel.state.value.products.map { it.id }).containsExactly("p1", "p2", "p3").inOrder()
    assertThat(viewModel.state.value.hasMore).isFalse()
    assertThat(viewModel.state.value.endOfList).isTrue()
  }

  @Test
  fun `stops when the server hands back the same cursor`() = runTest(dispatcher) {
    val api = api()
    api.productPages.addLast(envelope(listOf("p1"), nextCursor = "stuck", hasMore = true))
    api.productPages.addLast(envelope(listOf("p2"), nextCursor = "stuck", hasMore = true))

    val viewModel = CatalogViewModel(repository = catalogRepository(api, dispatcher))
    advanceUntilIdle()
    viewModel.loadMore()
    advanceUntilIdle()

    // A non-advancing cursor means "stop", not "ask again forever".
    assertThat(viewModel.state.value.endOfList).isTrue()
    assertThat(viewModel.state.value.hasMore).isFalse()
  }

  @Test
  fun `ignores loadMore while a batch is in flight or the list has ended`() = runTest(dispatcher) {
    val api = api()
    api.productPages.addLast(envelope(listOf("p1"), nextCursor = null, hasMore = false))

    val viewModel = CatalogViewModel(repository = catalogRepository(api, dispatcher))
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

    val viewModel = CatalogViewModel(repository = catalogRepository(api, dispatcher))
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
  fun `sends the category, sort and in-stock filters and can clear them`() = runTest(dispatcher) {
    val api = api()
    repeat(4) { api.productPages.addLast(envelope(listOf("p$it"), resultCount = 1)) }

    val viewModel = CatalogViewModel(repository = catalogRepository(api, dispatcher))
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
        search = null, categoryId = null, brandId = null, sort = null, inStock = null, cursor = null,
      ),
    )
    assertThat(viewModel.state.value.query).isEqualTo(CatalogQuery.DEFAULT)
  }

  @Test
  fun `does not re-request when the same category is selected twice`() = runTest(dispatcher) {
    val api = api()
    repeat(3) { api.productPages.addLast(envelope(listOf("p$it"), resultCount = 1)) }

    val viewModel = CatalogViewModel(repository = catalogRepository(api, dispatcher))
    advanceUntilIdle()
    viewModel.selectCategory("c1")
    advanceUntilIdle()
    val after = api.productRequests.size

    viewModel.selectCategory("c1")
    advanceUntilIdle()

    assertThat(api.productRequests).hasSize(after)
  }

  @Test
  fun `keeps the rows already on screen when a continuation fails`() = runTest(dispatcher) {
    val api = api()
    api.productPages.addLast(envelope(listOf("p1", "p2"), nextCursor = "c2", hasMore = true))

    val viewModel = CatalogViewModel(repository = catalogRepository(api, dispatcher))
    advanceUntilIdle()

    api.nextProductFailure = IOException("timeout")
    viewModel.loadMore()
    advanceUntilIdle()

    val state = viewModel.state.value
    assertThat(state.products.map { it.id }).containsExactly("p1", "p2").inOrder()
    assertThat(state.loadingMore).isFalse()
    assertThat(state.errorMessage).isNotNull()
    assertThat(state.offline).isTrue()
  }

  @Test
  fun `reports an empty state rather than an error when nothing matches`() = runTest(dispatcher) {
    val api = api()
    api.productPages.addLast(envelope(emptyList(), resultCount = 0))

    val viewModel = CatalogViewModel(repository = catalogRepository(api, dispatcher))
    advanceUntilIdle()

    val state = viewModel.state.value
    assertThat(state.isEmpty).isTrue()
    assertThat(state.errorMessage).isNull()
    assertThat(state.products).isEmpty()
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

    assertThat(CatalogViewModel.dedupeById(existing, incoming).map { it.id }).containsExactly("a", "b").inOrder()
  }
}
