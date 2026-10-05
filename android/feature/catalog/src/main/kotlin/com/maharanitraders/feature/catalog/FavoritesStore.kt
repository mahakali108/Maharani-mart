package com.maharanitraders.feature.catalog

import com.maharanitraders.core.common.AppResult
import com.maharanitraders.core.common.map
import com.maharanitraders.core.network.ApiCallExecutor
import com.maharanitraders.core.network.MaharaniApi
import com.maharanitraders.core.network.dto.FavoriteToggleRequestDto
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * What the app currently knows about this retailer's favourites.
 *
 * [loaded] matters: before `GET /favorites` has answered, the only favourite
 * information the app has is the `isFavorite` flag the server already put on
 * each catalogue card. [isFavorite] therefore falls back to that flag rather
 * than claiming a product is not favourited just because the set is still
 * empty — otherwise every heart would flash "off" on a cold start.
 *
 * [overrides] records the outcomes the toggle endpoint CONFIRMED. They win over
 * both the loaded set and the per-card flag, because they are strictly newer
 * than either, and they are cleared by a refresh, when the server restates the
 * whole set.
 */
data class FavoritesSnapshot(
  val loaded: Boolean = false,
  val ids: Set<String> = emptySet(),
  val overrides: Map<String, Boolean> = emptyMap(),
  /** Products with a toggle in flight; their control shows progress. */
  val pending: Set<String> = emptySet(),
  /** Set when the last favourites call failed, for the caller to surface. */
  val errorMessage: String? = null,
) {

  /**
   * Whether to draw this product's heart filled.
   *
   * [serverDefault] is the `isFavorite` flag that came with the product row.
   */
  fun isFavorite(productId: String, serverDefault: Boolean = false): Boolean =
    overrides[productId] ?: if (loaded) productId in ids else serverDefault

  fun isPending(productId: String): Boolean = productId in pending

  /** The favourite count, known only once the authoritative set has loaded. */
  val count: Int?
    get() = if (!loaded) null else (ids - overrides.filterValues { !it }.keys)
      .plus(overrides.filterValues { it }.keys)
      .size
}

/**
 * The ONE source of truth for favourite state in the native app.
 *
 * Every surface that can show or change a favourite — the catalogue grid, the
 * home rails, product detail and the favourites screen — reads this store and
 * calls [toggle]. There is deliberately no second copy of the flag in a
 * ViewModel: two copies were how the web UI used to disagree with itself, and a
 * heart that disagrees with the server is worse than no heart at all.
 *
 * Server authority is absolute here. [toggle] does NOT flip the state
 * optimistically; it marks the product pending, asks the server, and records
 * exactly the boolean the server returned. A failed toggle therefore leaves the
 * previous state visible and reports a message, rather than showing a
 * favourite that was never saved.
 */
@Singleton
class FavoritesStore @Inject constructor(
  private val api: MaharaniApi,
  private val executor: ApiCallExecutor,
) {

  private val _state = MutableStateFlow(FavoritesSnapshot())
  val state: StateFlow<FavoritesSnapshot> = _state.asStateFlow()

  /** Serialises refreshes so two screens starting at once make one request. */
  private val refreshLock = Mutex()

  /**
   * Load the authoritative set once.
   *
   * Safe to call from every favourites-aware screen's `init`: the first caller
   * performs the request and the rest observe the result.
   */
  suspend fun ensureLoaded(): AppResult<Set<String>> = refreshLock.withLock {
    val current = _state.value
    if (current.loaded) return@withLock AppResult.Success(current.ids)
    load()
  }

  /** Re-read the authoritative set, discarding confirmed toggle overrides. */
  suspend fun refresh(): AppResult<Set<String>> = refreshLock.withLock { load() }

  private suspend fun load(): AppResult<Set<String>> =
    executor.executeEnvelope { api.favorites() }
      .map { dto -> dto.productIds.toSet() }
      .also { result ->
        when (result) {
          is AppResult.Success -> _state.update {
            it.copy(
              loaded = true,
              ids = result.value,
              // The server has just restated the whole set, so the confirmed
              // toggles it already contains are no longer "newer".
              overrides = emptyMap(),
              errorMessage = null,
            )
          }
          // A favourites outage must not blank the hearts the catalogue rows
          // already carry: the previous snapshot stays, with a message.
          is AppResult.Failure -> _state.update { it.copy(errorMessage = result.error.message) }
        }
      }

  /**
   * Toggle one product, then record what the server actually decided.
   *
   * Returns the server's new state on success. Concurrent taps on the same
   * product are ignored while one is in flight.
   */
  suspend fun toggle(productId: String): AppResult<Boolean> {
    if (productId.isBlank()) {
      return AppResult.Success(_state.value.isFavorite(productId))
    }
    if (_state.value.isPending(productId)) {
      return AppResult.Success(_state.value.isFavorite(productId))
    }

    _state.update { it.copy(pending = it.pending + productId, errorMessage = null) }

    val result = executor
      .executeEnvelope { api.toggleFavorite(FavoriteToggleRequestDto(productId = productId)) }
      .map { it.isFavorite }

    when (result) {
      is AppResult.Success -> _state.update { snapshot ->
        snapshot.copy(
          pending = snapshot.pending - productId,
          ids = if (result.value) snapshot.ids + productId else snapshot.ids - productId,
          overrides = snapshot.overrides + (productId to result.value),
          errorMessage = null,
        )
      }
      is AppResult.Failure -> _state.update { snapshot ->
        snapshot.copy(
          pending = snapshot.pending - productId,
          errorMessage = result.error.message,
        )
      }
    }
    return result
  }

  /** Clear a message the UI has already shown, so it is not shown twice. */
  fun clearError() {
    _state.update { it.copy(errorMessage = null) }
  }
}
