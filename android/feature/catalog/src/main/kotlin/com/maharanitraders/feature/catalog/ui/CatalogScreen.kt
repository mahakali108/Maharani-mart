package com.maharanitraders.feature.catalog.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.maharanitraders.core.designsystem.components.EmptyState
import com.maharanitraders.core.designsystem.components.ErrorState
import com.maharanitraders.core.designsystem.components.OfflineState
import com.maharanitraders.core.model.CatalogSort
import com.maharanitraders.feature.catalog.CatalogUiState
import com.maharanitraders.feature.catalog.CatalogViewModel

/** Test tags for the catalogue list surface. */
object CatalogScreenTags {
  const val SEARCH_FIELD = "catalog_search_field"
  const val CATEGORY_CHIPS = "catalog_category_chips"
  const val SORT_BUTTON = "catalog_sort_button"
  const val IN_STOCK_CHIP = "catalog_in_stock_chip"
  const val RESULT_COUNT = "catalog_result_count"
  const val GRID = "catalog_grid"
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
 */
@Composable
fun CatalogScreen(
  initialSearch: String = "",
  initialCategoryId: String? = null,
  onOpenProduct: (productId: String) -> Unit,
  modifier: Modifier = Modifier,
  viewModel: CatalogViewModel = hiltViewModel(),
) {
  val state by viewModel.state.collectAsStateWithLifecycle()

  // Deep links from the home screen arrive as arguments, not as state the
  // ViewModel guesses at.
  LaunchedEffect(initialSearch, initialCategoryId) {
    if (initialSearch.isNotEmpty() && state.query.search != initialSearch) {
      viewModel.onSearchChange(initialSearch)
    }
    if (initialCategoryId != null && state.query.categoryId != initialCategoryId) {
      viewModel.selectCategory(initialCategoryId)
    }
  }

  CatalogContent(
    state = state,
    onSearchChange = viewModel::onSearchChange,
    onSelectCategory = viewModel::selectCategory,
    onSelectSort = viewModel::selectSort,
    onToggleInStock = viewModel::toggleInStockOnly,
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
    )

    ResultSummary(
      state = state,
      onClearFilters = onClearFilters,
      modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
    )

    when {
      state.loading && state.products.isEmpty() -> Box(
        modifier = Modifier.fillMaxSize().padding(16.dp),
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
        message = "Nothing matches these filters. Try a different search term, or clear the filters " +
          "to see the whole catalogue.",
        actionLabel = "Clear filters",
        onAction = onClearFilters,
      )

      else -> CatalogGrid(
        state = state,
        onLoadMore = onLoadMore,
        onRetry = onRetry,
        onOpenProduct = onOpenProduct,
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
  modifier: Modifier = Modifier,
) {
  Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
    OutlinedTextField(
      value = state.query.search,
      onValueChange = onSearchChange,
      modifier = Modifier
        .fillMaxWidth()
        .padding(horizontal = 16.dp)
        .testTag(CatalogScreenTags.SEARCH_FIELD),
      placeholder = { Text("Search products, brands, pack sizes") },
      leadingIcon = { SearchGlyph(modifier = Modifier.padding(start = 8.dp)) },
      singleLine = true,
      shape = RoundedCornerShape(28.dp),
      keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
      keyboardActions = KeyboardActions(onSearch = { }),
    )

    LazyRow(
      modifier = Modifier
        .fillMaxWidth()
        .testTag(CatalogScreenTags.CATEGORY_CHIPS),
      contentPadding = PaddingValues(horizontal = 16.dp),
      horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
      item {
        FilterChip(
          selected = state.query.categoryId == null,
          onClick = { onSelectCategory(null) },
          label = { Text("All") },
        )
      }
      items(state.categories, key = { it.id }) { category ->
        FilterChip(
          selected = state.query.categoryId == category.id,
          onClick = { onSelectCategory(category.id) },
          label = { Text(category.name) },
        )
      }
    }

    Row(
      modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
      verticalAlignment = Alignment.CenterVertically,
      horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
      SortMenu(current = state.query.sort, onSelect = onSelectSort)
      FilterChip(
        selected = state.query.inStockOnly,
        onClick = onToggleInStock,
        label = { Text("In stock only") },
        modifier = Modifier.testTag(CatalogScreenTags.IN_STOCK_CHIP),
      )
    }
  }
}

@Composable
private fun SortMenu(current: CatalogSort, onSelect: (CatalogSort) -> Unit, modifier: Modifier = Modifier) {
  var expanded by remember { mutableStateOf(false) }

  Box(modifier = modifier) {
    TextButton(
      onClick = { expanded = true },
      modifier = Modifier
        .heightIn(min = 48.dp)
        .testTag(CatalogScreenTags.SORT_BUTTON),
    ) {
      Text("Sort: ${current.label}")
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
      state.selectedCategoryName?.let { name ->
        Text(
          text = "Category: $name",
          style = MaterialTheme.typography.labelSmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
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
private fun CatalogGrid(
  state: CatalogUiState,
  onLoadMore: () -> Unit,
  onRetry: () -> Unit,
  onOpenProduct: (String) -> Unit,
  modifier: Modifier = Modifier,
) {
  LazyVerticalGrid(
    columns = GridCells.Adaptive(minSize = 150.dp),
    modifier = modifier
      .fillMaxSize()
      .testTag(CatalogScreenTags.GRID),
    contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
    horizontalArrangement = Arrangement.spacedBy(12.dp),
    verticalArrangement = Arrangement.spacedBy(12.dp),
  ) {
    items(state.products, key = { it.id }) { product ->
      ProductCardTile(
        product = product,
        onClick = { onOpenProduct(product.id) },
        modifier = Modifier.fillMaxWidth(),
      )
    }

    // The continuation sentinel: composing it asks for the next batch. The
    // ViewModel ignores the request while one is in flight or the list ended.
    item(span = { GridItemSpan(maxLineSpan) }) {
      ContinuationFooter(state = state, onLoadMore = onLoadMore, onRetry = onRetry)
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
    modifier = modifier
      .fillMaxWidth()
      .heightIn(min = 72.dp),
  ) {
    Row(
      modifier = Modifier.fillMaxWidth().padding(vertical = 16.dp),
      verticalAlignment = Alignment.CenterVertically,
      horizontalArrangement = Arrangement.Center,
    ) {
      when {
        state.loadingMore -> {
          CircularProgressIndicator(modifier = Modifier.height(18.dp).padding(end = 8.dp), strokeWidth = 2.dp)
          Text(
            text = "Loading more products…",
            style = MaterialTheme.typography.bodySmall,
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
