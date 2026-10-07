package com.maharanitraders.feature.catalog.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.maharanitraders.core.designsystem.components.EmptyState
import com.maharanitraders.core.designsystem.components.ErrorState
import com.maharanitraders.core.designsystem.components.OfflineState
import com.maharanitraders.core.designsystem.components.ProductGridSkeleton
import com.maharanitraders.core.designsystem.theme.MaharaniDimens
import com.maharanitraders.feature.catalog.FavoritesSnapshot
import com.maharanitraders.feature.catalog.FavoritesSort
import com.maharanitraders.feature.catalog.FavoritesUiState
import com.maharanitraders.feature.catalog.FavoritesViewModel
import com.maharanitraders.feature.catalog.ui.components.ProductGrid

/** Test tags for the favourites surface. */
object FavoritesScreenTags {
  const val GRID = "favorites_grid"
  const val COUNT = "favorites_count"
  const val LOADING_MORE = "favorites_loading_more"
  const val END_OF_LIST = "favorites_end_of_list"
  const val SORT_ROW = "favorites_sort_row"
  const val SORT_CHIP = "favorites_sort_chip"
  const val IN_STOCK_CHIP = "favorites_in_stock_chip"
}

/**
 * Saved products — the native counterpart of `/retailer/favorites`, and a
 * restocking workspace rather than a list of hearts.
 *
 * The rows are the real catalogue filtered to this retailer's favourites, so
 * every price, pack, minimum and stock badge is the same server-resolved value
 * the catalogue shows. Sorting and the in-stock switch are VIEW preferences over
 * those rows (see `favoritesView`): nothing is re-priced on the device, and a
 * row the filter hides is simply not drawn.
 *
 * Adding to the cart from here goes through the same cart endpoint as a card on
 * the catalogue — the server revalidates the pack, its minimum and its stock and
 * answers with the new basket, so a favourite that can no longer be ordered says
 * so instead of silently failing.
 */
@Composable
fun FavoritesScreen(
  onOpenProduct: (productId: String) -> Unit,
  onBrowseCatalog: () -> Unit,
  modifier: Modifier = Modifier,
  /** Quick add, `(packId, quantity)`. Null hides the cards' add control. */
  onQuickAddToCart: ((String, Int) -> Unit)? = null,
  /** The pack whose add is in flight, so exactly one card shows a spinner. */
  quickAddPackId: String? = null,
  /** The cart's own last failure, shown once by this screen's snackbar. */
  quickAddMessage: String? = null,
  onQuickAddMessageShown: () -> Unit = {},
  viewModel: FavoritesViewModel = hiltViewModel(),
) {
  val state by viewModel.state.collectAsStateWithLifecycle()
  val favorites by viewModel.favoriteState.collectAsStateWithLifecycle()
  val snackbarHostState = remember { SnackbarHostState() }

  // A failed toggle is reported, never swallowed: the row stayed as it was and
  // the shopper is told why.
  LaunchedEffect(state.actionMessage) {
    val message = state.actionMessage
    if (message != null) {
      snackbarHostState.showSnackbar(message)
      viewModel.consumeActionMessage()
    }
  }

  // A failed quick add is reported once, on the screen the shopper is on.
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
    FavoritesContent(
      state = state,
      favorites = favorites,
      onOpenProduct = onOpenProduct,
      onToggleFavorite = viewModel::toggleFavorite,
      onBrowseCatalog = onBrowseCatalog,
      onSelectSort = viewModel::selectSort,
      onToggleInStockOnly = viewModel::toggleInStockOnly,
      onRetry = viewModel::retry,
      onLoadMore = viewModel::loadMore,
      onQuickAddToCart = onQuickAddToCart,
      quickAddPackId = quickAddPackId,
      modifier = Modifier
        .fillMaxSize()
        .padding(padding),
    )
  }
}

@Composable
fun FavoritesContent(
  state: FavoritesUiState,
  favorites: FavoritesSnapshot,
  onOpenProduct: (String) -> Unit,
  onToggleFavorite: (String) -> Unit,
  onBrowseCatalog: () -> Unit,
  onSelectSort: (FavoritesSort) -> Unit = {},
  onToggleInStockOnly: () -> Unit = {},
  onRetry: () -> Unit,
  onLoadMore: () -> Unit,
  onQuickAddToCart: ((String, Int) -> Unit)? = null,
  quickAddPackId: String? = null,
  modifier: Modifier = Modifier,
) {
  Column(modifier = modifier.fillMaxSize()) {
    if (state.products.isNotEmpty()) {
      Text(
        text = state.resultCount
          ?.let { count -> if (count == 1) "1 saved product" else "$count saved products" }
          ?: "${state.products.size} saved products",
        style = MaterialTheme.typography.labelLarge,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier
          .padding(
            horizontal = MaharaniDimens.pageGutter,
            vertical = MaharaniDimens.spaceSm,
          )
          .testTag(FavoritesScreenTags.COUNT),
      )
      FavoritesControls(
        state = state,
        onSelectSort = onSelectSort,
        onToggleInStockOnly = onToggleInStockOnly,
      )
    }

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
        title = "No saved products yet",
        message = "Tap the heart on any product to save it here for a quick reorder.",
        actionLabel = "Browse the catalogue",
        onAction = onBrowseCatalog,
      )

      // Saved, but every saved row is currently out of stock. Saying so is
      // different from "you saved nothing": the shop exists, the warehouse
      // cannot fill it today.
      state.allHiddenByFilter -> EmptyState(
        title = "Everything you saved is out of stock",
        message = "These products are still saved. Turn off the in-stock filter to see them, " +
          "or browse the catalogue for an alternative.",
        actionLabel = "Show out of stock too",
        onAction = onToggleInStockOnly,
      )

      else -> ProductGrid(
        products = state.visibleProducts,
        onOpenProduct = onOpenProduct,
        state = rememberLazyGridState(),
        modifier = Modifier
          .fillMaxSize()
          .testTag(FavoritesScreenTags.GRID),
        // One source of truth: the shared store, never a copy held here.
        isFavorite = { product -> favorites.isFavorite(product.id, product.isFavorite) },
        isFavoritePending = { product -> favorites.isPending(product.id) },
        onToggleFavorite = onToggleFavorite,
        onQuickAddToCart = onQuickAddToCart,
        quickAddPackId = quickAddPackId,
        header = {
          item(span = { GridItemSpan(maxLineSpan) }) {
            // Hidden rows are counted, not silently dropped: a filter that
            // quietly removed six of twelve products would read as a server
            // failure rather than as the shopper's own choice.
            val hidden = state.products.size - state.visibleProducts.size
            if (hidden > 0) {
              Text(
                text = "$hidden hidden by the in-stock filter",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(
                  horizontal = MaharaniDimens.pageGutter,
                  vertical = MaharaniDimens.spaceXs,
                ),
              )
            }
          }
        },
        footer = {
          item(span = { GridItemSpan(maxLineSpan) }) {
            FavoritesFooter(state = state, onLoadMore = onLoadMore, onRetry = onRetry)
          }
        },
      )
    }
  }
}

/**
 * Sorting and the in-stock switch.
 *
 * Both are chips over rows the server already sent, so neither costs a request.
 * The current choice is visible (a selected chip), and "in stock" means what the
 * server's own two-state availability says — never a stock count, which this API
 * does not publish to a retailer.
 */
@Composable
private fun FavoritesControls(
  state: FavoritesUiState,
  onSelectSort: (FavoritesSort) -> Unit,
  onToggleInStockOnly: () -> Unit,
  modifier: Modifier = Modifier,
) {
  Column(
    modifier = modifier
      .fillMaxWidth()
      .padding(horizontal = MaharaniDimens.pageGutter),
    verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceXs),
  ) {
    LazyRow(
      modifier = Modifier
        .fillMaxWidth()
        .testTag(FavoritesScreenTags.SORT_ROW),
      horizontalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceSm),
    ) {
      items(FavoritesSort.entries) { sort ->
        FilterChip(
          selected = state.sort == sort,
          onClick = { onSelectSort(sort) },
          label = { Text(sort.label, maxLines = 1) },
          modifier = Modifier.testTag("${FavoritesScreenTags.SORT_CHIP}_${sort.name}"),
        )
      }
      item {
        FilterChip(
          selected = state.inStockOnly,
          onClick = onToggleInStockOnly,
          label = { Text("In stock only", maxLines = 1) },
          modifier = Modifier.testTag(FavoritesScreenTags.IN_STOCK_CHIP),
        )
      }
    }
  }
}

/**
 * The continuation footer.
 *
 * It asks for the next batch when it is composed, which only happens once the
 * shopper has scrolled it into view — the same "near the end" trigger the
 * catalogue uses, without a scroll listener to keep in sync.
 */
@Composable
private fun FavoritesFooter(
  state: FavoritesUiState,
  onLoadMore: () -> Unit,
  onRetry: () -> Unit,
) {
  LaunchedEffect(state.hasMore, state.nextCursor, state.loadingMore) {
    if (state.hasMore && !state.loadingMore) onLoadMore()
  }

  Box(
    modifier = Modifier
      .fillMaxWidth()
      .padding(vertical = MaharaniDimens.spaceLg),
    contentAlignment = Alignment.Center,
  ) {
    when {
      state.loadingMore -> CircularProgressIndicator(
        strokeWidth = 2.dp,
        modifier = Modifier
          .size(24.dp)
          .testTag(FavoritesScreenTags.LOADING_MORE),
      )

      // A continuation failure keeps the rows already on screen and offers a
      // retry for the footer alone.
      state.errorMessage != null -> Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceXs),
      ) {
        Text(
          text = state.errorMessage,
          style = MaterialTheme.typography.bodySmall,
          color = MaterialTheme.colorScheme.error,
        )
        TextButton(onClick = onRetry) { Text("Try again") }
      }

      state.endOfList -> Text(
        text = "That is everything you have saved.",
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.testTag(FavoritesScreenTags.END_OF_LIST),
      )
    }
  }
}
