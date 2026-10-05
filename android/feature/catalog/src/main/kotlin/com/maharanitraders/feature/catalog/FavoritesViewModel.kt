package com.maharanitraders.feature.catalog

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.maharanitraders.core.common.AppResult
import com.maharanitraders.core.model.CatalogProduct
import com.maharanitraders.core.model.CatalogQuery
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * The favourites list state.
 *
 * [products] are real catalogue rows — the same priced, stock-checked cards the
 * catalogue renders — because the list is `GET /catalog/products?fav=1`, not a
 * separate favourites projection that could price a product differently.
 */
data class FavoritesUiState(
  val products: List<CatalogProduct> = emptyList(),
  val nextCursor: String? = null,
  val hasMore: Boolean = false,
  val loading: Boolean = true,
  val loadingMore: Boolean = false,
  val refreshing: Boolean = false,
  val errorMessage: String? = null,
  val offline: Boolean = false,
  val retryable: Boolean = true,
  val endOfList: Boolean = false,
  val resultCount: Int? = null,
  /** Message from a failed favourite toggle, for a snackbar. */
  val actionMessage: String? = null,
) {
  val isEmpty: Boolean get() = !loading && errorMessage == null && products.isEmpty()
}

/**
 * The saved-products screen.
 *
 * Two server facts drive it and nothing else: the favourite id set held by
 * [FavoritesStore], and the catalogue page the server returns for `fav=1`. The
 * screen never keeps its own copy of "is this a favourite" — it asks the store,
 * so a heart tapped on product detail is already correct when the shopper comes
 * back here, and vice versa.
 *
 * Removing a favourite drops the row only AFTER the server confirmed the
 * removal, which is why [toggleFavorite] inspects the returned boolean instead
 * of assuming the tap succeeded.
 */
@HiltViewModel
class FavoritesViewModel @Inject constructor(
  private val repository: CatalogRepository,
  private val favorites: FavoritesStore,
) : ViewModel() {

  private val _state = MutableStateFlow(FavoritesUiState())
  val state: StateFlow<FavoritesUiState> = _state.asStateFlow()

  /** The shared favourite set, observed directly so there is one copy of it. */
  val favoriteState: StateFlow<FavoritesSnapshot> = favorites.state

  private var listJob: Job? = null

  init {
    viewModelScope.launch { favorites.ensureLoaded() }
    reload()
  }

  fun reload() {
    listJob?.cancel()
    _state.update {
      it.copy(
        loading = it.products.isEmpty(),
        refreshing = it.products.isNotEmpty(),
        loadingMore = false,
        errorMessage = null,
        offline = false,
        endOfList = false,
        resultCount = null,
      )
    }
    listJob = viewModelScope.launch {
      // Re-read the authoritative set alongside the list so a favourite removed
      // on another device disappears from both at the same time.
      favorites.refresh()
      fetch(cursor = null, append = false)
    }
  }

  fun loadMore() {
    val current = _state.value
    if (current.loading || current.loadingMore || !current.hasMore) return
    val cursor = current.nextCursor ?: return
    if (current.endOfList) return

    _state.update { it.copy(loadingMore = true) }
    listJob = viewModelScope.launch { fetch(cursor = cursor, append = true) }
  }

  fun retry() = reload()

  /**
   * Toggle one product from the favourites screen.
   *
   * On a confirmed removal the row leaves the list, because a favourites screen
   * that still lists a product the server no longer saves is simply wrong. On
   * failure the row stays and the message is surfaced.
   */
  fun toggleFavorite(productId: String) {
    viewModelScope.launch {
      when (val result = favorites.toggle(productId)) {
        is AppResult.Success -> if (!result.value) {
          _state.update { state ->
            state.copy(
              products = state.products.filterNot { it.id == productId },
              resultCount = state.resultCount?.let { count -> (count - 1).coerceAtLeast(0) },
            )
          }
        }
        is AppResult.Failure -> _state.update {
          it.copy(actionMessage = result.error.message)
        }
      }
    }
  }

  fun consumeActionMessage() {
    _state.update { it.copy(actionMessage = null) }
  }

  private suspend fun fetch(cursor: String?, append: Boolean) {
    val query = CatalogQuery(favoritesOnly = true)
    when (val result = repository.loadProducts(query, cursor)) {
      is AppResult.Success -> {
        val page = result.value
        _state.update { state ->
          val merged = if (append) {
            CatalogViewModel.dedupeById(state.products, page.products)
          } else {
            page.products
          }
          // A repeated cursor cannot advance the list: stop instead of asking
          // for the same rows forever. Same guard as the catalogue.
          val stalled = append && cursor != null && page.nextCursor == cursor
          state.copy(
            products = merged,
            nextCursor = page.nextCursor,
            hasMore = page.hasMore && !stalled,
            endOfList = stalled || !page.hasMore,
            loading = false,
            refreshing = false,
            loadingMore = false,
            errorMessage = null,
            offline = false,
            resultCount = page.resultCount ?: state.resultCount,
          )
        }
      }

      is AppResult.Failure -> _state.update { state ->
        state.copy(
          loading = false,
          refreshing = false,
          loadingMore = false,
          errorMessage = result.error.message,
          offline = result.error.isOffline,
          retryable = result.error.retryable,
        )
      }
    }
  }
}
