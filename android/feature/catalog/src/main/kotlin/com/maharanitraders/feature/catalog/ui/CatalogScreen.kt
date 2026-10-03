package com.maharanitraders.feature.catalog.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
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
import com.maharanitraders.feature.catalog.CatalogUiState
import com.maharanitraders.feature.catalog.CatalogViewModel
import androidx.compose.material3.CircularProgressIndicator
import com.maharanitraders.feature.catalog.ui.components.ProductGrid

/** Test tags for the catalogue list surface. */
object CatalogScreenTags {
  const val SEARCH_FIELD = "catalog_search_field"
  const val CATEGORY_CHIPS = "catalog_category_chips"
  const val SORT_BUTTON = "catalog_sort_button"
  const val IN_STOCK_CHIP = "catalog_in_stock_chip"
  const val BRAND_CHIP = "catalog_brand_chip"
  const val RESULT_COUNT = "catalog_result_count"
  const val LOADING_MORE = "catalog_loading_more"
  const val END_OF_LIST = "catalog_end_of_list"
  const val CLEAR_FILTERS = "catalog_clear_filters"
}

/**
 * The catalogue: search, filter, sort and scroll through the real product list.
 *
 * The grid appends batches as the shopper nears the end. What it never does is
 * invent the end: `hasMore` and the cursor both come from the server, and a
 * cursor the server repeats terminates the list with an explicit "You have seen
 * everything" line rather than an endless spinner.
 *
 * The filter header is pinned above the grid (reference-style), the search
 * field is the shared [MaharaniSearchBar], and the grid keeps its scroll state
 * across navigation so returning from a product detail lands where the shopper
 * left off.
 */
@Composable
fun CatalogScreen(
  initialSearch: String = "",
  initialCategoryId: String? = null,
  initialBrandId: String? = null,
  initialBrandLabel: String? = null,
  onOpenProduct: (productId: String) -> Unit,
  modifier: Modifier = Modifier,
  viewModel: CatalogViewModel = hiltViewModel(),
) {
  val state by viewModel.state.collectAsStateWithLifecycle()

  // Deep links from the home screen arrive as arguments, not as state the
  // ViewModel guesses at.
  LaunchedEffect(initialSearch, initialCategoryId, initialBrandId) {
    if (initialSearch.isNotEmpty() && state.query.search != initialSearch) {
      viewModel.onSearchChange(initialSearch)
    }
    if (initialCategoryId != null && state.query.categoryId != initialCategoryId) {
      viewModel.selectCategory(initialCategoryId)
    }
    if (initialBrandId != null && state.query.brandId != initialBrandId) {
      viewModel.selectBrand(initialBrandId, initialBrandLabel)
    }
  }

  CatalogContent(
    state = state,
    onSearchChange = viewModel::onSearchChange,
    onSelectCategory = viewModel::selectCategory,
    onSelectSort = viewModel::selectSort,
    onToggleInStock = viewModel::toggleInStockOnly,
    onClearBrand = { viewModel.selectBrand(null) },
    onClearFilters = viewModel::clearFilters,
    onRetry = viewModel::retry,
    onLoadMore = viewModel::loadMore,
    onOpenProduct = onOpenProduct,
    modifier = modifier,
  )
}

@Composable
fun CatalogContent(
  state: CatalogUiState,
  onSearchChange: (String) -> Unit,
  onSelectCategory: (String?) -> Unit,
  onSelectSort: (CatalogSort) -> Unit,
  onToggleInStock: () -> Unit,
  onClearBrand: () -> Unit,
  onClearFilters: () -> Unit,
  onRetry: () -> Unit,
  onLoadMore: () -> Unit,
  onOpenProduct: (String) -> Unit,
  modifier: Modifier = Modifier,
) {
  Column(modifier = modifier.fillMaxSize()) {
    CatalogFilterBar(
      state = state,
      onSearchChange = onSearchChange,
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
        footer = {
          item(span = { GridItemSpan(maxLineSpan) }) {
            ContinuationFooter(state = state, onLoadMore = onLoadMore, onRetry = onRetry)
          }
        },
      )
    }
  }
}

@Composable
private fun CatalogFilterBar(
  state: CatalogUiState,
  onSearchChange: (String) -> Unit,
  onSelectCategory: (String?) -> Unit,
  onSelectSort: (CatalogSort) -> Unit,
  onToggleInStock: () -> Unit,
  onClearBrand: () -> Unit,
  modifier: Modifier = Modifier,
) {
  Surface(
    color = MaterialTheme.colorScheme.surface,
    shadowElevation = MaharaniDimens.appBarElevation,
    modifier = modifier.fillMaxWidth(),
  ) {
    Column(
      modifier = Modifier.padding(
        horizontal = MaharaniDimens.pageGutter,
        vertical = MaharaniDimens.spaceSm,
      ),
      verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceSm),
    ) {
      MaharaniSearchBar(
        value = state.query.search,
        onValueChange = onSearchChange,
        onSubmit = { },
        testTag = CatalogScreenTags.SEARCH_FIELD,
      )

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
        val brand = state.brandLabel
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
      val count = state.resultCount
      Text(
        text = when {
          count == null -> "Loading products…"
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
