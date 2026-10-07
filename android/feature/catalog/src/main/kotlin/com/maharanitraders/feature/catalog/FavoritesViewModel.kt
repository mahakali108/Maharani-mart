package com.maharanitraders.feature.catalog

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.maharanitraders.core.common.AppResult
import com.maharanitraders.core.model.CatalogProduct
import com.maharanitraders.core.model.CatalogQuery
import com.maharanitraders.core.model.PackAvailability
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * How the saved list is ordered.
 *
 * Only orderings the SERVER's own rows can answer are offered: the catalogue
 * row carries a name and a per-piece rate, so name and price are real. There is
 * deliberately no "recently saved" — the catalogue row has no saved-at
 * timestamp, and inventing one would put the list in an order the shopper
 * cannot predict.
 */
enum class FavoritesSort(val label: String) {
  NAME("Name: A to Z"),
  PRICE_LOW("Price: low to high"),
  PRICE_HIGH("Price: high to low"),
}

/**
 * The saved list as the shopper asked to see it.
 *
 * Sorting and the in-stock filter are pure view operations over rows the server
 * PRICED and STOCKED: nothing is re-priced, and a hidden row is simply not
 * drawn. A product the server priced without a rate sorts LAST rather than
 * first, because "cheapest" must never mean "the price we could not read".
 */
fun favoritesView(
  products: List<CatalogProduct>,
  sort: FavoritesSort,
  inStockOnly: Boolean,
): List<CatalogProduct> {
  val filtered = if (inStockOnly) {
    products.filter { it.pack?.availability != PackAvailability.OUT_OF_STOCK }
  } else {
    products
  }
  return when (sort) {
    FavoritesSort.NAME -> filtered.sortedWith(nameComparator())
    FavoritesSort.PRICE_LOW -> filtered.sortedWith(priceComparator(ascending = true))
    FavoritesSort.PRICE_HIGH -> filtered.sortedWith(priceComparator(ascending = false))
  }
}

/** Name order, case-insensitively, so "atta" and "Atta" sit together. */
private fun nameComparator(): Comparator<CatalogProduct> = Comparator { left, right ->
  left.name.compareTo(right.name, ignoreCase = true)
}

/**
 * Price order, with the unpriced rows LAST in both directions.
 *
 * Written out rather than composed from `compareBy(nullsLast())` because the
 * rule is not "nulls last" — it is "a row the server could not price goes to the
 * bottom whether the shopper asked for cheapest or dearest". Sorting a null to
 * the top of a "low to high" list would advertise an unreadable rate as the
 * cheapest product in the shop.
 */
private fun priceComparator(ascending: Boolean): Comparator<CatalogProduct> = Comparator { left, right ->
  val leftPrice = left.pack?.unitPricePaise
  val rightPrice = right.pack?.unitPricePaise
  when {
    leftPrice == null && rightPrice == null -> nameComparator().compare(left, right)
    leftPrice == null -> 1
    rightPrice == null -> -1
    leftPrice == rightPrice -> nameComparator().compare(left, right)
    else -> if (ascending) leftPrice.compareTo(rightPrice) else rightPrice.compareTo(leftPrice)
  }
}

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
  /** How the saved list is ordered. A view preference over server rows. */
  val sort: FavoritesSort = FavoritesSort.NAME,
  /** Hide what the server currently reports as out of stock. */
  val inStockOnly: Boolean = false,
) {
  val isEmpty: Boolean get() = !loading && errorMessage == null && products.isEmpty()

  /** The rows to draw, in the order the shopper chose. */
  val visibleProducts: List<CatalogProduct>
    get() = favoritesView(products, sort, inStockOnly)

  /** Everything saved is out of stock — a different sentence from "saved nothing". */
  val allHiddenByFilter: Boolean
    get() = products.isNotEmpty() && visibleProducts.isEmpty()
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

  /** Re-order the saved list. No request: it re-sorts the rows on screen. */
  fun selectSort(sort: FavoritesSort) {
    _state.update { it.copy(sort = sort) }
  }

  /**
   * Hide (or show) what the server reports as out of stock.
   *
   * The filter is over the availability the SERVER just returned for these
   * rows, so "in stock" here is the same two-state fact the cards show — never
   * a stock count, which this API deliberately does not publish.
   */
  fun toggleInStockOnly() {
    _state.update { it.copy(inStockOnly = !it.inStockOnly) }
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
