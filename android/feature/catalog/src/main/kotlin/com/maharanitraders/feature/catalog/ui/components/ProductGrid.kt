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
) {
  items(products, key = { it.id }) { product ->
    ProductCard(
      product = product,
      onClick = { onOpenProduct(product.id) },
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
    productCardItems(products, onOpenProduct)
    footer?.invoke(this)
  }
}
