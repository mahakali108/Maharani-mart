package com.maharanitraders.core.designsystem.labels

import com.maharanitraders.core.model.PackAvailability

/**
 * Display copy for the catalogue's server-provided vocabulary.
 *
 * Labels only — the two-state availability vocabulary and the sort orders come
 * from the wire and are never re-derived here. An availability value this build
 * does not know is [PackAvailability.UNKNOWN] by the time it reaches the model,
 * and its label says plainly that stock could not be confirmed: it is never
 * dressed up as "in stock".
 */
fun PackAvailability.label(): String = when (this) {
  PackAvailability.IN_STOCK -> "In stock"
  PackAvailability.OUT_OF_STOCK -> "Out of stock"
  PackAvailability.UNKNOWN -> "Stock not confirmed"
}
