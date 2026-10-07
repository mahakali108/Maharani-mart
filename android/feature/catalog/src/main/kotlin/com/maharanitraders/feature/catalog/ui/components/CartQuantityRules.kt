package com.maharanitraders.feature.catalog.ui.components

import com.maharanitraders.core.model.CatalogPack
import com.maharanitraders.core.model.PackAvailability

/**
 * Local guardrails for the quantity selector.
 *
 * These checks make the interaction understandable, but they are NOT the cart
 * authority: every write still sends only `packId` and `quantity` to the real
 * cart endpoint, which re-prices the pack and re-checks its current MOQ and
 * stock. The catalogue API intentionally exposes a stock status, not a numeric
 * available-unit count, so this class never invents a client-side stock cap.
 */
object CartQuantityRules {
  /** The mobile cart endpoint's documented per-line upper bound. */
  const val MAX_QUANTITY: Int = 100_000

  /** A missing MOQ means the endpoint's baseline minimum: one piece. */
  fun minimum(pack: CatalogPack): Int = (pack.moq ?: 1).coerceAtLeast(1)

  /** Begin at the server MOQ, unless that MOQ exceeds the API's own upper bound. */
  fun initial(pack: CatalogPack): Int = minimum(pack).coerceAtMost(MAX_QUANTITY)

  fun canDecrement(pack: CatalogPack, quantity: Int): Boolean = quantity > minimum(pack)

  fun canIncrement(quantity: Int): Boolean = quantity < MAX_QUANTITY

  fun decrement(pack: CatalogPack, quantity: Int): Int =
    if (quantity <= minimum(pack)) minimum(pack) else quantity - 1

  fun increment(quantity: Int): Int =
    if (quantity >= MAX_QUANTITY) MAX_QUANTITY else (quantity + 1).coerceAtLeast(1)

  /**
   * Return a user-facing reason when an intent is locally invalid.
   *
   * `UNKNOWN` stock remains sendable: the API will check availability when the
   * shopper adds it. `OUT_OF_STOCK` and a missing server price are not orderable.
   */
  fun validationMessage(pack: CatalogPack, quantity: Int): String? = when {
    minimum(pack) > MAX_QUANTITY ->
      "The minimum order for this pack exceeds the allowed quantity."
    quantity < minimum(pack) ->
      "Minimum order for this pack is ${minimum(pack)} pieces."
    quantity > MAX_QUANTITY ->
      "Quantity cannot exceed $MAX_QUANTITY pieces."
    pack.availability == PackAvailability.OUT_OF_STOCK ->
      "This pack is out of stock."
    pack.unitPricePaise == null ->
      "Price is unavailable for this pack."
    else -> null
  }
}
