package com.maharanitraders.feature.catalog

import com.google.common.truth.Truth.assertThat
import com.maharanitraders.core.network.dto.ApiEnvelope
import com.maharanitraders.core.network.dto.CatalogPackDto
import com.maharanitraders.core.network.dto.CatalogProductDto
import com.maharanitraders.core.network.dto.ListMetaDto
import com.maharanitraders.core.network.dto.PageDto
import java.io.IOException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Before
import org.junit.Test

/**
 * The saved-products screen.
 *
 * The list is the real catalogue endpoint narrowed with `fav=1`, so the two
 * things worth pinning are that the narrowing actually goes to the server, and
 * that a row only leaves the list once the server has confirmed the removal.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class FavoritesViewModelTest {

  private val dispatcher = StandardTestDispatcher()

  @Before
  fun setUp() = Dispatchers.setMain(dispatcher)

  @After
  fun tearDown() = Dispatchers.resetMain()

  private fun envelope(
    ids: List<String>,
    nextCursor: String? = null,
    hasMore: Boolean = false,
    resultCount: Int? = null,
  ) = ApiEnvelope(
    data = ids.map { id ->
      CatalogProductDto(
        id = id,
        name = "Product $id",
        isFavorite = true,
        pack = CatalogPackDto(packId = "pack-$id", packName = "500g", moq = 4, unitPricePaise = 100),
      )
    },
    page = PageDto(nextCursor = nextCursor, hasMore = hasMore, limit = 24),
    meta = ListMetaDto(resultCount = resultCount),
  )

  private fun viewModel(api: FakeCatalogApi) = FavoritesViewModel(
    repository = catalogRepository(api, dispatcher),
    favorites = favoritesStore(api, dispatcher),
  )

  @Test
  fun `asks the server for favourites only`() = runTest(dispatcher) {
    val api = FakeCatalogApi().apply {
      favoriteIds += listOf("p1", "p2")
      productPages += envelope(listOf("p1", "p2"), resultCount = 2)
    }

    val viewModel = viewModel(api)
    advanceUntilIdle()

    // `fav=1` is what narrows the list; without it this screen would quietly
    // render the whole catalogue.
    assertThat(api.productRequests).hasSize(1)
    assertThat(api.productRequests.first().favoritesOnly).isEqualTo("1")
    assertThat(api.productRequests.first().cursor).isNull()

    val state = viewModel.state.value
    assertThat(state.loading).isFalse()
    assertThat(state.products.map { it.id }).containsExactly("p1", "p2").inOrder()
    assertThat(state.resultCount).isEqualTo(2)
    assertThat(state.isEmpty).isFalse()
  }

  @Test
  fun `an empty favourites list is empty, not broken`() = runTest(dispatcher) {
    val api = FakeCatalogApi().apply { productPages += envelope(emptyList(), resultCount = 0) }

    val viewModel = viewModel(api)
    advanceUntilIdle()

    val state = viewModel.state.value
    assertThat(state.isEmpty).isTrue()
    assertThat(state.errorMessage).isNull()
  }

  @Test
  fun `pages through the saved products without repeating rows`() = runTest(dispatcher) {
    val api = FakeCatalogApi().apply {
      productPages += envelope(listOf("p1", "p2"), nextCursor = "cur-2", hasMore = true)
      productPages += envelope(listOf("p2", "p3"), hasMore = false)
    }

    val viewModel = viewModel(api)
    advanceUntilIdle()
    viewModel.loadMore()
    advanceUntilIdle()

    assertThat(api.productRequests.map { it.cursor }).containsExactly(null, "cur-2").inOrder()
    assertThat(api.productRequests.map { it.favoritesOnly }).containsExactly("1", "1")
    val state = viewModel.state.value
    assertThat(state.products.map { it.id }).containsExactly("p1", "p2", "p3").inOrder()
    assertThat(state.hasMore).isFalse()
    assertThat(state.endOfList).isTrue()
  }

  @Test
  fun `a cursor that does not advance stops the list instead of looping`() = runTest(dispatcher) {
    val api = FakeCatalogApi().apply {
      productPages += envelope(listOf("p1"), nextCursor = "cur-2", hasMore = true)
      productPages += envelope(listOf("p2"), nextCursor = "cur-2", hasMore = true)
    }

    val viewModel = viewModel(api)
    advanceUntilIdle()
    viewModel.loadMore()
    advanceUntilIdle()
    viewModel.loadMore()
    advanceUntilIdle()

    // The second page repeated its cursor, so the screen stops asking.
    assertThat(api.productRequests).hasSize(2)
    assertThat(viewModel.state.value.hasMore).isFalse()
    assertThat(viewModel.state.value.endOfList).isTrue()
  }

  @Test
  fun `a confirmed removal drops the row and the count`() = runTest(dispatcher) {
    val api = FakeCatalogApi().apply {
      favoriteIds += listOf("p1", "p2")
      productPages += envelope(listOf("p1", "p2"), resultCount = 2)
    }

    val viewModel = viewModel(api)
    advanceUntilIdle()

    viewModel.toggleFavorite("p1")
    advanceUntilIdle()

    assertThat(api.toggleRequests).containsExactly("p1")
    val state = viewModel.state.value
    assertThat(state.products.map { it.id }).containsExactly("p2")
    assertThat(state.resultCount).isEqualTo(1)
    assertThat(viewModel.favoriteState.value.isFavorite("p1")).isFalse()
  }

  @Test
  fun `a failed removal keeps the row and surfaces the message once`() = runTest(dispatcher) {
    val api = FakeCatalogApi().apply {
      favoriteIds += "p1"
      productPages += envelope(listOf("p1"), resultCount = 1)
    }

    val viewModel = viewModel(api)
    advanceUntilIdle()

    api.nextToggleFailure = IOException("network down")
    viewModel.toggleFavorite("p1")
    advanceUntilIdle()

    val state = viewModel.state.value
    assertThat(state.products.map { it.id }).containsExactly("p1")
    assertThat(state.actionMessage).isNotEmpty()

    viewModel.consumeActionMessage()
    assertThat(viewModel.state.value.actionMessage).isNull()
  }

  @Test
  fun `a failed load is retryable and keeps the offline flag honest`() = runTest(dispatcher) {
    val api = FakeCatalogApi().apply { nextProductFailure = IOException("offline") }

    val viewModel = viewModel(api)
    advanceUntilIdle()

    val failed = viewModel.state.value
    assertThat(failed.loading).isFalse()
    assertThat(failed.errorMessage).isNotEmpty()
    assertThat(failed.offline).isTrue()
    assertThat(failed.retryable).isTrue()

    api.nextProductFailure = null
    api.productPages += envelope(listOf("p1"), resultCount = 1)
    viewModel.retry()
    advanceUntilIdle()

    val recovered = viewModel.state.value
    assertThat(recovered.errorMessage).isNull()
    assertThat(recovered.offline).isFalse()
    assertThat(recovered.products.map { it.id }).containsExactly("p1")
  }

  @Test
  fun `reloading re-reads the authoritative set alongside the list`() = runTest(dispatcher) {
    val api = FakeCatalogApi().apply {
      favoriteIds += "p1"
      productPages += envelope(listOf("p1"), resultCount = 1)
      productPages += envelope(listOf("p1"), resultCount = 1)
    }

    val viewModel = viewModel(api)
    advanceUntilIdle()
    val afterStart = api.favoritesCalls

    viewModel.reload()
    advanceUntilIdle()

    // A favourite removed on another device must disappear from the set and
    // the list together, so the refresh is not optional.
    assertThat(api.favoritesCalls).isGreaterThan(afterStart)
  }
}
