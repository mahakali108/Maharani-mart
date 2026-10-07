package com.maharanitraders.feature.catalog.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyGridScope
import androidx.compose.foundation.lazy.grid.LazyGridState
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.maharanitraders.core.designsystem.theme.MaharaniDimens
import com.maharanitraders.core.model.CatalogProduct

/** Test tag of a product grid, addressable from Compose UI tests. */
const val PRODUCT_GRID_TAG = "catalog_product_grid"

/**
 * Appends the shared product cards to any lazy grid, keyed by product id so
 * recomposition and state survive batch appends.
 */
fun LazyGridScope.productCardItems(
  products: List<CatalogProduct>,
  onOpenProduct: (String) -> Unit,
  /**
   * Favourite state for one product. Defaults to the flag the server put on the
   * row, so a grid that does not observe the favourites store still renders a
   * truthful heart.
   */
  isFavorite: (CatalogProduct) -> Boolean = { it.isFavorite },
  isFavoritePending: (CatalogProduct) -> Boolean = { false },
  /** Null hides the control: not every grid offers favouriting. */
  onToggleFavorite: ((String) -> Unit)? = null,
) {
  items(products, key = { it.id }) { product ->
    ProductCard(
      product = product,
      onClick = { onOpenProduct(product.id) },
      isFavorite = isFavorite(product),
      favoritePending = isFavoritePending(product),
      onToggleFavorite = onToggleFavorite?.let { toggle -> { toggle(product.id) } },
      modifier = Modifier.fillMaxWidth(),
    )
  }
}

/**
 * The responsive product grid: two columns on a phone, more as the window
 * widens, with no hardcoded breakpoint — [GridCells.Adaptive] derives the
 * count from the available width and the card's minimum size.
 *
 * Used by the catalogue screen; the home screen appends [productCardItems] to
 * its own sectioned grid so rails and cards share one scroller.
 */
@Composable
fun ProductGrid(
  products: List<CatalogProduct>,
  onOpenProduct: (String) -> Unit,
  modifier: Modifier = Modifier,
  state: LazyGridState = rememberLazyGridState(),
  contentPadding: PaddingValues = PaddingValues(
    horizontal = MaharaniDimens.pageGutter,
    vertical = MaharaniDimens.spaceSm,
  ),
  isFavorite: (CatalogProduct) -> Boolean = { it.isFavorite },
  isFavoritePending: (CatalogProduct) -> Boolean = { false },
  onToggleFavorite: ((String) -> Unit)? = null,
  /**
   * A slot drawn ABOVE the first card, inside the same scroller.
   *
   * The catalogue puts its filter controls here rather than pinning them: a
   * sticky control block plus a sticky search header left ~230dp of a 640dp
   * phone for the cards themselves, which is the "everything is chrome" look
   * this redesign removes. As a grid item the controls scroll away with the
   * content and come back when the shopper scrolls up.
   */
  header: (LazyGridScope.() -> Unit)? = null,
  footer: (LazyGridScope.() -> Unit)? = null,
) {
  LazyVerticalGrid(
    columns = GridCells.Adaptive(minSize = 158.dp),
    state = state,
    modifier = modifier.testTag(PRODUCT_GRID_TAG),
    contentPadding = contentPadding,
    horizontalArrangement = Arrangement.spacedBy(MaharaniDimens.cardGap),
    verticalArrangement = Arrangement.spacedBy(MaharaniDimens.cardGap),
  ) {
    header?.invoke(this)
    productCardItems(
      products = products,
      onOpenProduct = onOpenProduct,
      isFavorite = isFavorite,
      isFavoritePending = isFavoritePending,
      onToggleFavorite = onToggleFavorite,
    )
    footer?.invoke(this)
  }
}
