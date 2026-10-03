package com.maharanitraders.feature.catalog

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.maharanitraders.core.common.AppResult
import com.maharanitraders.core.model.CatalogCategory
import com.maharanitraders.core.model.CatalogProduct
import com.maharanitraders.core.model.CatalogQuery
import com.maharanitraders.core.model.CatalogSort
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * The catalogue list state.
 *
 * `loading` is the FIRST load only; `loadingMore` is a continuation batch. They
 * are separate flags so appending a page can never blank the list the shopper is
 * reading, and so a stuck continuation cannot look like a fresh empty catalogue.
 */
data class CatalogUiState(
  val query: CatalogQuery = CatalogQuery.DEFAULT,
  val categories: List<CatalogCategory> = emptyList(),
  val products: List<CatalogProduct> = emptyList(),
  val nextCursor: String? = null,
  val hasMore: Boolean = false,
  val loading: Boolean = true,
  val loadingMore: Boolean = false,
  val categoriesLoading: Boolean = false,
  val errorMessage: String? = null,
  val offline: Boolean = false,
  val retryable: Boolean = true,
  /** Exact match count for the current filters, when the server supplied one. */
  val resultCount: Int? = null,
  /** True when the server capped its working set — the UI must disclose it. */
  val resultCapped: Boolean = false,
  /** Set when a continuation returned the same cursor: the list has ended. */
  val endOfList: Boolean = false,
  /**
   * Display label of a brand filter applied from outside the catalogue (the
   * home screen's brand rail). The catalogue's own chip row is categories; a
   * brand filter arrives already chosen, so its name travels with the request.
   */
  val brandLabel: String? = null,
) {
  val isEmpty: Boolean get() = !loading && errorMessage == null && products.isEmpty()
  val selectedCategoryName: String?
    get() = query.categoryId?.let { id -> categories.firstOrNull { it.id == id }?.name }
}

/**
 * Search, filter and paginate the real catalogue.
 *
 * Pagination discipline, all of which the migration contract requires:
 *  - the cursor is OPAQUE and is stored, never parsed or edited;
 *  - a cursor the server repeats terminates the list instead of re-requesting
 *    the same rows forever (the same guard the web's infinite scroll uses);
 *  - appended batches are de-duplicated by product id, so a row that moves
 *    between two batches cannot appear twice;
 *  - `hasMore` comes from the server. It is never inferred from a full batch.
 *
 * The ViewModel sends filters only. It never sends a price, a stock value or an
 * identity — the server resolves all of those from the verified token.
 */
@HiltViewModel
class CatalogViewModel @Inject constructor(
  private val repository: CatalogRepository,
) : ViewModel() {

  private val _state = MutableStateFlow(CatalogUiState())
  val state: StateFlow<CatalogUiState> = _state.asStateFlow()

  private var searchJob: Job? = null
  private var listJob: Job? = null

  init {
    loadCategories()
    reload()
  }

  fun loadCategories() {
    if (_state.value.categories.isNotEmpty()) return
    _state.update { it.copy(categoriesLoading = true) }
    viewModelScope.launch {
      when (val result = repository.loadCategories()) {
        is AppResult.Success -> _state.update {
          it.copy(categories = result.value, categoriesLoading = false)
        }
        // A missing category strip must not take the product list down with it:
        // the failure is reported, and the list still loads unfiltered.
        is AppResult.Failure -> _state.update { it.copy(categoriesLoading = false) }
      }
    }
  }

  /**
   * Typed search. Debounced, and it restarts the list from the top — a filter
   * change is a new result set, not another page of the old one.
   */
  fun onSearchChange(value: String) {
    _state.update { it.copy(query = it.query.copy(search = value)) }
    searchJob?.cancel()
    searchJob = viewModelScope.launch {
      delay(SEARCH_DEBOUNCE_MS)
      reload()
    }
  }

  fun selectCategory(categoryId: String?) {
    val current = _state.value.query.categoryId
    if (current == categoryId) return
    _state.update { it.copy(query = it.query.copy(categoryId = categoryId)) }
    reload()
  }

  fun selectSort(sort: CatalogSort) {
    if (_state.value.query.sort == sort) return
    _state.update { it.copy(query = it.query.copy(sort = sort)) }
    reload()
  }

  /**
   * Brand filtering. The chip row carries categories; a brand usually arrives
   * already chosen (the home brand rail), together with the label to show.
   * Selecting `null` clears it.
   */
  fun selectBrand(brandId: String?, label: String? = null) {
    val current = _state.value.query.brandId
    if (current == brandId) return
    _state.update {
      it.copy(
        query = it.query.copy(brandId = brandId),
        brandLabel = if (brandId == null) null else label ?: it.brandLabel,
      )
    }
    reload()
  }

  fun toggleInStockOnly() {
    _state.update { it.copy(query = it.query.copy(inStockOnly = !it.query.inStockOnly)) }
    reload()
  }

  fun clearFilters() {
    _state.update { it.copy(query = CatalogQuery.DEFAULT, brandLabel = null) }
    reload()
  }

  /** Fetch the first batch for the current filters. */
  fun reload() {
    listJob?.cancel()
    _state.update {
      it.copy(
        loading = true,
        loadingMore = false,
        errorMessage = null,
        offline = false,
        endOfList = false,
        resultCount = null,
        resultCapped = false,
      )
    }
    listJob = viewModelScope.launch { fetch(cursor = null, append = false) }
  }

  /** Fetch the next batch. A no-op while one is in flight or the list has ended. */
  fun loadMore() {
    val current = _state.value
    if (current.loading || current.loadingMore || !current.hasMore || current.nextCursor == null) return
    if (current.endOfList) return

    _state.update { it.copy(loadingMore = true) }
    listJob = viewModelScope.launch { fetch(cursor = current.nextCursor, append = true) }
  }

  fun retry() = reload()

  private suspend fun fetch(cursor: String?, append: Boolean) {
    val query = _state.value.query
    when (val result = repository.loadProducts(query, cursor)) {
      is AppResult.Success -> {
        val page = result.value
        _state.update { state ->
          val merged = if (append) dedupeById(state.products, page.products) else page.products
          // A server that hands back the very cursor it was given cannot
          // advance: stop, rather than scrolling forever on the same rows.
          val stalled = append && cursor != null && page.nextCursor == cursor
          state.copy(
            products = merged,
            nextCursor = page.nextCursor,
            hasMore = page.hasMore && !stalled,
            endOfList = stalled || !page.hasMore,
            loading = false,
            loadingMore = false,
            errorMessage = null,
            offline = false,
            resultCount = page.resultCount ?: state.resultCount,
            resultCapped = page.resultCapped,
          )
        }
      }

      is AppResult.Failure -> _state.update { state ->
        state.copy(
          // On a continuation failure the rows already on screen stay: the
          // shopper keeps reading, and the retry replaces only the footer.
          loading = false,
          loadingMore = false,
          errorMessage = result.error.message,
          offline = result.error.isOffline,
          retryable = result.error.retryable,
        )
      }
    }
  }

  companion object {
    const val SEARCH_DEBOUNCE_MS = 300L

    /** Keep the rendered list stable across batches. */
    fun dedupeById(existing: List<CatalogProduct>, incoming: List<CatalogProduct>): List<CatalogProduct> {
      val seen = existing.mapTo(HashSet()) { it.id }
      val merged = existing.toMutableList()
      for (product in incoming) {
        if (seen.add(product.id)) merged.add(product)
      }
      return merged
    }
  }
}
