package com.maharanitraders.feature.catalog.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.maharanitraders.core.designsystem.components.EmptyState
import com.maharanitraders.core.designsystem.components.ErrorState
import com.maharanitraders.core.designsystem.components.OfflineState
import com.maharanitraders.core.designsystem.components.ProductGridSkeleton
import com.maharanitraders.core.designsystem.components.SecondaryAction
import com.maharanitraders.core.designsystem.theme.MaharaniDimens
import com.maharanitraders.core.model.CatalogProduct
import com.maharanitraders.feature.catalog.FavoritesListState
import com.maharanitraders.feature.catalog.FavoritesUiState
import com.maharanitraders.feature.catalog.FavoritesViewModel
import com.maharanitraders.feature.catalog.ui.components.ProductGrid

/** Test tags for the favourites surface. */
object FavoritesScreenTags {
  const val HEADER = "favorites_header"
  const val COUNT = "favorites_count"
  const val REFRESH = "favorites_refresh"
}

/**
 * The shopper's saved products.
 *
 * The list is the server's favourites filter, so every card carries the live
 * price, MOQ and stock status of THIS retailer — a saved pack that has since gone
 * out of stock says so, because that is the truth the catalogue endpoint returned.
 *
 * The heart on each card is the same server-side toggle the product page uses, so
 * removing a favourite here and saving it there are one fact, not two copies.
 */
@Composable
fun FavoritesScreen(
  onOpenProduct: (String) -> Unit,
  onBrowseCatalog: () -> Unit,
  modifier: Modifier = Modifier,
  viewModel: FavoritesViewModel = hiltViewModel(),
) {
  val list by viewModel.list.collectAsStateWithLifecycle()
  val favorites by viewModel.favorites.collectAsStateWithLifecycle()

  FavoritesContent(
    list = list,
    favorites = favorites,
    onOpenProduct = onOpenProduct,
    onToggleFavorite = viewModel::toggleFavorite,
    onDismissMessage = viewModel::dismissMessage,
    onRetry = viewModel::load,
    onLoadMore = viewModel::loadMore,
    onBrowseCatalog = onBrowseCatalog,
    modifier = modifier,
  )
}

/**
 * The visible rows: a favourite the server has just confirmed as REMOVED drops
 * out immediately, because this list is by definition "what is saved".
 */
internal fun visibleFavorites(
  items: List<CatalogProduct>,
  favorites: FavoritesUiState,
): List<CatalogProduct> = items.filter { favorites.isFavorite(it.id, it.isFavorite) }

@Composable
fun FavoritesContent(
  list: FavoritesListState,
  favorites: FavoritesUiState,
  onOpenProduct: (String) -> Unit,
  onToggleFavorite: (String) -> Unit,
  onDismissMessage: () -> Unit = {},
  onRetry: () -> Unit,
  onLoadMore: () -> Unit,
  onBrowseCatalog: () -> Unit,
  modifier: Modifier = Modifier,
) {
  val visible = visibleFavorites(list.items, favorites)

  Column(modifier = modifier.fillMaxSize()) {
    Column(
      modifier = Modifier
        .fillMaxWidth()
        .padding(
          horizontal = MaharaniDimens.pageGutter,
          vertical = MaharaniDimens.spaceMd,
        ),
      verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceXxs),
    ) {
      Text(
        text = "Your favourites",
        style = MaterialTheme.typography.titleLarge,
        color = MaterialTheme.colorScheme.onSurface,
        modifier = Modifier.testTag(FavoritesScreenTags.HEADER),
      )
      // The server's own count, not this page's length: on a paginated list the
      // two differ, and "18 products saved" under 18 loaded rows would be wrong.
      Text(
        text = when {
          list.loading || list.resultCount == null -> "Loading saved products…"
          list.resultCount == 1 -> "1 product saved for later"
          else -> "${list.resultCount} products saved for later"
        },
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.testTag(FavoritesScreenTags.COUNT),
      )
      if (list.resultCapped) {
        Text(
          text = "Showing the first saved products only.",
          style = MaterialTheme.typography.labelSmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
      }
      favorites.message?.let { message ->
        // A failed write is the shopper's business, so it is said here, at the
        // top, and not only at the bottom of a long grid.
        Row(
          modifier = Modifier.fillMaxWidth(),
          verticalAlignment = Alignment.CenterVertically,
          horizontalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceXs),
        ) {
          Text(
            text = message,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.error,
            modifier = Modifier.weight(1f),
          )
          TextButton(onClick = onDismissMessage) { Text("Dismiss") }
        }
      }
    }

    when {
      list.loading -> Box(
        modifier = Modifier
          .fillMaxSize()
          .padding(horizontal = MaharaniDimens.pageGutter),
      ) { ProductGridSkeleton(columns = 2, rows = 3) }

      list.errorMessage != null && visible.isEmpty() -> if (list.offline) {
        OfflineState(onRetry = onRetry)
      } else {
        ErrorState(
          message = list.errorMessage.orEmpty(),
          retryable = list.retryable,
          onRetry = onRetry,
        )
      }

      visible.isEmpty() -> EmptyState(
        title = "Nothing saved yet",
        message = "Tap the heart on a product to keep it here. Saved products show their " +
          "live price and stock, so you can see when something is back.",
        actionLabel = "Browse catalogue",
        onAction = onBrowseCatalog,
      )

      else -> Column(modifier = Modifier.fillMaxSize()) {
        if (list.refreshing) {
          Text(
            text = "Refreshing…",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(horizontal = MaharaniDimens.pageGutter),
          )
        }

        ProductGrid(
          products = visible,
          onOpenProduct = onOpenProduct,
          favorites = favorites.overrides,
          favoriteBusyIds = favorites.busyIds,
          onToggleFavorite = onToggleFavorite,
          modifier = Modifier
            .fillMaxWidth()
            .weight(1f),
          state = rememberLazyGridState(),
          footer = {
            item {
              Column(
                modifier = Modifier
                  .fillMaxWidth()
                  .padding(MaharaniDimens.pageGutter),
                verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceSm),
                horizontalAlignment = Alignment.CenterHorizontally,
              ) {
                if (list.loadingMore) {
                  Text(
                    text = "Loading more…",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                  )
                } else if (list.hasMore) {
                  SecondaryAction(onClick = onLoadMore, label = "Load more favourites")
                } else if (!list.endOfList) {
                  Text(
                    text = "That's every saved product.",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                  )
                }
                TextButton(
                  onClick = onRetry,
                  enabled = !list.refreshing,
                  modifier = Modifier.testTag(FavoritesScreenTags.REFRESH),
                ) { Text("Refresh") }
              }
            }
          },
        )
      }
    }
  }
}
