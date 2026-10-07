package com.maharanitraders.feature.orders

import com.maharanitraders.core.common.AppResult

/**
 * Writes to the app's ONE favourites store.
 *
 * The cart's "save for later, save to favourites" action must land in the same
 * place the catalogue's hearts read from, or a line moved out of the basket
 * would not show as saved on the product page. This interface is the seam that
 * lets `:feature:orders` ask for that write without depending on the catalogue
 * screen code — the binding in `OrdersFeatureModule` points it at
 * `FavoritesStore`, which is the single owner of favourite state.
 */
interface FavoriteToggler {
  /**
   * Save (or unsave) a product. Returns the server's answer, so the caller can
   * never claim a favourite that was not saved.
   */
  suspend fun toggle(productId: String): AppResult<Boolean>
}
