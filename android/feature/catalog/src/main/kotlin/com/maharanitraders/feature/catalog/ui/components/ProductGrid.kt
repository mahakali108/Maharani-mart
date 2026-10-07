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
  /**
   * Quick add to the cart, `(packId, quantity)`. Null hides the card's control
   * entirely — a surface with no cart behind it (or a non-retailer session)
   * passes null and the cards stay browse-only.
   */
  onQuickAddToCart: ((String, Int) -> Unit)? = null,
  /** Opens a quantity selector for this product instead of adding its MOQ directly. */
  onSelectQuantity: ((CatalogProduct) -> Unit)? = null,
  /** The pack whose add is in flight, so exactly one card shows a spinner. */
  quickAddPackId: String? = null,
  /** Null hides the control: not every grid offers comparison. */
  onToggleCompare: ((String) -> Unit)? = null,
  /** The products parked in the comparison tray. */
  compareIds: Set<String> = emptySet(),
  /** True when the tray has no room left, so a card can say so. */
  compareFull: Boolean = false,
) {
  items(products, key = { it.id }) { product ->
    ProductCard(
      product = product,
      onClick = { onOpenProduct(product.id) },
      isFavorite = isFavorite(product),
      favoritePending = isFavoritePending(product),
      onToggleFavorite = onToggleFavorite?.let { toggle -> { toggle(product.id) } },
      onAddToCart = if (onSelectQuantity == null) {
        onQuickAddToCart?.let { add ->
          {
            val pack = product.pack
            if (pack != null) add(pack.packId, quickAddQuantity(pack))
          }
        }
      } else {
        null
      },
      onSelectQuantity = onSelectQuantity?.let { select -> { select(product) } },
      addPending = quickAddPackId != null && quickAddPackId == product.pack?.packId,
      onToggleCompare = onToggleCompare?.let { toggle -> { toggle(product.id) } },
      compareSelected = product.id in compareIds,
      compareFull = compareFull,
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
  onQuickAddToCart: ((String, Int) -> Unit)? = null,
  /** Opens a quantity selector for this product instead of adding its MOQ directly. */
  onSelectQuantity: ((CatalogProduct) -> Unit)? = null,
  quickAddPackId: String? = null,
  /** Null hides the control: not every grid offers comparison. */
  onToggleCompare: ((String) -> Unit)? = null,
  /** The products parked in the comparison tray. */
  compareIds: Set<String> = emptySet(),
  /** True when the tray has no room left, so a card can say so. */
  compareFull: Boolean = false,
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
      onQuickAddToCart = onQuickAddToCart,
      onSelectQuantity = onSelectQuantity,
      quickAddPackId = quickAddPackId,
      onToggleCompare = onToggleCompare,
      compareIds = compareIds,
      compareFull = compareFull,
    )
    footer?.invoke(this)
  }
}
