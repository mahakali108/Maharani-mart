package com.maharanitraders.feature.catalog

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.maharanitraders.core.common.AppResult
import com.maharanitraders.core.model.CatalogBrand
import com.maharanitraders.core.model.CatalogCategory
import com.maharanitraders.core.model.CatalogProduct
import com.maharanitraders.core.model.CatalogQuery
import com.maharanitraders.core.model.CatalogSort
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * The catalogue state: which pane, which filters, and the server's product
 * batches.
 *
 * `loading` is the FIRST load of the product list; `loadingMore` is a
 * continuation batch; `categoriesLoading`/`brandsLoading` belong to the
 * directory panes. They are separate flags so appending a page can never blank
 * the list the shopper is reading, and so a slow taxonomy read cannot make the
 * products look empty (or the reverse).
 */
data class CatalogUiState(
  /** Which pane is showing. Tapping a category or brand tile moves to PRODUCTS. */
  val tab: CatalogTab = CatalogTab.PRODUCTS,
  val query: CatalogQuery = CatalogQuery.DEFAULT,
  val categories: List<CatalogCategory> = emptyList(),
  val brands: List<CatalogBrand> = emptyList(),
  val products: List<CatalogProduct> = emptyList(),
  val nextCursor: String? = null,
  val hasMore: Boolean = false,
  val loading: Boolean = true,
  val loadingMore: Boolean = false,
  val categoriesLoading: Boolean = false,
  val brandsLoading: Boolean = false,
  /** The category taxonomy has answered (successfully or not). */
  val categoriesLoaded: Boolean = false,
  /** The brand taxonomy has answered (successfully or not). */
  val brandsLoaded: Boolean = false,
  /**
   * On-device narrowing of the directory panes. It filters the names the server
   * already sent and never issues a request, because the catalogue's server
   * search is for products — this field must not be mistaken for it.
   */
  val directoryFilter: String = "",
  /**
   * Per-pane failure. Kept apart on purpose: a categories outage must not put an
   * error on the Brands pane, which may have loaded perfectly well.
   */
  val categoriesError: String? = null,
  val categoriesOffline: Boolean = false,
  val brandsError: String? = null,
  val brandsOffline: Boolean = false,
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
  /** Message from a failed favourite toggle, for a snackbar. */
  val actionMessage: String? = null,
) {
  val isEmpty: Boolean get() = !loading && errorMessage == null && products.isEmpty()

  val selectedCategoryName: String?
    get() = query.categoryId?.let { id -> categories.firstOrNull { it.id == id }?.name }

  val selectedCategory: CatalogCategory?
    get() = query.categoryId?.let { id -> categories.firstOrNull { it.id == id } }

  val selectedBrand: CatalogBrand?
    get() = query.brandId?.let { id -> brands.firstOrNull { it.id == id } }

  /** Either directory read is in flight. */
  val directoryLoading: Boolean get() = categoriesLoading || brandsLoading

  val visibleCategories: List<CatalogCategory>
    get() = categories.filterBy(directoryFilter) { it.name }

  val visibleBrands: List<CatalogBrand>
    get() = brands.filterBy(directoryFilter) { it.name }

  /**
   * The shop genuinely publishes no categories (and the read succeeded): an
   * empty state, not a failure and not "no match".
   */
  val categoriesEmpty: Boolean
    get() = categoriesLoaded && categoriesError == null && categories.isEmpty()

  /** As [categoriesEmpty], for the Brands pane. */
  val brandsEmpty: Boolean
    get() = brandsLoaded && brandsError == null && brands.isEmpty()

  /** A local filter that matches no category the server sent. */
  val categoriesNoMatch: Boolean
    get() = categoriesLoaded && categoriesError == null && directoryFilter.isNotBlank() &&
      visibleCategories.isEmpty() && !categoriesEmpty

  /** A local filter that matches no brand the server sent. */
  val brandsNoMatch: Boolean
    get() = brandsLoaded && brandsError == null && directoryFilter.isNotBlank() &&
      visibleBrands.isEmpty() && !brandsEmpty

  private fun <T> List<T>.filterBy(needle: String, name: (T) -> String): List<T> {
    val trimmed = needle.trim()
    if (trimmed.isEmpty()) return this
    return filter { name(it).contains(trimmed, ignoreCase = true) }
  }
}

/**
 * Search, filter and paginate the real catalogue — and hold the real taxonomy
 * that filters it.
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
 *
 * Categories and brands are read ONCE per screen (in parallel, through the same
 * `GET /catalog/categories` and `GET /catalog/brands` the filter chips and the
 * home rails use) and then narrowed on the device, which is why switching panes
 * never costs a request. Tapping a tile only changes the product filter that
 * the existing, tested list path already handles.
 */
@HiltViewModel
class CatalogViewModel @Inject constructor(
  private val repository: CatalogRepository,
  private val favorites: FavoritesStore,
) : ViewModel() {

  private val _state = MutableStateFlow(CatalogUiState())
  val state: StateFlow<CatalogUiState> = _state.asStateFlow()

  /** The shared favourite set. The catalogue keeps no copy of its own. */
  val favoriteState: StateFlow<FavoritesSnapshot> = favorites.state

  private var searchJob: Job? = null
  private var listJob: Job? = null
  private var directoryJob: Job? = null

  init {
    viewModelScope.launch { favorites.ensureLoaded() }
    loadDirectories()
    reload()
  }

  /**
   * Save or unsave a product from the grid.
   *
   * The id is a product id taken from the card the shopper tapped, and the
   * store records only what the server confirmed — a failed toggle leaves the
   * heart as it was and reports the reason.
   */
  fun toggleFavorite(productId: String) {
    viewModelScope.launch {
      when (val result = favorites.toggle(productId)) {
        is AppResult.Success -> Unit
        is AppResult.Failure -> _state.update { it.copy(actionMessage = result.error.message) }
      }
    }
  }

  fun consumeActionMessage() {
    _state.update { it.copy(actionMessage = null) }
  }

  /** Switch pane. Free: every pane is rendered from state this screen already has. */
  fun selectTab(tab: CatalogTab) {
    if (_state.value.tab == tab) return
    _state.update { it.copy(tab = tab) }
  }

  /** Narrow the directory panes to names the server already sent. No request. */
  fun onDirectoryFilterChange(value: String) {
    _state.update { it.copy(directoryFilter = value) }
  }

  /**
   * Read the taxonomy. Called once on open, and again only when the shopper asks
   * (retry) or after a failure — a successful read is never repeated by a pane
   * switch, and the two endpoints are fetched in parallel.
   */
  fun loadDirectories(force: Boolean = false) {
    if (directoryJob?.isActive == true) return
    val current = _state.value
    val complete = current.categoriesLoaded && current.brandsLoaded &&
      current.categoriesError == null && current.brandsError == null
    if (complete && !force) return

    _state.update {
      it.copy(
        categoriesLoading = true,
        brandsLoading = true,
        categoriesError = null,
        categoriesOffline = false,
        brandsError = null,
        brandsOffline = false,
      )
    }

    directoryJob = viewModelScope.launch {
      val (categories, brands) = coroutineScope {
        val cats = async { repository.loadCategories() }
        val brandList = async { repository.loadBrands() }
        cats.await() to brandList.await()
      }

      _state.update { current ->
        current.copy(
          categoriesLoading = false,
          brandsLoading = false,
          categories = (categories as? AppResult.Success)?.value ?: current.categories,
          // A missing brand list must not blank the category directory, and vice
          // versa: whichever read succeeded is kept and shown.
          brands = (brands as? AppResult.Success)?.value ?: current.brands,
          categoriesLoaded = true,
          brandsLoaded = true,
          // Each pane is honest about its own read: it shows the reason and
          // offers a retry rather than an empty shop.
          categoriesError = (categories as? AppResult.Failure)?.error?.message,
          categoriesOffline = (categories as? AppResult.Failure)?.error?.isOffline == true,
          brandsError = (brands as? AppResult.Failure)?.error?.message,
          brandsOffline = (brands as? AppResult.Failure)?.error?.isOffline == true,
        )
      }
    }
  }

  /** The directory panes' retry. Re-reads both endpoints, keeping what succeeds. */
  fun retryDirectories() = loadDirectories(force = true)

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

  /**
   * The IME search action: search NOW instead of waiting out the debounce.
   *
   * It cancels the pending debounce so the term is read once, not twice, and
   * runs the same [reload] every other query change runs — there is no separate
   * "submitted search" code path that could rank or filter differently from a
   * typed one.
   */
  fun submitSearch() {
    searchJob?.cancel()
    reload()
  }

  /**
   * Apply (or clear) the category filter. Tapping a tile in the Categories pane
   * is the same call, and it moves the shopper to the product list so they can
   * see what the filter did — one catalogue, one result set.
   */
  fun selectCategory(categoryId: String?) {
    val changed = _state.value.query.categoryId != categoryId
    _state.update {
      it.copy(
        tab = CatalogTab.PRODUCTS,
        query = it.query.copy(categoryId = categoryId),
      )
    }
    if (changed) reload()
  }

  fun selectSort(sort: CatalogSort) {
    if (_state.value.query.sort == sort) return
    _state.update { it.copy(query = it.query.copy(sort = sort)) }
    reload()
  }

  /**
   * Brand filtering. The chip row carries categories; a brand usually arrives
   * already chosen (a brand tile or the home brand rail), together with the
   * label to show. Selecting `null` clears it.
   */
  fun selectBrand(brandId: String?, label: String? = null) {
    val current = _state.value
    val changed = current.query.brandId != brandId
    _state.update {
      it.copy(
        tab = CatalogTab.PRODUCTS,
        query = it.query.copy(brandId = brandId),
        brandLabel = if (brandId == null) {
          null
        } else {
          label ?: it.brands.firstOrNull { brand -> brand.id == brandId }?.name ?: it.brandLabel
        },
      )
    }
    if (changed) reload()
  }

  /**
   * Clear the applied CATEGORY and BRAND scope in one step.
   *
   * The "All" affordances mean "no scope", which is both filters at once, and
   * [selectCategory]/[selectBrand] each reload on their own — clearing both
   * through them fired two catalogue reads for one tap and let the first,
   * already-obsolete response race the second. One state update, one read.
   *
   * Search, sort and the in-stock switch are deliberately NOT touched: this is
   * the scope control, not `clearFilters()`.
   */
  fun clearScope() {
    val current = _state.value
    if (current.query.categoryId == null && current.query.brandId == null) return
    _state.update {
      it.copy(query = it.query.copy(categoryId = null, brandId = null), brandLabel = null)
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

  /**
   * Apply the request the shell opened this screen with — search term, category,
   * brand and pane — as ONE query change and ONE list load.
   *
   * WHY THIS EXISTS AS A SINGLE CALL
   * The catalogue is opened from five places (the tab, the home search box, a
   * home category rail, a brand tile and the favourites screen's "browse" empty
   * state), and a deep link can carry a search AND a category AND a brand at
   * once. Driving that through [onSearchChange] + [selectCategory] +
   * [selectBrand] fired one request per field — up to four catalog reads for one
   * tap, each one discarded by the next, and each one counting against the
   * server's `read.catalog` budget (120/min, `lib/mobile/rate-limit.ts`). A
   * burst of those is how a healthy session starts answering `429`.
   *
   * So the filters are folded into one state update and the in-flight first
   * batch — which was fetched for the DEFAULT query and is already obsolete — is
   * cancelled before it can be rendered. `reload()` is skipped entirely when the
   * request adds nothing, which is the common case: opening the tab with no
   * filter keeps the single load `init` already started.
   */
  fun applyInitialRequest(
    search: String = "",
    categoryId: String? = null,
    brandId: String? = null,
    brandLabel: String? = null,
    tab: CatalogTab = CatalogTab.PRODUCTS,
  ) {
    val current = _state.value
    val nextQuery = current.query.copy(
      search = search.trim(),
      categoryId = categoryId,
      brandId = brandId,
    )
    val nextLabel = if (brandId == null) {
      null
    } else {
      brandLabel ?: current.brands.firstOrNull { brand -> brand.id == brandId }?.name
    }
    if (nextQuery == current.query && nextLabel == current.brandLabel && tab == current.tab) return

    // The pending debounce (if the shopper is typing) belongs to the old query.
    searchJob?.cancel()
    _state.update {
      it.copy(tab = tab, query = nextQuery, brandLabel = nextLabel, directoryFilter = "")
    }
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
