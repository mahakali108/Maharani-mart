package com.maharanitraders.feature.catalog

import com.google.common.truth.Truth.assertThat
import com.maharanitraders.core.common.AppError
import com.maharanitraders.core.common.AppResult
import com.maharanitraders.core.model.CatalogBrand
import com.maharanitraders.core.model.CatalogCategory
import com.maharanitraders.core.model.CatalogQuery
import com.maharanitraders.core.model.ProductDetail
import com.maharanitraders.core.model.RetailerHome
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Before
import org.junit.Test

/**
 * The favourite write, as the app owns it.
 *
 * The endpoint is a server-side toggle, so the store must never decide the new
 * state itself, must never queue a second tap behind the first (two toggles undo
 * each other), and must keep the last confirmed answer when a write fails.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class FavoritesStoreTest {

  private val dispatcher = StandardTestDispatcher()

  @Before
  fun setUp() = Dispatchers.setMain(dispatcher)

  @After
  fun tearDown() = Dispatchers.resetMain()

  /**
   * A repository whose write waits until the test releases it, so "in flight" is
   * an observable state rather than a race. Reads are refused outright: the store
   * has no business loading a page, and a test that made it do so would be
   * asserting something the production store cannot reach.
   */
  private class GatedRepository : CatalogRepository {
    val gate = CompletableDeferred<Unit>()
    val toggles: MutableList<String> = mutableListOf()
    var next: AppResult<Boolean> = AppResult.Success(true)

    /** Lets every write finish as soon as it is asked. */
    fun release() {
      gate.complete(Unit)
    }

    override suspend fun toggleFavorite(productId: String): AppResult<Boolean> {
      toggles += productId
      gate.await()
      return next
    }

    override suspend fun loadHome(): AppResult<RetailerHome> = unused()
    override suspend fun loadCategories(): AppResult<List<CatalogCategory>> = unused()
    override suspend fun loadBrands(): AppResult<List<CatalogBrand>> = unused()
    override suspend fun loadProducts(query: CatalogQuery, cursor: String?): AppResult<CatalogPage> = unused()
    override suspend fun loadProduct(id: String): AppResult<ProductDetail> = unused()

    private fun unused(): Nothing =
      throw AssertionError("the favourites store writes hearts only; a read here means the seam moved")
  }

  private fun offline() = AppResult.Failure(AppError.Network())

  @Test
  fun `publishes the state the server answered with`() = runTest(dispatcher) {
    val repository = GatedRepository()
    repository.next = AppResult.Success(true)
    val store = FavoritesStore(repository)

    val job = launch { store.toggle("p1") }
    advanceUntilIdle()
    repository.release()
    job.join()

    assertThat(store.state.value.overrides).containsExactly("p1", true)
    assertThat(store.state.value.busyIds).isEmpty()
    assertThat(store.state.value.message).isNull()
  }

  @Test
  fun `the second tap publishes the server's un-save, not the app's guess`() = runTest(dispatcher) {
    val repository = GatedRepository()
    repository.release()
    val store = FavoritesStore(repository)

    repository.next = AppResult.Success(true)
    store.toggle("p1")
    // The server's next answer is `false` because IT holds the row; the store does
    // not compute a toggle, it publishes one.
    repository.next = AppResult.Success(false)
    store.toggle("p1")

    assertThat(store.state.value.overrides).containsExactly("p1", false)
    assertThat(repository.toggles).containsExactly("p1", "p1")
  }

  @Test
  fun `a tap while a write is in flight is dropped`() = runTest(dispatcher) {
    val repository = GatedRepository()
    val store = FavoritesStore(repository)

    val first = launch { store.toggle("p1") }
    advanceUntilIdle()
    assertThat(store.state.value.busyIds).containsExactly("p1")

    // A second tap on the same product would flip the row back, so it is refused
    // before the request: the shopper's first intent is what survives.
    val second = launch { store.toggle("p1") }
    second.join()
    assertThat(repository.toggles).containsExactly("p1")

    repository.release()
    first.join()
    advanceUntilIdle()
    assertThat(store.state.value.busyIds).isEmpty()
  }

  @Test
  fun `a failed write keeps the last known state and says so`() = runTest(dispatcher) {
    val repository = GatedRepository()
    repository.release()
    val store = FavoritesStore(repository)
    repository.next = AppResult.Success(true)
    store.toggle("p1")

    repository.next = offline()
    store.toggle("p2")

    // p1 stays as the server last confirmed it, and p2 gains no state: the write
    // failed, so nothing changed upstream, and a guess would be a lie either way.
    assertThat(store.state.value.overrides).containsExactly("p1", true)
    assertThat(store.state.value.busyIds).isEmpty()
    assertThat(store.state.value.message).isNotNull()
  }

  @Test
  fun `a later successful write clears the stale failure`() = runTest(dispatcher) {
    val repository = GatedRepository()
    repository.release()
    val store = FavoritesStore(repository)
    repository.next = offline()
    store.toggle("p1")
    assertThat(store.state.value.message).isNotNull()

    repository.next = AppResult.Success(true)
    store.toggle("p1")

    assertThat(store.state.value.message).isNull()
    assertThat(store.state.value.overrides).containsExactly("p1", true)
  }

  @Test
  fun `a product id that is only whitespace is not worth a request`() = runTest(dispatcher) {
    val repository = GatedRepository()
    val store = FavoritesStore(repository)

    store.toggle("   ")
    store.toggle("")
    advanceUntilIdle()

    assertThat(repository.toggles).isEmpty()
    assertThat(store.state.value.busyIds).isEmpty()
    assertThat(store.state.value.message).isNull()
  }

  @Test
  fun `dismissing the message leaves the hearts alone`() = runTest(dispatcher) {
    val repository = GatedRepository()
    repository.release()
    val store = FavoritesStore(repository)
    repository.next = AppResult.Success(true)
    store.toggle("p1")
    repository.next = offline()
    store.toggle("p2")

    store.consumeMessage()

    assertThat(store.state.value.message).isNull()
    assertThat(store.state.value.overrides).containsExactly("p1", true)
  }
}
