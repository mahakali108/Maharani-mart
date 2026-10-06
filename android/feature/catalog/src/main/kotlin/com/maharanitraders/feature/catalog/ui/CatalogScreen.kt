package com.maharanitraders.feature.catalog.ui

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
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
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
  const val SORT_BUTTON = "catalog_sort_button"
  const val IN_STOCK_CHIP = "catalog_in_stock_chip"
  const val BRAND_CHIP = "catalog_brand_chip"
  const val RESULT_COUNT = "catalog_result_count"
  const val LOADING_MORE = "catalog_loading_more"
  const val END_OF_LIST = "catalog_end_of_list"
  const val CLEAR_FILTERS = "catalog_clear_filters"

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
  modifier: Modifier = Modifier,
  viewModel: CatalogViewModel = hiltViewModel(),
) {
  val state by viewModel.state.collectAsStateWithLifecycle()

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

  Scaffold(
    snackbarHost = { SnackbarHost(snackbarHostState) },
    modifier = modifier,
  ) { padding ->
    CatalogContent(
      state = state,
      favorites = favorites,
      onSearchChange = viewModel::onSearchChange,
      onSelectTab = viewModel::selectTab,
      onDirectoryFilterChange = viewModel::onDirectoryFilterChange,
      onRetryDirectories = viewModel::retryDirectories,
      onSelectCategory = viewModel::selectCategory,
      onSelectBrand = { brandId, label -> viewModel.selectBrand(brandId, label) },
      onSelectSort = viewModel::selectSort,
      onToggleInStock = viewModel::toggleInStockOnly,
      onClearBrand = { viewModel.selectBrand(null) },
      onClearFilters = viewModel::clearFilters,
      onRetry = viewModel::retry,
      onLoadMore = viewModel::loadMore,
      onOpenProduct = onOpenProduct,
      onToggleFavorite = viewModel::toggleFavorite,
      modifier = Modifier.padding(padding),
    )
  }
}

@Composable
fun CatalogContent(
  state: CatalogUiState,
  favorites: FavoritesSnapshot = FavoritesSnapshot(),
  onSearchChange: (String) -> Unit,
  onSelectTab: (CatalogTab) -> Unit = {},
  onDirectoryFilterChange: (String) -> Unit = {},
  onRetryDirectories: () -> Unit = {},
  onSelectCategory: (String?) -> Unit,
  onSelectBrand: (String, String?) -> Unit = { _, _ -> },
  onSelectSort: (CatalogSort) -> Unit,
  onToggleInStock: () -> Unit,
  onClearBrand: () -> Unit,
  onClearFilters: () -> Unit,
  onRetry: () -> Unit,
  onLoadMore: () -> Unit,
  onOpenProduct: (String) -> Unit,
  onToggleFavorite: ((String) -> Unit)? = null,
  modifier: Modifier = Modifier,
) {
  Column(modifier = modifier.fillMaxSize()) {
    CatalogHeader(
      state = state,
      onSearchChange = onSearchChange,
      onDirectoryFilterChange = onDirectoryFilterChange,
      onSelectTab = onSelectTab,
    )

    when (state.tab) {
      CatalogTab.PRODUCTS -> CatalogProductsPane(
        state = state,
        favorites = favorites,
        onSelectCategory = onSelectCategory,
        onSelectSort = onSelectSort,
        onToggleInStock = onToggleInStock,
        onClearBrand = onClearBrand,
        onClearFilters = onClearFilters,
        onRetry = onRetry,
        onLoadMore = onLoadMore,
        onOpenProduct = onOpenProduct,
        onToggleFavorite = onToggleFavorite,
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
 */
@Composable
private fun CatalogHeader(
  state: CatalogUiState,
  onSearchChange: (String) -> Unit,
  onDirectoryFilterChange: (String) -> Unit,
  onSelectTab: (CatalogTab) -> Unit,
) {
  Surface(
    color = MaterialTheme.colorScheme.surface,
    shadowElevation = MaharaniDimens.appBarElevation,
    modifier = Modifier.fillMaxWidth(),
  ) {
    Column(
      modifier = Modifier.padding(
        horizontal = MaharaniDimens.pageGutter,
        vertical = MaharaniDimens.spaceSm,
      ),
      verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceSm),
    ) {
      if (state.tab == CatalogTab.PRODUCTS) {
        MaharaniSearchBar(
          value = state.query.search,
          onValueChange = onSearchChange,
          onSubmit = { },
          loading = state.loading && state.products.isNotEmpty(),
          testTag = CatalogScreenTags.SEARCH_FIELD,
        )
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
  }
}

/**
 * The Products pane: the filter chips the catalogue has always had, plus the
 * paginated grid.
 */
@Composable
private fun CatalogProductsPane(
  state: CatalogUiState,
  favorites: FavoritesSnapshot,
  onSelectCategory: (String?) -> Unit,
  onSelectSort: (CatalogSort) -> Unit,
  onToggleInStock: () -> Unit,
  onClearBrand: () -> Unit,
  onClearFilters: () -> Unit,
  onRetry: () -> Unit,
  onLoadMore: () -> Unit,
  onOpenProduct: (String) -> Unit,
  onToggleFavorite: ((String) -> Unit)?,
) {
  Column(modifier = Modifier.fillMaxSize()) {
    CatalogFilterBar(
      state = state,
      onSelectCategory = onSelectCategory,
      onSelectSort = onSelectSort,
      onToggleInStock = onToggleInStock,
      onClearBrand = onClearBrand,
    )

    ResultSummary(
      state = state,
      onClearFilters = onClearFilters,
      modifier = Modifier.padding(
        horizontal = MaharaniDimens.pageGutter,
        vertical = MaharaniDimens.spaceSm,
      ),
    )

    when {
      state.loading && state.products.isEmpty() -> Box(
        modifier = Modifier
          .fillMaxSize()
          .padding(MaharaniDimens.pageGutter),
      ) { ProductGridSkeleton(columns = 2, rows = 3) }

      state.products.isEmpty() && state.errorMessage != null -> if (state.offline) {
        OfflineState(onRetry = onRetry)
      } else {
        ErrorState(
          message = state.errorMessage.orEmpty(),
          retryable = state.retryable,
          onRetry = onRetry,
        )
      }

      state.products.isEmpty() -> EmptyState(
        title = "No products found",
        message = "Nothing matches these filters. Try a different search term, or clear the " +
          "filters to see the whole catalogue.",
        actionLabel = "Clear filters",
        onAction = onClearFilters,
      )

      else -> ProductGrid(
        products = state.products,
        onOpenProduct = onOpenProduct,
        state = rememberLazyGridState(),
        modifier = Modifier.fillMaxSize(),
        isFavorite = { product -> favorites.isFavorite(product.id, product.isFavorite) },
        isFavoritePending = { product -> favorites.isPending(product.id) },
        onToggleFavorite = onToggleFavorite,
        footer = {
          item(span = { GridItemSpan(maxLineSpan) }) {
            ContinuationFooter(state = state, onLoadMore = onLoadMore, onRetry = onRetry)
          }
        },
      )
    }
  }
}

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
        horizontal = MaharaniDimens.pageGutter,
        vertical = MaharaniDimens.spaceMd,
      ),
      horizontalArrangement = Arrangement.spacedBy(MaharaniDimens.cardGap),
      verticalArrangement = Arrangement.spacedBy(MaharaniDimens.cardGap),
    ) {
      item(span = { GridItemSpan(maxLineSpan) }) {
        Column(
          verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceXs),
          modifier = Modifier.testTag(CatalogScreenTags.DIRECTORY_SCOPE),
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
        DirectoryAllCard(
          selected = if (showingCategories) {
            state.query.categoryId == null
          } else {
            state.query.brandId == null
          },
          onClick = {
            // "All" clears whichever scope this pane controls; categories clear
            // through the same null filter the chip row uses, brands through the
            // brand chip's own clear action.
            if (showingCategories) onSelectCategory(null) else onClearBrand()
          },
          totalCount = state.resultCount,
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

/**
 * The category chips, the sort menu, the in-stock toggle and the active brand
 * chip. Unchanged behaviour: every one of them sets a server-side filter.
 */
@Composable
private fun CatalogFilterBar(
  state: CatalogUiState,
  onSelectCategory: (String?) -> Unit,
  onSelectSort: (CatalogSort) -> Unit,
  onToggleInStock: () -> Unit,
  onClearBrand: () -> Unit,
  modifier: Modifier = Modifier,
) {
  Column(
    modifier = modifier
      .fillMaxWidth()
      .padding(
        horizontal = MaharaniDimens.pageGutter,
        vertical = MaharaniDimens.spaceSm,
      ),
    verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceSm),
  ) {
    LazyRow(
      modifier = Modifier
        .fillMaxWidth()
        .testTag(CatalogScreenTags.CATEGORY_CHIPS),
      horizontalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceSm),
    ) {
      item {
        FilterChip(
          selected = state.query.categoryId == null,
          onClick = { onSelectCategory(null) },
          label = { Text("All") },
          colors = FilterChipDefaults.filterChipColors(
            selectedContainerColor = MaterialTheme.colorScheme.primaryContainer,
            selectedLabelColor = MaterialTheme.colorScheme.onPrimaryContainer,
          ),
        )
      }
      items(state.categories, key = { it.id }) { category ->
        FilterChip(
          selected = state.query.categoryId == category.id,
          onClick = { onSelectCategory(category.id) },
          label = { Text(category.name) },
          colors = FilterChipDefaults.filterChipColors(
            selectedContainerColor = MaterialTheme.colorScheme.primaryContainer,
            selectedLabelColor = MaterialTheme.colorScheme.onPrimaryContainer,
          ),
        )
      }
    }

    Row(
      modifier = Modifier.fillMaxWidth(),
      verticalAlignment = Alignment.CenterVertically,
      horizontalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceSm),
    ) {
      SortMenu(current = state.query.sort, onSelect = onSelectSort)
      FilterChip(
        selected = state.query.inStockOnly,
        onClick = onToggleInStock,
        label = { Text("In stock") },
        modifier = Modifier.testTag(CatalogScreenTags.IN_STOCK_CHIP),
        colors = FilterChipDefaults.filterChipColors(
          selectedContainerColor = MaterialTheme.colorScheme.primaryContainer,
          selectedLabelColor = MaterialTheme.colorScheme.onPrimaryContainer,
        ),
      )
      val brand = state.brandLabel ?: state.selectedBrand?.name
      if (state.query.brandId != null && brand != null) {
        FilterChip(
          selected = true,
          onClick = onClearBrand,
          label = { Text(brand, maxLines = 1, overflow = TextOverflow.Ellipsis) },
          trailingIcon = {
            CloseGlyph(
              modifier = Modifier.size(16.dp),
              tint = MaterialTheme.colorScheme.onSecondaryContainer,
            )
          },
          // A long brand name shares the header row with the sort button and
          // the in-stock chip, so it takes only what is left and ellipsises.
          modifier = Modifier
            .weight(1f, fill = false)
            .testTag(CatalogScreenTags.BRAND_CHIP),
          colors = FilterChipDefaults.filterChipColors(
            containerColor = MaterialTheme.colorScheme.secondaryContainer,
            selectedContainerColor = MaterialTheme.colorScheme.secondaryContainer,
            selectedLabelColor = MaterialTheme.colorScheme.onSecondaryContainer,
          ),
        )
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
    TextButton(
      onClick = { expanded = true },
      modifier = Modifier
        .heightIn(min = MaharaniDimens.touchTarget)
        .testTag(CatalogScreenTags.SORT_BUTTON),
    ) {
      SortGlyph(
        modifier = Modifier.size(16.dp),
        tint = MaterialTheme.colorScheme.primary,
      )
      Text(
        text = current.label,
        style = MaterialTheme.typography.labelLarge,
        color = MaterialTheme.colorScheme.primary,
        maxLines = 1,
        modifier = Modifier.padding(start = MaharaniDimens.spaceXs),
      )
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
 * a capped working set, and an active filter set that can be cleared in one tap.
 */
@Composable
private fun ResultSummary(
  state: CatalogUiState,
  onClearFilters: () -> Unit,
  modifier: Modifier = Modifier,
) {
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
      val scope = listOfNotNull(state.selectedCategoryName, state.brandLabel).joinToString(" · ")
      if (scope.isNotEmpty()) {
        Text(
          text = scope,
          style = MaterialTheme.typography.labelSmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
          maxLines = 1,
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
  if (state.hasMore) {
    LaunchedEffect(state.nextCursor) { onLoadMore() }
  }

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

        state.errorMessage != null -> TextButton(
          onClick = onRetry,
          modifier = Modifier.testTag(CatalogScreenTags.LOADING_MORE),
        ) {
          Text(if (state.offline) "Back online? Load more" else "Try loading more again")
        }

        // Reached only when the server said there is no next batch (or repeated
        // its cursor). An explicit end beats an endless spinner.
        !state.hasMore -> Text(
          text = "You have seen every product in this list.",
          style = MaterialTheme.typography.bodySmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
          modifier = Modifier.testTag(CatalogScreenTags.END_OF_LIST),
        )
      }
    }
  }
}
