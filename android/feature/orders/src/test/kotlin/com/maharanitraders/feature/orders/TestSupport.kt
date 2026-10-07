package com.maharanitraders.feature.orders

import com.maharanitraders.core.common.AppResult

/**
 * A favourites double for commerce tests.
 *
 * It records what the cart asked to save and answers `true` (saved) so a test
 * can assert the CALL rather than the outcome — the real store is exercised by
 * the catalogue's own tests, and the cart's job is only to name the product.
 */
class RecordingFavoriteToggler : FavoriteToggler {
  val toggled = mutableListOf<String>()
  var result: AppResult<Boolean> = AppResult.Success(true)

  override suspend fun toggle(productId: String): AppResult<Boolean> {
    toggled += productId
    return result
  }
}
