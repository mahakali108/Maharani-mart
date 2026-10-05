package com.maharanitraders.feature.catalog

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.maharanitraders.core.common.AppResult
import com.maharanitraders.core.model.CatalogProduct
import com.maharanitraders.core.model.CatalogQuery
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * The favourites list, as the device holds it.
 *
 * [items] is one server-filtered page after another: the app never assembles a
 * wishlist out of ids it cached, so a product favourited on the web appears on
 * the next read rather than never. [endOfList] is the guard the web list uses
 * too — a cursor the server hands back unchanged ends the list instead of
 * requesting the same rows forever.
 */
data class FavoritesListState(
  val loading: Boolean = true,
  val refreshing: Boolean = false,
  val loadingMore: Boolean = false,
  val items: List<CatalogProduct> = emptyList(),
  val nextCursor: String? = null,
  val hasMore: Boolean = false,
  val errorMessage: String? = null,
  val offline: Boolean = false,
  val retryable: Boolean = true,
  val endOfList: Boolean = false,
  /** The server's exact match count, known on the first batch only. */
  val resultCount: Int? = null,
  /** True when the server capped its working set; the screen must say so. */
  val resultCapped: Boolean = false,
) {
  val isEmpty: Boolean get() = !loading && errorMessage == null && items.isEmpty()
}

/**
 * The shopper's saved products, read through the catalogue's own favourite filter.
 *
 * `GET /api/mobile/v1/catalog/products?fav=1` is the endpoint the web favourites
 * page is built on: the server selects the caller's `retailer_favorites` rows,
 * prices every pack for THIS retailer, and paginates like the catalogue does. So
 * this list shows live prices and live stock — a saved product that went out of
 * stock says so instead of looking orderable.
 *
 * Removing a favourite goes through [FavoritesStore], i.e. the same server-side
 * toggle as the product page, and the row disappears because it is no longer in
 * the server's answer. Nothing here deletes or restores a favourite locally.
 */
@HiltViewModel
class FavoritesViewModel @Inject constructor(
  private val repository: CatalogRepository,
  private val store: FavoritesStore,
) : ViewModel() {

  /** Heart states and in-flight writes, shared with the catalogue grid and the PDP. */
  val favorites: StateFlow<FavoritesUiState> = store.state

  private val _list = MutableStateFlow(FavoritesListState())
  val list: StateFlow<FavoritesListState> = _list.asStateFlow()

  init {
    load()
  }

  fun load() {
    val hasContent = _list.value.items.isNotEmpty()
    _list.update {
      if (hasContent) {
        // A refresh keeps the current rows and the count on screen; only the
        // answer replaces them, so a number never flickers to "0 saved".
        it.copy(refreshing = true, errorMessage = null, endOfList = false)
      } else {
        it.copy(loading = true, errorMessage = null, endOfList = false, resultCount = null)
      }
    }
    viewModelScope.launch {
      when (val result = repository.loadProducts(FAVORITES_QUERY, cursor = null)) {
        is AppResult.Success -> _list.update {
          it.copy(
            loading = false,
            refreshing = false,
            items = result.value.products,
            nextCursor = result.value.nextCursor,
            hasMore = result.value.hasMore,
            resultCount = result.value.resultCount,
            resultCapped = result.value.resultCapped,
            errorMessage = null,
            offline = false,
          )
        }

        is AppResult.Failure -> _list.update {
          it.copy(
            loading = false,
            refreshing = false,
            errorMessage = result.error.message,
            offline = result.error.isOffline,
            retryable = result.error.retryable,
          )
        }
      }
    }
  }

  fun loadMore() {
    val current = _list.value
    val cursor = current.nextCursor ?: return
    if (current.loadingMore || current.endOfList) return
    _list.update { it.copy(loadingMore = true) }
    viewModelScope.launch {
      when (val result = repository.loadProducts(FAVORITES_QUERY, cursor = cursor)) {
        is AppResult.Success -> _list.update { state ->
          // The server's own cursor is the only continuation signal; a repeat
          // means the list has genuinely ended.
          val repeats = result.value.nextCursor != null && result.value.nextCursor == state.nextCursor
          val seen = state.items.map(CatalogProduct::id).toSet()
          state.copy(
            loadingMore = false,
            items = state.items + result.value.products.filterNot { it.id in seen },
            nextCursor = if (repeats) null else result.value.nextCursor,
            hasMore = result.value.hasMore && !repeats,
            endOfList = repeats,
          )
        }

        is AppResult.Failure -> _list.update {
          it.copy(loadingMore = false, errorMessage = result.error.message)
        }
      }
    }
  }

  /**
   * Save or un-save one product — the server decides which, and this screen paints
   * its answer. A removal therefore only takes effect once the write confirmed,
   * so a failed request cannot silently lose someone's saved product.
   */
  fun toggleFavorite(productId: String) {
    viewModelScope.launch { store.toggle(productId) }
  }

  /** Acknowledge a failed write; the state of every heart is untouched by this. */
  fun dismissMessage() {
    store.consumeMessage()
  }

  private companion object {
    /** The only filter this list applies: the caller's favourites, nothing else. */
    val FAVORITES_QUERY = CatalogQuery(onlyFavorites = true)
  }
}
