package com.maharanitraders.feature.catalog.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyGridScope
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.maharanitraders.core.model.CatalogProduct

/**
 * The shared product grid.
 *
 * One responsive grid serves both product surfaces the app has — the catalogue
 * list and the retailer home rail — so a tile, a gap or a column policy can
 * never drift between them. Columns are adaptive (two across a phone, more as
 * the window widens) with no hardcoded breakpoint.
 *
 * The `header` slot receives the grid's own [LazyGridScope], so a caller can
 * stack full-span sections (search, banners, category strips) above the tiles
 * exactly as it would inside its own grid. The `footer` slot is simpler: its
 * content is placed as one full-span item after the last tile, which is where a
 * pagination sentinel belongs.
 *
 * The grid itself invents nothing: `products` is the server's list, keyed by
 * the server's ids. Tile count, ordering and end-of-list are the caller's
 * (server-driven) state — see [ProductGridContinuation] for the honest
 * continuation footer that pairs with a paginated caller.
 */
@Composable
fun ProductGrid(
  products: List<CatalogProduct>,
  onOpenProduct: (productId: String) -> Unit,
  modifier: Modifier = Modifier,
  contentPadding: PaddingValues = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
  minTileWidth: Dp = 150.dp,
  horizontalSpacing: Dp = 12.dp,
  verticalSpacing: Dp = 12.dp,
  header: (LazyGridScope.() -> Unit)? = null,
  footer: (@Composable () -> Unit)? = null,
) {
  LazyVerticalGrid(
    columns = GridCells.Adaptive(minSize = minTileWidth),
    modifier = modifier.fillMaxSize(),
    contentPadding = contentPadding,
    horizontalArrangement = Arrangement.spacedBy(horizontalSpacing),
    verticalArrangement = Arrangement.spacedBy(verticalSpacing),
  ) {
    header?.invoke(this)
    items(products, key = { it.id }) { product ->
      ProductCardTile(
        product = product,
        onClick = { onOpenProduct(product.id) },
        modifier = Modifier.fillMaxWidth(),
      )
    }
    if (footer != null) {
      item(span = { GridItemSpan(maxLineSpan) }) { footer() }
    }
  }
}

/**
 * The continuation footer for a paginated grid.
 *
 * Composing it while `hasMore` is true asks for the next batch — the ViewModel
 * ignores the request while one is in flight or the list ended. What this
 * footer never does is invent the end: `hasMore` and `nextCursor` come from the
 * server, and a cursor the server repeats terminates the list with an explicit
 * "You have seen everything" line rather than an endless spinner.
 *
 * States, in order: an in-flight batch shows a spinner; a failed batch shows a
 * retry (worded for the offline case too); a server-declared end shows the end
 * line. A quiet gap while the next batch loads is deliberate — the tiles above
 * are still the shopper's list.
 */
@Composable
fun ProductGridContinuation(
  hasMore: Boolean,
  loadingMore: Boolean,
  nextCursor: String?,
  errorMessage: String?,
  offline: Boolean,
  onLoadMore: () -> Unit,
  onRetry: () -> Unit,
  modifier: Modifier = Modifier,
) {
  if (hasMore) {
    LaunchedEffect(nextCursor) { onLoadMore() }
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
        loadingMore -> {
          CircularProgressIndicator(
            modifier = Modifier.height(18.dp).padding(end = 8.dp),
            strokeWidth = 2.dp,
          )
          Text(
            text = "Loading more products…",
            style = MaterialTheme.typography.bodySmall,
            modifier = Modifier.testTag(CatalogScreenTags.LOADING_MORE),
          )
        }

        errorMessage != null -> TextButton(
          onClick = onRetry,
          modifier = Modifier.testTag(CatalogScreenTags.LOADING_MORE),
        ) {
          Text(if (offline) "Back online? Load more" else "Try loading more again")
        }

        // Reached only when the server said there is no next batch (or repeated
        // its cursor). An explicit end beats an endless spinner.
        !hasMore -> Text(
          text = "You have seen every product in this list.",
          style = MaterialTheme.typography.bodySmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
          modifier = Modifier.testTag(CatalogScreenTags.END_OF_LIST),
        )
      }
    }
  }
}
