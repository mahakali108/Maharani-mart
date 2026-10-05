package com.maharanitraders.feature.catalog

import com.maharanitraders.core.common.AppResult
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

/**
 * What the app currently knows about the shopper's favourites.
 *
 * [overrides] holds ONLY states the server just confirmed for a specific product.
 * A screen whose payload already carries `isFavorite` falls back to that value, so
 * the map is never a place the app invents a favourite — it is the freshest server
 * answer, which is exactly what a shopper needs when they save something on the
 * product page and immediately scroll past it again in the list.
 */
data class FavoritesUiState(
  val overrides: Map<String, Boolean> = emptyMap(),
  val busyIds: Set<String> = emptySet(),
  val message: String? = null,
) {
  /** The state to paint for one product, given what its own payload said. */
  fun isFavorite(productId: String, fromPayload: Boolean): Boolean = overrides[productId] ?: fromPayload

  fun isBusy(productId: String): Boolean = productId in busyIds
}

/**
 * One owner of the favourite write for the whole catalogue surface.
 *
 * The endpoint (`POST /api/mobile/v1/favorites`) is a server-side TOGGLE: the
 * request carries a product id and no desired state, the caller's identity comes
 * from the verified bearer token, and `retailer_favorites_owner_*` RLS restricts
 * every row to its owner. This class therefore never sends "make it favourited"
 * and never assumes a result: it publishes the state the server answered with.
 *
 * A tap while a write is in flight for that product is dropped rather than
 * queued, because two toggles would flip the row back to where it started.
 */
@Singleton
class FavoritesStore @Inject constructor(
  private val repository: CatalogRepository,
) {

  private val _state = MutableStateFlow(FavoritesUiState())
  val state: StateFlow<FavoritesUiState> = _state.asStateFlow()

  /**
   * Save this product, or remove it if it is saved.
   *
   * suspends so callers can sequence it inside their own scope (and their own
   * tests) instead of this singleton keeping a process-lifetime coroutine alive.
   */
  suspend fun toggle(productId: String) {
    val id = productId.trim()
    if (id.isEmpty() || id in _state.value.busyIds) return

    _state.update { it.copy(busyIds = it.busyIds + id, message = null) }
    when (val result = repository.toggleFavorite(id)) {
      is AppResult.Success -> _state.update { state ->
        state.copy(
          busyIds = state.busyIds - id,
          overrides = state.overrides + (id to result.value),
          message = null,
        )
      }

      is AppResult.Failure -> _state.update { state ->
        state.copy(busyIds = state.busyIds - id, message = result.error.message)
      }
    }
  }

  fun consumeMessage() {
    _state.update { it.copy(message = null) }
  }
}
