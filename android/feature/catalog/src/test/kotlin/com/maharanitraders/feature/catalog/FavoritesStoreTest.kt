package com.maharanitraders.feature.catalog

import com.google.common.truth.Truth.assertThat
import com.maharanitraders.core.common.AppResult
import java.io.IOException
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Test

/**
 * The favourite store's contract: the SERVER decides, the store remembers.
 *
 * These tests exist because the easy implementation of a favourite heart — flip
 * it on tap, send the request, hope — produces a UI that lies whenever the
 * request fails. Each test below pins one half of "never show a favourite the
 * server did not confirm".
 */
@OptIn(ExperimentalCoroutinesApi::class)
class FavoritesStoreTest {

  private val dispatcher = StandardTestDispatcher()

  @Test
  fun `loads the authoritative set once and reuses it`() = runTest(dispatcher) {
    val api = FakeCatalogApi().apply { favoriteIds += listOf("p1", "p2") }
    val store = favoritesStore(api, dispatcher)

    assertThat(store.ensureLoaded()).isInstanceOf(AppResult.Success::class.java)
    store.ensureLoaded()
    store.ensureLoaded()

    // Three screens can each call ensureLoaded in init; the server sees one GET.
    assertThat(api.favoritesCalls).isEqualTo(1)
    val snapshot = store.state.value
    assertThat(snapshot.loaded).isTrue()
    assertThat(snapshot.ids).containsExactly("p1", "p2")
    assertThat(snapshot.count).isEqualTo(2)
  }

  @Test
  fun `concurrent first loads still make a single request`() = runTest(dispatcher) {
    val api = FakeCatalogApi().apply { favoriteIds += "p1" }
    val store = favoritesStore(api, dispatcher)

    val first = async { store.ensureLoaded() }
    val second = async { store.ensureLoaded() }
    advanceUntilIdle()
    first.await()
    second.await()

    assertThat(api.favoritesCalls).isEqualTo(1)
  }

  @Test
  fun `before loading it trusts the flag the catalogue row carried`() = runTest(dispatcher) {
    val store = favoritesStore(FakeCatalogApi(), dispatcher)

    val snapshot = store.state.value
    assertThat(snapshot.loaded).isFalse()
    // A cold start must not blank a heart the server already said was filled.
    assertThat(snapshot.isFavorite("p1", serverDefault = true)).isTrue()
    assertThat(snapshot.isFavorite("p2", serverDefault = false)).isFalse()
    assertThat(snapshot.count).isNull()
  }

  @Test
  fun `a loaded set overrides the per-row flag`() = runTest(dispatcher) {
    val api = FakeCatalogApi().apply { favoriteIds += "p1" }
    val store = favoritesStore(api, dispatcher)

    store.ensureLoaded()

    val snapshot = store.state.value
    assertThat(snapshot.isFavorite("p1", serverDefault = false)).isTrue()
    // The row's flag is stale once the authoritative set has arrived.
    assertThat(snapshot.isFavorite("p9", serverDefault = true)).isFalse()
  }

  @Test
  fun `toggle records exactly what the server returned`() = runTest(dispatcher) {
    val api = FakeCatalogApi()
    val store = favoritesStore(api, dispatcher)
    store.ensureLoaded()

    val added = store.toggle("p1")

    assertThat(added).isEqualTo(AppResult.Success(true))
    assertThat(api.toggleRequests).containsExactly("p1")
    assertThat(store.state.value.isFavorite("p1")).isTrue()
    assertThat(store.state.value.count).isEqualTo(1)

    val removed = store.toggle("p1")

    assertThat(removed).isEqualTo(AppResult.Success(false))
    assertThat(store.state.value.isFavorite("p1")).isFalse()
    assertThat(store.state.value.count).isEqualTo(0)
  }

  @Test
  fun `a failed toggle keeps the previous state and reports why`() = runTest(dispatcher) {
    val api = FakeCatalogApi().apply {
      favoriteIds += "p1"
      nextToggleFailure = IOException("network down")
    }
    val store = favoritesStore(api, dispatcher)
    store.ensureLoaded()

    val result = store.toggle("p1")

    assertThat(result).isInstanceOf(AppResult.Failure::class.java)
    // The heart stays filled: nothing was unsaved, so nothing may look unsaved.
    assertThat(store.state.value.isFavorite("p1")).isTrue()
    assertThat(store.state.value.isPending("p1")).isFalse()
    assertThat(store.state.value.errorMessage).isNotEmpty()
  }

  @Test
  fun `the product is pending only while its toggle is in flight`() = runTest(dispatcher) {
    val gate = CompletableDeferred<Unit>()
    val api = FakeCatalogApi().apply { toggleGate = gate }
    val store = favoritesStore(api, dispatcher)
    store.ensureLoaded()

    val inFlight = async { store.toggle("p1") }
    runCurrent()
    assertThat(store.state.value.isPending("p1")).isTrue()

    // A second tap while the first is unanswered must not reach the server:
    // two toggles of the same product cancel each other out, so an impatient
    // double tap would silently un-save what the shopper just saved.
    store.toggle("p1")
    assertThat(api.toggleRequests).containsExactly("p1")

    gate.complete(Unit)
    advanceUntilIdle()
    inFlight.await()

    assertThat(api.toggleRequests).containsExactly("p1")
    assertThat(store.state.value.isPending("p1")).isFalse()
    assertThat(store.state.value.isFavorite("p1")).isTrue()
  }

  @Test
  fun `refresh restates the set and drops confirmed overrides`() = runTest(dispatcher) {
    val api = FakeCatalogApi()
    val store = favoritesStore(api, dispatcher)
    store.ensureLoaded()
    store.toggle("p1")
    assertThat(store.state.value.overrides).containsEntry("p1", true)

    // Another device removed it; the server is the one that gets to say so.
    api.favoriteIds.clear()
    store.refresh()

    assertThat(api.favoritesCalls).isEqualTo(2)
    assertThat(store.state.value.overrides).isEmpty()
    assertThat(store.state.value.isFavorite("p1", serverDefault = true)).isFalse()
  }

  @Test
  fun `a failed load leaves the known hearts alone`() = runTest(dispatcher) {
    val api = FakeCatalogApi().apply { favoriteIds += "p1" }
    val store = favoritesStore(api, dispatcher)
    store.ensureLoaded()

    api.nextFavoritesFailure = IOException("offline")
    val result = store.refresh()

    assertThat(result).isInstanceOf(AppResult.Failure::class.java)
    assertThat(store.state.value.loaded).isTrue()
    assertThat(store.state.value.ids).containsExactly("p1")
    assertThat(store.state.value.errorMessage).isNotEmpty()

    store.clearError()
    assertThat(store.state.value.errorMessage).isNull()
  }

  @Test
  fun `a blank product id never reaches the server`() = runTest(dispatcher) {
    val api = FakeCatalogApi()
    val store = favoritesStore(api, dispatcher)

    store.toggle("")

    assertThat(api.toggleRequests).isEmpty()
  }
}
