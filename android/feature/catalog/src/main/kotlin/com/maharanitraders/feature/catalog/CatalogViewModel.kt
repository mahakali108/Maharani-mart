package com.maharanitraders.feature.catalog

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.maharanitraders.core.common.AppResult
import com.maharanitraders.core.model.CatalogBrand
import com.maharanitraders.core.model.CatalogCategory
import com.maharanitraders.core.model.CatalogProduct
import com.maharanitraders.core.model.CatalogQuery
import com.maharanitraders.core.model.CatalogSort
import com.maharanitraders.core.model.ProductDetail
import com.maharanitraders.core.model.SearchSuggestion
import com.maharanitraders.core.model.SearchSuggestions
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
   * Display label for the active brand scope. The product filter rail normally
   * resolves it from the real brand list; a home deep link may also provide the
   * server-backed label while the taxonomy read is still loading.
   */
  val brandLabel: String? = null,
  /** Message from a failed favourite toggle, for a snackbar. */
  val actionMessage: String? = null,

  // -----------------------------------------------------------------------
  // Filter sheet (see CatalogFilters)
  // -----------------------------------------------------------------------

  /** True while the bottom-sheet filter UI is open. */
  val filtersOpen: Boolean = false,
  /**
   * Why the last Apply was refused, or null.
   *
   * A refusal is shown INSTEAD of reloading: sending a bound the server would
   * drop (`minPrice=abc`) would render an unfiltered list behind a control that
   * looks applied, which is the exact failure this sheet must not have.
   */
  val filterError: String? = null,

  // -----------------------------------------------------------------------
  // Cross-entity search suggestions
  // -----------------------------------------------------------------------

  /** The latest suggestion answer. [SearchSuggestions.NONE] before the first. */
  val suggestions: SearchSuggestions = SearchSuggestions.NONE,
  val suggestionsLoading: Boolean = false,
  /**
   * A failed suggestion read. Kept strictly apart from an empty answer: the
   * server not answering must never render as "no match" (and the product list
   * below keeps working, because it is a different request).
   */
  val suggestionsError: String? = null,
  /** Whether the suggestion panel is on screen. The shopper dismisses it. */
  val suggestionsVisible: Boolean = false,

  // -----------------------------------------------------------------------
  // Product comparison (see ProductCompare)
  // -----------------------------------------------------------------------

  /** Products parked in the comparison tray, newest last, capped at four. */
  val compareIds: Set<String> = emptySet(),
  /** True while the comparison overlay is on screen. */
  val compareOpen: Boolean = false,
  /** True while the tray's current server details are being read. */
  val compareLoading: Boolean = false,
  /**
   * The details the tray is showing, fetched from `GET /catalog/products/{id}`
   * when the overlay opens. They are the CURRENT rows, so a comparison can
   * never quote a rate the cart would no longer honour.
   */
  val compareDetails: List<ProductDetail> = emptyList(),
  /** A comparison read that failed. The rows that did load are still shown. */
  val compareError: String? = null,
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
  /**
   * The device-local search history. Terms the shopper actually searched are
   * remembered here (never on the server, which has no such table) and offered
   * back as chips, so a wholesale buyer's repeat searches are one tap instead of
   * retyping long product names on a phone keyboard.
   */
  private val history: LocalHistoryStore,
) : ViewModel() {

  private val _state = MutableStateFlow(CatalogUiState())
  val state: StateFlow<CatalogUiState> = _state.asStateFlow()

  /** The shared favourite set. The catalogue keeps no copy of its own. */
  val favoriteState: StateFlow<FavoritesSnapshot> = favorites.state

  /** Recent searches, newest first. Empty until the store has loaded. */
  val recentSearches: StateFlow<List<String>> = history.recentSearches

  private var searchJob: Job? = null
  private var listJob: Job? = null
  private var directoryJob: Job? = null
  private var suggestionJob: Job? = null

  /**
   * Details already read for the comparison tray, keyed by product id.
   *
   * It is a cache of SERVER rows for a selection the shopper is still looking
   * at, not a local copy of the catalogue: it is dropped the moment the tray is
   * emptied ([clearCompare]) and re-read on the next open, so a parked product
   * is never compared at a rate the server has since changed.
   */
  private val compareCache = mutableMapOf<String, ProductDetail>()

  init {
    viewModelScope.launch { favorites.ensureLoaded() }
    viewModelScope.launch { history.ensureLoaded() }
    loadDirectories()
    reload()
  }

  /**
   * Run a term from the recent-search chips.
   *
   * It goes through the same query state and the same [reload] as a typed
   * search, so a chip cannot rank, filter or price differently from typing the
   * same words — and the term moves to the front of the history, which is what
   * makes the chips useful rather than stale.
   */
  fun useRecentSearch(term: String) {
    val trimmed = term.trim()
    if (trimmed.isEmpty()) return
    searchJob?.cancel()
    suggestionJob?.cancel()
    _state.update {
      it.copy(
        query = it.query.copy(search = trimmed),
        tab = CatalogTab.PRODUCTS,
        suggestionsVisible = false,
        suggestionsLoading = false,
      )
    }
    viewModelScope.launch { history.recordSearch(trimmed) }
    reload()
  }

  fun clearRecentSearches() {
    viewModelScope.launch { history.clearSearches() }
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

  // ------------------------------------------------------------------- compare

  /**
   * Park a product in the comparison tray, or take it out.
   *
   * Selection is the ONLY thing that happens here — no request, no price. The
   * current figures are read when the shopper opens the tray ([openCompare]),
   * which is what keeps a parked product from being compared at a stale rate.
   * A fourth selection is refused rather than silently dropping the first: a
   * shopkeeper who taps four products must see three, and know why.
   */
  fun toggleCompare(productId: String) {
    val next = ProductCompare.toggle(_state.value.compareIds, productId)
    if (next == _state.value.compareIds) return
    _state.update { state ->
      state.copy(
        compareIds = next,
        // Closing the tray is the honest answer to removing the last product.
        compareOpen = state.compareOpen && next.isNotEmpty(),
        compareError = null,
      )
    }
    if (next.isEmpty()) clearCompare()
  }

  fun clearCompare() {
    compareCache.clear()
    _state.update {
      it.copy(compareIds = emptySet(), compareOpen = false, compareDetails = emptyList(), compareError = null)
    }
  }

  fun openCompare() {
    if (_state.value.compareIds.isEmpty()) return
    _state.update { it.copy(compareOpen = true) }
    loadCompareDetails()
  }

  fun closeCompare() {
    _state.update { it.copy(compareOpen = false, compareError = null) }
  }

  /**
   * Read the tray's current rows.
   *
   * One detail request per parked product, in parallel, and a failure names the
   * product it belongs to instead of blanking the table: the rows that did load
   * are still real. Details are cached for the session because the same product
   * is commonly compared twice in one visit — and the cache is dropped whenever
   * the tray changes, so it can never outlive the selection it was built for.
   */
  private fun loadCompareDetails() {
    val ids = _state.value.compareIds.toList()
    if (ids.isEmpty()) return
    val cached = compareCache
    if (ids.all { cached.containsKey(it) }) {
      _state.update { state ->
        state.copy(
          compareLoading = false,
          compareDetails = ids.mapNotNull { id -> cached[id] },
          compareError = null,
        )
      }
      return
    }
    _state.update { it.copy(compareLoading = true, compareError = null) }
    viewModelScope.launch {
      val results = ids.map { id -> id to repository.loadProduct(id) }
      val details = mutableListOf<ProductDetail>()
      val failed = mutableListOf<String>()
      for ((id, result) in results) {
        when (result) {
          is AppResult.Success -> {
            compareCache[id] = result.value
            details += result.value
          }
          is AppResult.Failure -> failed += id
        }
      }
      _state.update { state ->
        state.copy(
          compareLoading = false,
          compareDetails = details,
          compareError = if (failed.isEmpty()) null else {
            val name = state.products.firstOrNull { it.id in failed }?.name
              ?: "One product"
            "$name could not be loaded right now. Try again in a moment."
          },
        )
      }
    }
  }

  /**
   * Switch pane. Free: every pane is rendered from state this screen already
   * has.
   *
   * The directory filter is a LOCAL narrowing of the pane being looked at, so
   * it is dropped on the way out: a shopper who typed "ri" in Categories and
   * then opened Brands must not be shown an empty brand list filtered by a term
   * they typed for a different list.
   */
  fun selectTab(tab: CatalogTab) {
    if (_state.value.tab == tab) return
    suggestionJob?.cancel()
    // The panel is a PRODUCTS surface: the directory panes have their own
    // on-device name filter. Hiding it here is what stops a shopper who typed on
    // Products, switched to Brands and switched back from being greeted by a
    // suggestion panel for a term that is no longer in the field.
    _state.update {
      it.copy(tab = tab, directoryFilter = "", suggestionsVisible = false, suggestionsLoading = false)
    }
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
    loadSuggestions(value)
  }

  /**
   * Read cross-entity suggestions for a typed term.
   *
   * Debounced separately from the product list, because the two answers are used
   * differently: suggestions are a typing aid and are cheap to drop, while the
   * list is the result set. A stale answer is DISCARDED by comparing the term the
   * server echoed (`SearchSuggestions.query`, the sanitized term it matched) with
   * what is in the field now — without that guard a slow response for "ri" lands
   * after "rice" and the panel contradicts the list underneath it.
   *
   * A failure sets [CatalogUiState.suggestionsError] and leaves the list alone;
   * it is never allowed to read as "nothing matches".
   */
  fun loadSuggestions(term: String) {
    suggestionJob?.cancel()
    val trimmed = term.trim()
    if (trimmed.length < SUGGESTION_MIN_TERM) {
      _state.update {
        it.copy(
          suggestions = SearchSuggestions.NONE,
          suggestionsLoading = false,
          suggestionsError = null,
          suggestionsVisible = false,
        )
      }
      return
    }
    _state.update { it.copy(suggestionsLoading = true, suggestionsError = null, suggestionsVisible = true) }
    suggestionJob = viewModelScope.launch {
      delay(SUGGESTION_DEBOUNCE_MS)
      when (val result = repository.loadSearchSuggestions(trimmed)) {
        is AppResult.Success -> _state.update { state ->
          val answer = result.value
          val current = state.query.search.trim()
          // The server sanitizes the term (it strips `%`, `_`, quotes and
          // punctuation), so the echo is compared against the sanitized current
          // term rather than the raw one — otherwise every answer would look
          // stale and the panel would never appear.
          if (!SearchSuggestionsMatch.isFor(answer, current)) {
            // A dropped answer must not leave the panel spinning: whatever request
            // is current now owns the loading flag, and if there is none the panel
            // has to come to rest on what it already has.
            return@update state.copy(suggestionsLoading = false)
          }
          state.copy(
            suggestions = answer,
            suggestionsLoading = false,
            suggestionsError = null,
            suggestionsVisible = true,
          )
        }

        is AppResult.Failure -> _state.update { state ->
          state.copy(
            suggestionsLoading = false,
            suggestionsError = result.error.message,
          )
        }
      }
    }
  }

  /** Hide the suggestion panel without clearing the term or the result list. */
  fun dismissSuggestions() {
    suggestionJob?.cancel()
    _state.update { it.copy(suggestionsVisible = false, suggestionsLoading = false) }
  }

  /**
   * Take a BRAND suggestion.
   *
   * The typed term is cleared on the way in: keeping "fortune" as a product
   * search AND as a brand filter would intersect two constraints the shopper only
   * ever meant as one, and can legitimately return nothing. The scope the shopper
   * tapped is the scope that is applied — one state change, one catalogue read.
   */
  fun selectSuggestedBrand(brandId: String, label: String?) {
    searchJob?.cancel()
    suggestionJob?.cancel()
    _state.update { state ->
      state.copy(
        tab = CatalogTab.PRODUCTS,
        query = state.query.copy(search = "", brandId = brandId),
        brandLabel = label ?: state.brands.firstOrNull { brand -> brand.id == brandId }?.name ?: state.brandLabel,
        directoryFilter = "",
        suggestions = SearchSuggestions.NONE,
        suggestionsVisible = false,
        suggestionsLoading = false,
      )
    }
    reload()
  }

  /** Take a CATEGORY suggestion. Same reasoning as [selectSuggestedBrand]. */
  fun selectSuggestedCategory(categoryId: String) {
    searchJob?.cancel()
    suggestionJob?.cancel()
    _state.update { state ->
      state.copy(
        tab = CatalogTab.PRODUCTS,
        query = state.query.copy(search = "", categoryId = categoryId),
        directoryFilter = "",
        suggestions = SearchSuggestions.NONE,
        suggestionsVisible = false,
        suggestionsLoading = false,
      )
    }
    reload()
  }

  /**
   * Take a PRODUCT suggestion: the screen opens the product, this only closes the
   * panel and commits the term to the recent-search history (the shopper meant
   * it — that is what makes the chips useful).
   */
  fun selectSuggestedProduct(productId: String) {
    suggestionJob?.cancel()
    val term = _state.value.query.search.trim()
    if (term.isNotEmpty()) viewModelScope.launch { history.recordSearch(term) }
    _state.update { it.copy(suggestionsVisible = false, suggestionsLoading = false) }
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
    // The IME action COMMITS the term: the result list is now the answer, so the
    // typing aid goes away. Leaving it up would keep a second, narrower answer
    // (six products, four brands) competing with the paginated list underneath.
    suggestionJob?.cancel()
    _state.update { it.copy(suggestionsVisible = false, suggestionsLoading = false) }
    rememberCurrentSearch()
    reload()
  }

  /**
   * Remember the term the shopper actually committed to (the IME action, or a
   * home-screen search handed to this screen). Typing alone is deliberately not
   * recorded: the debounce fires on every prefix, and a history full of `a`,
   * `at`, `att` prefixes is noise, not a shortcut. Blank terms are ignored, and
   * the write is fire-and-forget because a failed history write must never
   * affect the search that is already running.
   */
  private fun rememberCurrentSearch() {
    val term = _state.value.query.search.trim()
    if (term.isEmpty()) return
    viewModelScope.launch { history.recordSearch(term) }
  }

  /**
   * Apply (or clear) the category filter. Tapping a tile in the Categories pane
   * is the same call, and it moves the shopper to the product list so they can
   * see what the filter did — one catalogue, one result set.
   */
  fun selectCategory(categoryId: String?) {
    val changed = _state.value.query.categoryId != categoryId
    suggestionJob?.cancel()
    _state.update {
      it.copy(
        tab = CatalogTab.PRODUCTS,
        query = it.query.copy(categoryId = categoryId),
        suggestionsVisible = false,
        suggestionsLoading = false,
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
   * Brand filtering from either the product rail or the dedicated Brands pane.
   * The name comes from the real taxonomy (or the home deep-link payload), and
   * selecting `null` clears only the brand part of the active server query.
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
   * Clearing a combined scope must be one state update and one catalogue read:
   * [selectCategory]/[selectBrand] each reload on their own, so calling both
   * here would issue two reads and let the first obsolete response race the
   * second. The product pane's category "All" chip clears only that category;
   * callers that mean no category AND no brand can use this method.
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
    _state.update { it.copy(query = CatalogQuery.DEFAULT, brandLabel = null, filterError = null) }
    reload()
  }

  // ------------------------------------------------------------------ filters

  /** Open the bottom-sheet filter UI on the filters that are ALREADY applied. */
  fun openFilters() {
    _state.update { it.copy(filtersOpen = true, filterError = null) }
  }

  fun closeFilters() {
    _state.update { it.copy(filtersOpen = false, filterError = null) }
  }

  /**
   * The draft the sheet should open with: the applied query, not a blank one.
   *
   * Deliberately NOT wired as the sheet's `initialDraft` source in the composable
   * — the screen reads [CatalogUiState.query] and builds the draft from it, so the
   * panel the shopper sees is derived from the same state the list was fetched
   * with rather than from a second read of the ViewModel that could be one
   * recomposition stale.
   */
  fun currentFilterDraft(): CatalogFilterDraft = CatalogFilterDraft.from(_state.value.query)

  /**
   * Apply the sheet.
   *
   * ONE state change and ONE catalogue read: every bound is folded into the query
   * together, because applying them one field at a time would fire a request per
   * field and let an obsolete response race the final one — the same burst that
   * [applyInitialRequest] exists to prevent.
   *
   * A draft the server could not act on is REFUSED with the reason, and nothing
   * is reloaded: the list on screen keeps its honest filter chips rather than
   * silently becoming unfiltered behind a control that looks applied.
   */
  fun applyFilters(draft: CatalogFilterDraft) {
    when (val outcome = draft.applyTo(_state.value.query)) {
      is CatalogFilterOutcome.Refused -> _state.update { it.copy(filterError = outcome.message) }
      is CatalogFilterOutcome.Apply -> {
        val changed = outcome.query != _state.value.query
        _state.update { it.copy(query = outcome.query, filtersOpen = false, filterError = null) }
        // Nothing changed means nothing to re-read: the shopper opened the sheet,
        // looked at it and applied what was already applied.
        if (changed) reload()
      }
    }
  }

  /**
   * The sheet's "Clear all".
   *
   * It clears the FILTERS, not the shopper's place: the search term, the
   * category/brand scope and the sort survive, because "clear filters" on a
   * category page that also throws away the category is a control that costs the
   * shopper their navigation. [clearFilters] — the empty state's button — is the
   * one that resets everything.
   */
  fun clearAllFilters() {
    val next = _state.value.query.withAdvancedFiltersCleared()
    val changed = next != _state.value.query
    _state.update { it.copy(query = next, filterError = null) }
    if (changed) reload()
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
    /**
     * Open already narrowed to the server's offer filter — the home Deals rail's
     * "Shop offers". Folded into the SAME query update as everything else, so a
     * deep link still costs one catalogue read.
     */
    offersOnly: Boolean = false,
  ) {
    val current = _state.value
    val nextQuery = current.query.copy(
      search = search.trim(),
      categoryId = categoryId,
      brandId = brandId,
      offersOnly = offersOnly,
    )
    val nextLabel = if (brandId == null) {
      null
    } else {
      brandLabel ?: current.brands.firstOrNull { brand -> brand.id == brandId }?.name
    }
    if (nextQuery == current.query && nextLabel == current.brandLabel && tab == current.tab) return

    // The pending debounce (if the shopper is typing) belongs to the old query,
    // and so does any suggestion panel still on screen.
    searchJob?.cancel()
    suggestionJob?.cancel()
    _state.update {
      it.copy(
        tab = tab,
        query = nextQuery,
        brandLabel = nextLabel,
        directoryFilter = "",
        suggestionsVisible = false,
        suggestionsLoading = false,
      )
    }
    // A search that arrived with a destination (the home screen's field, a
    // restored tab) is a committed search, so it earns a chip like any other.
    rememberCurrentSearch()
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

    /**
     * Suggestions are a typing aid, so they wait a little longer than the list
     * before spending a request: the shopper is still typing, and a partial
     * prefix would only be replaced by the next keystroke.
     */
    const val SUGGESTION_DEBOUNCE_MS = 220L

    /**
     * The server's own floor (`MOBILE_SEARCH_MIN_TERM`): below it the endpoint
     * reads nothing and answers `searched: false`, so there is no request to make.
     */
    const val SUGGESTION_MIN_TERM = 2

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
