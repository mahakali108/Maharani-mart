package com.maharanitraders.feature.catalog.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyGridState
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.maharanitraders.core.designsystem.components.ChevronRightGlyph
import com.maharanitraders.core.designsystem.components.CloseGlyph
import com.maharanitraders.core.designsystem.components.EmptyState
import com.maharanitraders.core.designsystem.components.ErrorState
import com.maharanitraders.core.designsystem.components.MaharaniSearchBar
import com.maharanitraders.core.designsystem.components.OfflineState
import com.maharanitraders.core.designsystem.components.ProductGridSkeleton
import com.maharanitraders.core.designsystem.components.SortGlyph
import com.maharanitraders.core.designsystem.theme.MaharaniDimens
import com.maharanitraders.core.model.CatalogSort
import com.maharanitraders.feature.catalog.CatalogTab
import com.maharanitraders.feature.catalog.CatalogUiState
import com.maharanitraders.feature.catalog.CatalogViewModel
import com.maharanitraders.feature.catalog.FavoritesSnapshot
import com.maharanitraders.feature.catalog.ui.components.BrandCard
import com.maharanitraders.feature.catalog.ui.components.CatalogTabStrip
import com.maharanitraders.feature.catalog.ui.components.CategoryCard
import com.maharanitraders.feature.catalog.ui.components.DirectoryAllCard
import com.maharanitraders.feature.catalog.ui.components.DirectoryScopeLabel
import com.maharanitraders.feature.catalog.ui.components.ProductGrid

/** Test tags for the catalogue list surface. */
object CatalogScreenTags {
  const val SEARCH_FIELD = "catalog_search_field"
  const val TAB_ROW = "catalog_tab_row"
  const val TAB_PRODUCTS = "catalog_tab_products"
  const val TAB_CATEGORIES = "catalog_tab_categories"
  const val TAB_BRANDS = "catalog_tab_brands"
  const val CATEGORY_CHIPS = "catalog_category_chips"
  const val ALL_CHIP = "catalog_all_chip"
  const val CATEGORY_CHIP = "catalog_category_chip"
  const val SORT_BUTTON = "catalog_sort_button"
  const val IN_STOCK_CHIP = "catalog_in_stock_chip"
  const val BRAND_CHIP = "catalog_brand_chip"
  const val RESULT_COUNT = "catalog_result_count"
  const val LOADING_MORE = "catalog_loading_more"
  const val END_OF_LIST = "catalog_end_of_list"
  const val CLEAR_FILTERS = "catalog_clear_filters"

  /** Recent search chips: remembered terms, tappable and clearable. */
  const val RECENT_SEARCHES = "catalog_recent_searches"
  const val RECENT_SEARCH_CHIP = "catalog_recent_search_chip"
  const val CLEAR_RECENT_SEARCHES = "catalog_clear_recent_searches"

  /** The directory panes' local (on-device) filter field. */
  const val DIRECTORY_FILTER = "catalog_directory_filter"
  const val DIRECTORY_GRID = "catalog_directory_grid"
  const val DIRECTORY_SCOPE = "catalog_directory_scope"
}

/**
 * The Catalogue — the app's one discovery surface.
 *
 * Three panes, one implementation:
 *  - **Products**: the paginated, server-filtered, server-priced list;
 *  - **Categories**: the shop's real published taxonomy as a selectable grid;
 *  - **Brands**: the real brand list as a selectable grid.
 *
 * Tapping a category or a brand tile applies that filter and switches to the
 * product list, so the taxonomy and the products are two views of the same
 * catalogue rather than two disconnected directories. Nothing is fetched twice:
 * the taxonomy is read once (both endpoints in parallel) and the product list is
 * fetched once per filter change, exactly as before.
 *
 * The grid appends batches as the shopper nears the end. What it never does is
 * invent the end: `hasMore` and the cursor both come from the server, and a
 * cursor the server repeats terminates the list with an explicit "You have seen
 * everything" line rather than an endless spinner.
 */
@Composable
fun CatalogScreen(
  initialSearch: String = "",
  initialCategoryId: String? = null,
  initialBrandId: String? = null,
  initialBrandLabel: String? = null,
  /** Opened on this pane. The Categories/Brands deep links land on their own tab. */
  initialTab: CatalogTab = CatalogTab.PRODUCTS,
  onOpenProduct: (productId: String) -> Unit,
  /**
   * Quick add to the cart from a card, `(packId, quantity)`. The shell passes
   * the real cart action for a retailer session and leaves it null otherwise, so
   * the cards never offer an action this account does not have.
   */
  onQuickAddToCart: ((String, Int) -> Unit)? = null,
  /** The pack whose add is in flight, so one card shows a spinner and no more. */
  quickAddPackId: String? = null,
  /**
   * The cart's own last failure, when a quick add did not succeed. The cart is
   * owned by the shell, so the message arrives as data and is reported by this
   * screen's snackbar — a failed add that said nothing would look like a tap
   * that did nothing.
   */
  quickAddMessage: String? = null,
  onQuickAddMessageShown: () -> Unit = {},
  modifier: Modifier = Modifier,
  viewModel: CatalogViewModel = hiltViewModel(),
) {
  val state by viewModel.state.collectAsStateWithLifecycle()
  val recentSearches by viewModel.recentSearches.collectAsStateWithLifecycle()

  // Deep links from the home screen and the shell arrive as arguments, not as
  // state the ViewModel guesses at. They are applied ONCE per distinct request:
  // a configuration change recomposes this effect with the SAME key and does
  // nothing, while re-opening the catalogue with a different search (the
  // navigation entry is reused, so `rememberSaveable` survives) applies the new
  // one instead of silently showing the previous query's results.
  //
  // The whole request — search, category, brand and pane — goes through ONE
  // ViewModel call, so a deep link costs one catalogue read instead of one per
  // field (see `applyInitialRequest`).
  var appliedInitial by rememberSaveable { mutableStateOf<String?>(null) }
  val requestKey = "$initialSearch|$initialCategoryId|$initialBrandId|${initialTab.name}"
  LaunchedEffect(requestKey) {
    if (appliedInitial == requestKey) return@LaunchedEffect
    appliedInitial = requestKey
    viewModel.applyInitialRequest(
      search = initialSearch,
      categoryId = initialCategoryId,
      brandId = initialBrandId,
      brandLabel = initialBrandLabel,
      tab = initialTab,
    )
  }

  val favorites by viewModel.favoriteState.collectAsStateWithLifecycle()
  val snackbarHostState = remember { SnackbarHostState() }

  LaunchedEffect(state.actionMessage) {
    val message = state.actionMessage
    if (message != null) {
      snackbarHostState.showSnackbar(message)
      viewModel.consumeActionMessage()
    }
  }

  // A failed quick add is reported the same way a failed favourite toggle is:
  // once, on the screen the shopper is looking at, and then consumed.
  LaunchedEffect(quickAddMessage) {
    val message = quickAddMessage
    if (message != null) {
      snackbarHostState.showSnackbar(message)
      onQuickAddMessageShown()
    }
  }

  Scaffold(
    snackbarHost = { SnackbarHost(snackbarHostState) },
    modifier = modifier,
  ) { padding ->
    CatalogContent(
      state = state,
      favorites = favorites,
      onSearchChange = viewModel::onSearchChange,
      onSearchSubmit = viewModel::submitSearch,
      recentSearches = recentSearches,
      onUseRecentSearch = viewModel::useRecentSearch,
      onClearRecentSearches = viewModel::clearRecentSearches,
      onSelectTab = viewModel::selectTab,
      onDirectoryFilterChange = viewModel::onDirectoryFilterChange,
      onRetryDirectories = viewModel::retryDirectories,
      onSelectCategory = viewModel::selectCategory,
      onSelectBrand = { brandId, label -> viewModel.selectBrand(brandId, label) },
      onSelectSort = viewModel::selectSort,
      onToggleInStock = viewModel::toggleInStockOnly,
      onClearBrand = { viewModel.selectBrand(null) },
      onClearScope = viewModel::clearScope,
      onClearFilters = viewModel::clearFilters,
      onRetry = viewModel::retry,
      onLoadMore = viewModel::loadMore,
      onOpenProduct = onOpenProduct,
      onToggleFavorite = viewModel::toggleFavorite,
      onQuickAddToCart = onQuickAddToCart,
      quickAddPackId = quickAddPackId,
      modifier = Modifier.padding(padding),
    )
  }
}

@Composable
fun CatalogContent(
  state: CatalogUiState,
  favorites: FavoritesSnapshot = FavoritesSnapshot(),
  onSearchChange: (String) -> Unit,
  /** The keyboard's search action: search immediately instead of debouncing. */
  onSearchSubmit: () -> Unit = {},
  /** Terms this device remembered, newest first. Never server data. */
  recentSearches: List<String> = emptyList(),
  onUseRecentSearch: (String) -> Unit = {},
  onClearRecentSearches: () -> Unit = {},
  onSelectTab: (CatalogTab) -> Unit = {},
  onDirectoryFilterChange: (String) -> Unit = {},
  onRetryDirectories: () -> Unit = {},
  onSelectCategory: (String?) -> Unit,
  onSelectBrand: (String, String?) -> Unit = { _, _ -> },
  onClearScope: () -> Unit = {},
  onSelectSort: (CatalogSort) -> Unit,
  onToggleInStock: () -> Unit,
  onClearBrand: () -> Unit,
  onClearFilters: () -> Unit,
  onRetry: () -> Unit,
  onLoadMore: () -> Unit,
  onOpenProduct: (String) -> Unit,
  onToggleFavorite: ((String) -> Unit)? = null,
  onQuickAddToCart: ((String, Int) -> Unit)? = null,
  quickAddPackId: String? = null,
  modifier: Modifier = Modifier,
) {
  // The grid's scroll position lives HERE, not inside the Products branch: the
  // shopper who dips into Categories and comes back must land where they left
  // off, not at the top of the list.
  val gridState = rememberLazyGridState()

  Column(modifier = modifier.fillMaxSize()) {
    CatalogHeader(
      state = state,
      onSearchChange = onSearchChange,
      onSearchSubmit = onSearchSubmit,
      onDirectoryFilterChange = onDirectoryFilterChange,
      onSelectTab = onSelectTab,
      recentSearches = recentSearches,
      onUseRecentSearch = onUseRecentSearch,
      onClearRecentSearches = onClearRecentSearches,
    )

    when (state.tab) {
      CatalogTab.PRODUCTS -> CatalogProductsPane(
        state = state,
        favorites = favorites,
        onSelectCategory = onSelectCategory,
        onSelectSort = onSelectSort,
        onToggleInStock = onToggleInStock,
        onClearBrand = onClearBrand,
        onClearScope = onClearScope,
        onClearFilters = onClearFilters,
        onRetry = onRetry,
        onLoadMore = onLoadMore,
        onOpenProduct = onOpenProduct,
        onToggleFavorite = onToggleFavorite,
        onQuickAddToCart = onQuickAddToCart,
        quickAddPackId = quickAddPackId,
        gridState = gridState,
      )

      CatalogTab.CATEGORIES -> CatalogDirectoryPane(
        state = state,
        tab = CatalogTab.CATEGORIES,
        onDirectoryFilterChange = onDirectoryFilterChange,
        onRetryDirectories = onRetryDirectories,
        onSelectCategory = onSelectCategory,
        onSelectBrand = onSelectBrand,
        onClearBrand = onClearBrand,
      )

      CatalogTab.BRANDS -> CatalogDirectoryPane(
        state = state,
        tab = CatalogTab.BRANDS,
        onDirectoryFilterChange = onDirectoryFilterChange,
        onRetryDirectories = onRetryDirectories,
        onSelectCategory = onSelectCategory,
        onSelectBrand = onSelectBrand,
        onClearBrand = onClearBrand,
      )
    }
  }
}

/**
 * The sticky header: the field for the current pane, then the pane switch.
 *
 * The field means exactly what its placeholder says — a server product search on
 * the Products pane, and an on-device filter over the names the server already
 * sent on the directory panes. Both are the same component, so the two never
 * look or behave differently apart from that one, stated difference.
 *
 * The header is white with a hairline divider rather than a coloured block: the
 * brand colour belongs to the app bar above it, and two saturated bands stacked
 * on top of each other is what made the old screen read as "blue everywhere".
 */
@Composable
private fun CatalogHeader(
  state: CatalogUiState,
  onSearchChange: (String) -> Unit,
  onSearchSubmit: () -> Unit,
  onDirectoryFilterChange: (String) -> Unit,
  onSelectTab: (CatalogTab) -> Unit,
  recentSearches: List<String> = emptyList(),
  onUseRecentSearch: (String) -> Unit = {},
  onClearRecentSearches: () -> Unit = {},
) {
  Surface(
    color = MaterialTheme.colorScheme.surface,
    modifier = Modifier.fillMaxWidth(),
  ) {
    Column {
      Column(
        modifier = Modifier.padding(
          start = MaharaniDimens.pageGutter,
          end = MaharaniDimens.pageGutter,
          top = MaharaniDimens.spaceSm,
          bottom = MaharaniDimens.spaceMd,
        ),
        verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceMd),
      ) {
        if (state.tab == CatalogTab.PRODUCTS) {
          MaharaniSearchBar(
            value = state.query.search,
            onValueChange = onSearchChange,
            onSubmit = onSearchSubmit,
            loading = state.loading && state.products.isNotEmpty(),
            testTag = CatalogScreenTags.SEARCH_FIELD,
          )
          // The chips appear only while the field is EMPTY: a shopper who is
          // mid-word does not need nine other searches crowding the input, and
          // one who has just arrived gets their repeat orders one tap away.
          if (state.query.search.isBlank() && recentSearches.isNotEmpty()) {
            RecentSearchChips(
              terms = recentSearches,
              onSelect = onUseRecentSearch,
              onClear = onClearRecentSearches,
            )
          }
        } else {
          MaharaniSearchBar(
            value = state.directoryFilter,
            onValueChange = onDirectoryFilterChange,
            onSubmit = { },
            placeholder = if (state.tab == CatalogTab.BRANDS) {
              "Filter brands"
            } else {
              "Filter categories"
            },
            loading = state.directoryLoading,
            testTag = CatalogScreenTags.DIRECTORY_FILTER,
          )
        }

        CatalogTabStrip(selected = state.tab, onSelect = onSelectTab)
      }
      HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
    }
  }
}

/**
 * The remembered search terms, as tappable chips with one clear action.
 *
 * These are the ONLY thing on the catalogue that did not come from the server:
 * they are terms this device remembers because the shopper typed them (see
 * `LocalHistoryStore`). A chip runs the same query path as typing the words, so
 * it can never produce a different list, and the whole row is dropped the moment
 * the account signs out.
 */
@Composable
private fun RecentSearchChips(
  terms: List<String>,
  onSelect: (String) -> Unit,
  onClear: () -> Unit,
  modifier: Modifier = Modifier,
) {
  Column(
    modifier = modifier
      .fillMaxWidth()
      .testTag(CatalogScreenTags.RECENT_SEARCHES),
    verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceXs),
  ) {
    Row(
      modifier = Modifier.fillMaxWidth(),
      verticalAlignment = Alignment.CenterVertically,
      horizontalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceSm),
    ) {
      Text(
        text = "Recent searches",
        style = MaterialTheme.typography.labelSmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.weight(1f),
      )
      TextButton(
        onClick = onClear,
        modifier = Modifier
          .heightIn(min = MaharaniDimens.touchTarget)
          .testTag(CatalogScreenTags.CLEAR_RECENT_SEARCHES),
      ) {
        Text("Clear")
      }
    }
    LazyRow(
      modifier = Modifier.fillMaxWidth(),
      horizontalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceSm),
    ) {
      items(terms, key = { it.lowercase() }) { term ->
        FilterChip(
          selected = false,
          onClick = { onSelect(term) },
          label = { Text(term, maxLines = 1, overflow = TextOverflow.Ellipsis) },
          modifier = Modifier.testTag(CatalogScreenTags.RECENT_SEARCH_CHIP),
          colors = catalogChipColors(),
        )
      }
    }
  }
}

/**
 * The Products pane: the scope chips, the sort/stock controls, and the
 * paginated grid.
 *
 * The scope row is the answer to "where am I": whichever category or brand the
 * shopper tapped is shown as a removable chip with the brand's own name, so the
 * filtered list can never look like an unfiltered one. "All" is the same scope
 * control with nothing selected.
 */
@Composable
private fun CatalogProductsPane(
  state: CatalogUiState,
  favorites: FavoritesSnapshot,
  onSelectCategory: (String?) -> Unit,
  onSelectSort: (CatalogSort) -> Unit,
  onToggleInStock: () -> Unit,
  onClearBrand: () -> Unit,
  onClearScope: () -> Unit,
  onClearFilters: () -> Unit,
  onRetry: () -> Unit,
  onLoadMore: () -> Unit,
  onOpenProduct: (String) -> Unit,
  onToggleFavorite: ((String) -> Unit)?,
  onQuickAddToCart: ((String, Int) -> Unit)?,
  quickAddPackId: String?,
  gridState: LazyGridState,
) {
  // The controls and the count live INSIDE the scroller, in the grid's header
  // slot, so the cards get the whole screen once the shopper scrolls. They are
  // still present in every non-list state below, because a failed or empty list
  // must never also remove the filters that could fix it.
  val controls: @Composable () -> Unit = {
    Column(modifier = Modifier.fillMaxWidth()) {
      CatalogScopeBar(
        state = state,
        onSelectCategory = onSelectCategory,
        onClearBrand = onClearBrand,
        onClearScope = onClearScope,
        onSelectSort = onSelectSort,
        onToggleInStock = onToggleInStock,
      )
      ResultSummary(
        state = state,
        onClearFilters = onClearFilters,
        modifier = Modifier.padding(
          horizontal = MaharaniDimens.pageGutter,
          vertical = MaharaniDimens.spaceSm,
        ),
      )
    }
  }

  when {
    // First load with nothing on screen yet: the skeleton IS the content, but
    // the controls stay so the shopper is not trapped in a query they did not
    // want while it loads.
    state.products.isEmpty() && state.loading && state.errorMessage == null -> Column(
      modifier = Modifier.fillMaxSize(),
    ) {
      controls()
      ProductGridSkeleton(
        columns = 2,
        rows = 3,
        modifier = Modifier.padding(
          horizontal = MaharaniDimens.pageGutter,
          vertical = MaharaniDimens.spaceSm,
        ),
      )
    }

    state.products.isEmpty() && state.errorMessage != null -> Column(
      modifier = Modifier.fillMaxSize(),
    ) {
      controls()
      if (state.offline) {
        OfflineState(onRetry = onRetry)
      } else {
        ErrorState(
          message = state.errorMessage.orEmpty(),
          retryable = state.retryable,
          onRetry = onRetry,
        )
      }
    }

    // Empty is not an error, and a filtered empty list names the filter that
    // emptied it instead of blaming "the filters" in general.
    state.products.isEmpty() -> Column(modifier = Modifier.fillMaxSize()) {
      controls()
      val scope = state.selectedCategoryName ?: state.brandLabel ?: state.selectedBrand?.name
      if (scope != null) {
        EmptyState(
          title = "Nothing in $scope yet",
          message = "This ${if (state.selectedCategoryName != null) "category" else "brand"} " +
            "has no products matching the current search. Show everything to keep browsing.",
          actionLabel = "Show all products",
          onAction = onClearScope,
        )
      } else {
        EmptyState(
          title = "No products found",
          message = "Nothing matches these filters. Try a different search term, or clear the " +
            "filters to see the whole catalogue.",
          actionLabel = "Clear filters",
          onAction = onClearFilters,
        )
      }
    }

    else -> ProductGrid(
      products = state.products,
      onOpenProduct = onOpenProduct,
      state = gridState,
      modifier = Modifier.fillMaxSize(),
      isFavorite = { product -> favorites.isFavorite(product.id, product.isFavorite) },
      isFavoritePending = { product -> favorites.isPending(product.id) },
      onToggleFavorite = onToggleFavorite,
      onQuickAddToCart = onQuickAddToCart,
      quickAddPackId = quickAddPackId,
      header = {
        item(span = { GridItemSpan(maxLineSpan) }) { controls() }
      },
      footer = {
        // The item ALWAYS exists: it is the sentinel that asks for the next
        // batch when the shopper reaches it, and hiding it would stop the list
        // from ever continuing. It draws nothing until it has something to say
        // (a continuation in flight, a continuation that failed, or the end of
        // the list), so there is no blank strip under the last row either.
        item(span = { GridItemSpan(maxLineSpan) }) {
          ContinuationFooter(state = state, onLoadMore = onLoadMore, onRetry = onRetry)
        }
      },
    )
  }
}

/**
 * The scope chips: All | Categories | Brands, each removable.
 *
 * Every chip sets a real server filter (or clears one) through the same
 * callbacks the directory tiles use, so there is no control here that only
 * looks interactive.
 */
@Composable
private fun CatalogScopeBar(
  state: CatalogUiState,
  onSelectCategory: (String?) -> Unit,
  onClearBrand: () -> Unit,
  onClearScope: () -> Unit,
  onSelectSort: (CatalogSort) -> Unit,
  onToggleInStock: () -> Unit,
) {
  Column(
    modifier = Modifier
      .fillMaxWidth()
      .padding(
        start = MaharaniDimens.pageGutter,
        end = MaharaniDimens.pageGutter,
        top = MaharaniDimens.spaceSm,
      ),
    verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceSm),
  ) {
    // Row one: the scope, and nothing else. It scrolls because the shop's real
    // taxonomy can be long, and the selected chip is the same control that
    // clears it — no separate "remove filter" affordance to hunt for.
    LazyRow(
      modifier = Modifier
        .fillMaxWidth()
        .testTag(CatalogScreenTags.CATEGORY_CHIPS),
      horizontalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceSm),
      verticalAlignment = Alignment.CenterVertically,
    ) {
      item(key = "all") {
        FilterChip(
          selected = state.query.categoryId == null && state.query.brandId == null,
          onClick = onClearScope,
          label = { Text("All") },
          modifier = Modifier.testTag(CatalogScreenTags.ALL_CHIP),
          colors = catalogChipColors(),
        )
      }

      // One chip per category the SERVER published, in the server's order. The
      // list is already in memory — the directory panes and this row are two
      // views of one read — so this costs no request at all.
      items(state.categories, key = { "category-${it.id}" }) { category ->
        val selected = state.query.categoryId == category.id
        FilterChip(
          selected = selected,
          onClick = {
            // Tapping the applied category clears it; tapping another switches.
            // Both are one real query change.
            onSelectCategory(if (selected) null else category.id)
          },
          label = {
            Text(category.name, maxLines = 1, overflow = TextOverflow.Ellipsis)
          },
          trailingIcon = if (selected) {
            { CloseGlyph(modifier = Modifier.size(16.dp)) }
          } else {
            null
          },
          modifier = Modifier.testTag(CatalogScreenTags.CATEGORY_CHIP),
          colors = catalogChipColors(),
        )
      }

      // A brand scope arrives from the Brands pane or the home brand rail. It
      // carries its own name, because with a long category row the brand chip
      // can be scrolled off-screen and the summary line must still be truthful.
      val brandLabel = state.brandLabel ?: state.selectedBrand?.name
      if (state.query.brandId != null && brandLabel != null) {
        item(key = "brand-${state.query.brandId}") {
          FilterChip(
            selected = true,
            onClick = onClearBrand,
            label = { Text(brandLabel, maxLines = 1, overflow = TextOverflow.Ellipsis) },
            trailingIcon = { CloseGlyph(modifier = Modifier.size(16.dp)) },
            modifier = Modifier.testTag(CatalogScreenTags.BRAND_CHIP),
            colors = catalogChipColors(),
          )
        }
      }
    }

    // Row two: the controls that are not scope. Sort names the order it is using
    // (never a generic "Sort" that hides the state), and the in-stock switch is
    // filled when it is on.
    Row(
      modifier = Modifier.fillMaxWidth(),
      verticalAlignment = Alignment.CenterVertically,
      horizontalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceSm),
    ) {
      SortMenu(
        current = state.query.sort,
        onSelect = onSelectSort,
        modifier = Modifier.weight(1f, fill = false),
      )
      FilterChip(
        selected = state.query.inStockOnly,
        onClick = onToggleInStock,
        label = { Text("In stock") },
        modifier = Modifier.testTag(CatalogScreenTags.IN_STOCK_CHIP),
        colors = catalogChipColors(),
      )
    }
  }
}

/** One chip treatment for the whole screen: brand red selected, neutral track. */
@Composable
private fun catalogChipColors() = FilterChipDefaults.filterChipColors(
  containerColor = MaterialTheme.colorScheme.surface,
  labelColor = MaterialTheme.colorScheme.onSurfaceVariant,
  iconColor = MaterialTheme.colorScheme.onSurfaceVariant,
  selectedContainerColor = MaterialTheme.colorScheme.primary,
  selectedLabelColor = MaterialTheme.colorScheme.onPrimary,
  selectedLeadingIconColor = MaterialTheme.colorScheme.onPrimary,
  selectedTrailingIconColor = MaterialTheme.colorScheme.onPrimary,
)

/**
 * The Categories and Brands panes: one directory, two taxonomies.
 *
 * They share this implementation deliberately — the same grid, the same
 * loading/error/empty/no-match states, the same selection rule — so the two
 * panes cannot drift apart in behaviour, and the applied filter is always
 * visible on the pane the shopper is standing on.
 */
@Composable
private fun CatalogDirectoryPane(
  state: CatalogUiState,
  tab: CatalogTab,
  onDirectoryFilterChange: (String) -> Unit,
  onRetryDirectories: () -> Unit,
  onSelectCategory: (String?) -> Unit,
  onSelectBrand: (String, String?) -> Unit,
  onClearBrand: () -> Unit,
) {
  val showingCategories = tab == CatalogTab.CATEGORIES
  val categories = state.visibleCategories
  val brands = state.visibleBrands
  val publishedCount = if (showingCategories) state.categories.size else state.brands.size

  // Each pane reads its OWN half of the taxonomy read: one endpoint's failure
  // never puts an error on the pane the other endpoint loaded.
  val paneLoading = if (showingCategories) state.categoriesLoading else state.brandsLoading
  val paneLoaded = if (showingCategories) state.categoriesLoaded else state.brandsLoaded
  val paneError = if (showingCategories) state.categoriesError else state.brandsError
  val paneOffline = if (showingCategories) state.categoriesOffline else state.brandsOffline
  val paneEmpty = if (showingCategories) state.categoriesEmpty else state.brandsEmpty
  val paneNoMatch = if (showingCategories) state.categoriesNoMatch else state.brandsNoMatch

  when {
    paneLoading && !paneLoaded -> Box(
      modifier = Modifier
        .fillMaxSize()
        .padding(MaharaniDimens.pageGutter),
    ) { ProductGridSkeleton(columns = 2, rows = 3) }

    paneError != null && !paneEmpty -> if (paneOffline) {
      OfflineState(onRetry = onRetryDirectories)
    } else {
      ErrorState(
        message = paneError,
        retryable = true,
        onRetry = onRetryDirectories,
      )
    }

    paneEmpty -> EmptyState(
      title = if (showingCategories) "No categories yet" else "No brands yet",
      message = "The shop's taxonomy has not been published yet. Try again shortly.",
      actionLabel = "Try again",
      onAction = onRetryDirectories,
    )

    paneNoMatch -> EmptyState(
      title = "No match",
      message = "Nothing here is called \u201C${state.directoryFilter.trim()}\u201D. " +
        "Clear the filter to see everything the shop publishes.",
      actionLabel = "Clear filter",
      onAction = { onDirectoryFilterChange("") },
    )

    else -> LazyVerticalGrid(
      columns = GridCells.Adaptive(minSize = 158.dp),
      modifier = Modifier
        .fillMaxSize()
        .testTag(CatalogScreenTags.DIRECTORY_GRID),
      contentPadding = PaddingValues(
        start = MaharaniDimens.pageGutter,
        end = MaharaniDimens.pageGutter,
        top = MaharaniDimens.spaceSm,
        bottom = MaharaniDimens.spaceLg,
      ),
      horizontalArrangement = Arrangement.spacedBy(MaharaniDimens.cardGap),
      verticalArrangement = Arrangement.spacedBy(MaharaniDimens.cardGap),
    ) {
      item(span = { GridItemSpan(maxLineSpan) }) {
        Column(
          verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceXxs),
          modifier = Modifier
            .fillMaxWidth()
            .padding(bottom = MaharaniDimens.spaceXxs)
            .testTag(CatalogScreenTags.DIRECTORY_SCOPE),
        ) {
          DirectoryScopeLabel(
            text = if (showingCategories) {
              "$publishedCount categories published"
            } else {
              "$publishedCount brands published"
            },
          )
          DirectoryScopeLabel(
            text = "Tap a ${if (showingCategories) "category" else "brand"} to filter the catalogue.",
          )
        }
      }

      item {
        // "All" clears the scope THIS pane controls — the other pane's filter is
        // left alone, because a shopper who came to Brands to choose a brand
        // should not lose the category they were browsing.
        val allSelected = if (showingCategories) {
          state.query.categoryId == null
        } else {
          state.query.brandId == null
        }
        DirectoryAllCard(
          selected = allSelected,
          onClick = {
            if (showingCategories) onSelectCategory(null) else onClearBrand()
          },
          // A real catalogue total, and only when nothing is filtered: with a
          // scope applied this number would describe the filtered list, not the
          // shop.
          totalCount = state.resultCount.takeIf { allSelected },
        )
      }

      if (showingCategories) {
        items(categories, key = { it.id }) { category ->
          CategoryCard(
            category = category,
            selected = state.query.categoryId == category.id,
            onClick = { onSelectCategory(category.id) },
          )
        }
      } else {
        items(brands, key = { it.id }) { brand ->
          BrandCard(
            brand = brand,
            selected = state.query.brandId == brand.id,
            onClick = { onSelectBrand(brand.id, brand.name) },
          )
        }
      }
    }
  }
}

@Composable
private fun SortMenu(
  current: CatalogSort,
  onSelect: (CatalogSort) -> Unit,
  modifier: Modifier = Modifier,
) {
  var expanded by remember { mutableStateOf(false) }

  Box(modifier = modifier) {
    Surface(
      onClick = { expanded = true },
      shape = RoundedCornerShape(MaharaniDimens.radiusPill),
      color = MaterialTheme.colorScheme.surface,
      border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
      modifier = Modifier
        .heightIn(min = 40.dp)
        .testTag(CatalogScreenTags.SORT_BUTTON),
    ) {
      Row(
        modifier = Modifier.padding(horizontal = 12.dp, vertical = 9.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
      ) {
        SortGlyph(
          modifier = Modifier.size(16.dp),
          tint = MaterialTheme.colorScheme.primary,
        )
        Text(
          text = current.label,
          style = MaterialTheme.typography.labelLarge,
          color = MaterialTheme.colorScheme.onSurface,
          maxLines = 1,
          overflow = TextOverflow.Ellipsis,
        )
        // The stock glyph set has no downward chevron; the right chevron rotated
        // a quarter turn is the same mark, so the control reads as a menu
        // without adding an icon to the APK.
        ChevronRightGlyph(
          modifier = Modifier
            .size(14.dp)
            .rotate(90f),
          tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
      }
    }
    DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
      CatalogSort.entries.forEach { sort ->
        DropdownMenuItem(
          text = { Text(sort.label) },
          onClick = {
            expanded = false
            onSelect(sort)
          },
        )
      }
    }
  }
}

/**
 * "N products", plus the two honest disclosures the catalogue service makes:
 * a capped working set, and the active filter scope.
 */
@Composable
private fun ResultSummary(
  state: CatalogUiState,
  onClearFilters: () -> Unit,
  modifier: Modifier = Modifier,
) {
  val scope = listOfNotNull(state.selectedCategoryName, state.brandLabel ?: state.selectedBrand?.name)
    .joinToString(" · ")
  val filtersActive = state.query.search.isNotBlank() ||
    state.query.categoryId != null ||
    state.query.brandId != null ||
    state.query.inStockOnly ||
    state.query.sort != CatalogSort.RECOMMENDED

  Row(
    modifier = modifier.fillMaxWidth(),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.SpaceBetween,
  ) {
    Column(modifier = Modifier.weight(1f)) {
      // The header is a STATE report, not a spinner. "Loading products…" used to
      // be the fallback whenever the count was absent — which is also true after
      // a FAILED load and on the second and later batches, so a list that had
      // stopped loading (or had never started) still said it was loading.
      val count = state.resultCount
      val loading = state.loading || state.loadingMore
      Text(
        text = when {
          loading -> "Loading products…"
          state.errorMessage != null -> "Products unavailable"
          count == null -> "Products"
          count == 1 -> "1 product"
          else -> "$count products"
        },
        style = MaterialTheme.typography.labelLarge,
        fontWeight = FontWeight.SemiBold,
        color = MaterialTheme.colorScheme.onBackground,
        modifier = Modifier.testTag(CatalogScreenTags.RESULT_COUNT),
      )
      if (state.resultCapped) {
        // The service caps a derived-price or in-stock working set. Saying so is
        // the difference between "240 products" and "up to 240 shown".
        Text(
          text = "Showing the first matches only — narrow the filters to see more.",
          style = MaterialTheme.typography.labelSmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
      }
      if (scope.isNotEmpty()) {
        // The scope is repeated OUTSIDE the chip row as well: a long "All"…
        // chip row scrolls, and a filter that scrolls out of sight reads as no
        // filter at all.
        Text(
          text = "Showing $scope",
          style = MaterialTheme.typography.labelSmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
          maxLines = 1,
          overflow = TextOverflow.Ellipsis,
        )
      }
    }

    if (filtersActive) {
      TextButton(
        onClick = onClearFilters,
        modifier = Modifier.testTag(CatalogScreenTags.CLEAR_FILTERS),
      ) { Text("Clear") }
    }
  }
}

@Composable
private fun ContinuationFooter(
  state: CatalogUiState,
  onLoadMore: () -> Unit,
  onRetry: () -> Unit,
  modifier: Modifier = Modifier,
) {
  // Auto-continue as soon as the footer is visible, but NEVER while a
  // continuation is failing: retrying a failing cursor automatically would turn
  // one dead endpoint into an endless request loop. After a failure the shopper
  // gets the explicit retry below.
  if (state.hasMore && state.errorMessage == null) {
    LaunchedEffect(state.nextCursor) { onLoadMore() }
  }

  // Nothing to draw while the next batch is on its way for the first time: the
  // sentinel above has already asked for it.
  val visible = state.loadingMore || state.errorMessage != null || !state.hasMore
  if (!visible) return

  Surface(
    color = MaterialTheme.colorScheme.background,
    shape = RoundedCornerShape(0.dp),
    modifier = modifier
      .fillMaxWidth()
      .heightIn(min = 72.dp),
  ) {
    Row(
      modifier = Modifier
        .fillMaxWidth()
        .padding(vertical = MaharaniDimens.spaceLg),
      verticalAlignment = Alignment.CenterVertically,
      horizontalArrangement = Arrangement.Center,
    ) {
      when {
        state.loadingMore -> {
          CircularProgressIndicator(
            modifier = Modifier
              .padding(end = MaharaniDimens.spaceSm)
              .size(18.dp),
            strokeWidth = 2.dp,
          )
          Text(
            text = "Loading more products…",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.testTag(CatalogScreenTags.LOADING_MORE),
          )
        }

        // A continuation that failed retries the CONTINUATION (the same
        // cursor), not the whole list: the rows already read stay on screen and
        // the shopper keeps their place. The full-list retry is the error
        // surface shown when there is nothing on screen yet.
        state.errorMessage != null -> TextButton(
          onClick = { if (state.hasMore && state.nextCursor != null) onLoadMore() else onRetry() },
          modifier = Modifier.testTag(CatalogScreenTags.LOADING_MORE),
        ) {
          Text(if (state.offline) "Back online? Load more" else "Try loading more again")
        }

        // Reached only when the server said there is no next batch (or repeated
        // its cursor). An explicit end beats an endless spinner.
        else -> Text(

          text = "You have seen every product in this list.",
          style = MaterialTheme.typography.bodySmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
          modifier = Modifier.testTag(CatalogScreenTags.END_OF_LIST),
        )
      }
    }
  }
}
