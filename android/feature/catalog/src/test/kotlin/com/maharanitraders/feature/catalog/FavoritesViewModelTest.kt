package com.maharanitraders.feature.catalog

import com.google.common.truth.Truth.assertThat
import com.maharanitraders.core.network.dto.ApiEnvelope
import com.maharanitraders.core.network.dto.CatalogPackDto
import com.maharanitraders.core.network.dto.CatalogProductDto
import com.maharanitraders.core.network.dto.ListMetaDto
import com.maharanitraders.core.network.dto.PageDto
import com.maharanitraders.feature.catalog.ui.visibleFavorites
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
 * The favourites screen: what it asks the server for, and what it refuses to
 * invent.
 *
 * The list is a filtered catalogue query, so its pagination rules are the
 * catalogue's (a repeated cursor ends the list, a failed page keeps the rows
 * already on screen), and the heart state comes back from the shared store rather
 * than from a wish.
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
    resultCapped: Boolean = false,
    favorite: Boolean = true,
  ) = ApiEnvelope(
    data = ids.map { id ->
      CatalogProductDto(
        id = id,
        name = "Product $id",
        isFavorite = favorite,
        pack = CatalogPackDto(packId = "pack-$id", packName = "500g", moq = 4, unitPricePaise = 100),
      )
    },
    page = PageDto(nextCursor = nextCursor, hasMore = hasMore, limit = 24),
    meta = ListMetaDto(resultCount = resultCount, resultCapped = resultCapped),
  )

  private inner class Wired(api: FakeCatalogApi) {
    val repository = catalogRepository(api, dispatcher)
    val store = FavoritesStore(repository)
    val viewModel = FavoritesViewModel(repository = repository, store = store)
  }

  @Test
  fun `asks the server for the caller's favourites and nothing else`() = runTest(dispatcher) {
    val api = FakeCatalogApi()
    api.productPages.addLast(envelope(listOf("p1", "p2"), resultCount = 2, resultCapped = true))
    val wired = Wired(api)

    advanceUntilIdle()

    assertThat(api.productRequests).hasSize(1)
    val request = api.productRequests.single()
    assertThat(request.favoritesOnly).isEqualTo("1")
    assertThat(request.search).isNull()
    assertThat(request.categoryId).isNull()
    assertThat(request.cursor).isNull()

    val list = wired.viewModel.list.value
    assertThat(list.loading).isFalse()
    assertThat(list.items.map { it.id }).containsExactly("p1", "p2").inOrder()
    // The server's own count and cap reach the header, so the screen can disclose
    // a capped working set instead of implying it saw everything.
    assertThat(list.resultCount).isEqualTo(2)
    assertThat(list.resultCapped).isTrue()
  }

  @Test
  fun `an un-saved product leaves the list as soon as the server confirms it`() = runTest(dispatcher) {
    val api = FakeCatalogApi()
    api.favoriteIds += "p1"
    api.productPages.addLast(envelope(listOf("p1")))
    val wired = Wired(api)
    advanceUntilIdle()

    assertThat(visibleFavorites(wired.viewModel.list.value.items, wired.viewModel.favorites.value))
      .hasSize(1)

    wired.viewModel.toggleFavorite("p1")
    advanceUntilIdle()

    // The fake toggles its own row, so the server answered `false`; the row is
    // gone because the app now knows it is not saved — no local deletion.
    assertThat(api.favoriteIds).isEmpty()
    assertThat(wired.viewModel.favorites.value.overrides).containsExactly("p1", false)
    assertThat(visibleFavorites(wired.viewModel.list.value.items, wired.viewModel.favorites.value)).isEmpty()
  }

  @Test
  fun `a repeated cursor ends the list instead of requesting it forever`() = runTest(dispatcher) {
    val api = FakeCatalogApi()
    api.productPages.addLast(envelope(listOf("p1"), nextCursor = "c1", hasMore = true))
    api.productPages.addLast(envelope(listOf("p1"), nextCursor = "c1", hasMore = true))
    val wired = Wired(api)
    advanceUntilIdle()

    wired.viewModel.loadMore()
    advanceUntilIdle()

    val list = wired.viewModel.list.value
    // The row the first page already had is not shown twice.
    assertThat(list.items.map { it.id }).containsExactly("p1")
    assertThat(list.endOfList).isTrue()
    assertThat(list.hasMore).isFalse()
    assertThat(list.nextCursor).isNull()

    // And once the list has ended, a further tap does not go back to the server.
    val calls = api.productRequests.size
    wired.viewModel.loadMore()
    advanceUntilIdle()
    assertThat(api.productRequests).hasSize(calls)
  }

  @Test
  fun `a failed refresh keeps the rows already on screen`() = runTest(dispatcher) {
    val api = FakeCatalogApi()
    api.productPages.addLast(envelope(listOf("p1", "p2")))
    val wired = Wired(api)
    advanceUntilIdle()

    api.nextProductFailure = IOException("connection reset")
    wired.viewModel.load()
    advanceUntilIdle()

    val list = wired.viewModel.list.value
    assertThat(list.items).hasSize(2)
    assertThat(list.errorMessage).isNotNull()
    // The rows survived, so the screen must not claim the list is empty.
    assertThat(list.loading).isFalse()
  }

  @Test
  fun `a failure with nothing loaded is reported as offline and retryable`() = runTest(dispatcher) {
    val api = FakeCatalogApi()
    api.nextProductFailure = IOException("no route to host")
    val wired = Wired(api)

    advanceUntilIdle()

    val list = wired.viewModel.list.value
    assertThat(list.loading).isFalse()
    assertThat(list.offline).isTrue()
    assertThat(list.retryable).isTrue()
    assertThat(list.items).isEmpty()
    assertThat(list.isEmpty).isFalse()
  }

  @Test
  fun `dismissing the write failure does not touch the list`() = runTest(dispatcher) {
    val api = FakeCatalogApi()
    api.productPages.addLast(envelope(listOf("p1")))
    val wired = Wired(api)
    advanceUntilIdle()

    api.nextFavoriteFailure = IOException("connection reset")
    wired.viewModel.toggleFavorite("p9")
    advanceUntilIdle()
    assertThat(wired.viewModel.favorites.value.message).isNotNull()

    wired.viewModel.dismissMessage()

    assertThat(wired.viewModel.favorites.value.message).isNull()
    assertThat(wired.viewModel.list.value.items).hasSize(1)
  }
}
