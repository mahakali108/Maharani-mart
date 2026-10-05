package com.maharanitraders.feature.catalog.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.material3.CircularProgressIndicator
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
import com.maharanitraders.feature.catalog.FavoritesUiState
import com.maharanitraders.feature.catalog.FavoritesViewModel
import com.maharanitraders.feature.catalog.ui.components.ProductGrid

/** Test tags for the favourites surface. */
object FavoritesScreenTags {
  const val GRID = "favorites_grid"
  const val COUNT = "favorites_count"
  const val LOADING_MORE = "favorites_loading_more"
  const val END_OF_LIST = "favorites_end_of_list"
}

/**
 * Saved products — the native counterpart of `/retailer/favorites`.
 *
 * The list is the real catalogue filtered to this retailer's favourites, so
 * every price, pack and stock badge is the same server-resolved value the
 * catalogue shows. Nothing is cached locally and nothing is invented: an empty
 * list means the shop has saved nothing yet, not that the request failed.
 */
@Composable
fun FavoritesScreen(
  onOpenProduct: (productId: String) -> Unit,
  onBrowseCatalog: () -> Unit,
  modifier: Modifier = Modifier,
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
      onRetry = viewModel::retry,
      onLoadMore = viewModel::loadMore,
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
  onRetry: () -> Unit,
  onLoadMore: () -> Unit,
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

      else -> ProductGrid(
        products = state.products,
        onOpenProduct = onOpenProduct,
        state = rememberLazyGridState(),
        modifier = Modifier
          .fillMaxSize()
          .testTag(FavoritesScreenTags.GRID),
        // One source of truth: the shared store, never a copy held here.
        isFavorite = { product -> favorites.isFavorite(product.id, product.isFavorite) },
        isFavoritePending = { product -> favorites.isPending(product.id) },
        onToggleFavorite = onToggleFavorite,
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
