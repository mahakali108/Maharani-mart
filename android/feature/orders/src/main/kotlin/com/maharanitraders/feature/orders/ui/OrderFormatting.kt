package com.maharanitraders.feature.orders.ui

/**
 * Display formatting shared by the order-journey screens.
 *
 * `formatPercent` lives here rather than in the first screen that needed it,
 * because the cart, the order detail and the invoice all print the same
 * server-sent GST rate: one definition keeps them from drifting apart.
 *
 * The rounding matches what `:feature:catalog`'s product detail already does
 * with the same server value, so 12.5 reads "12.5%" on every surface and a
 * `numeric` value that arrives as 12.499999999 does not leak its float noise.
 */
internal fun formatPercent(value: Double): String {
  val rounded = Math.round(value * 100.0) / 100.0
  return if (rounded == Math.floor(rounded)) {
    "${rounded.toInt()}%"
  } else {
    "$rounded%"
  }
}
