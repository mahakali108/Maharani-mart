package com.maharanitraders.feature.catalog

import com.maharanitraders.core.model.CatalogQuery

/**
 * The filter sheet's own vocabulary.
 *
 * WHY THIS FILE EXISTS
 * Every filter in here is a parameter the SERVER reads and resolves
 * (`lib/mobile/catalog.ts` → `parseCatalogQuery`, applied in
 * `lib/retailer/catalog-batches.ts`). The price band, the discount floor and the
 * MOQ ceiling all compare against the rate the pricing engine resolved for THIS
 * retailer — pack price, then any retailer/area override, then the slab table —
 * which does not exist on the device. So the sheet's only job is to collect a
 * well-formed bound and hand it over; it must never filter a loaded page itself,
 * because that would show a shopper a "filtered" list the server did not produce
 * and checkout would not honour.
 *
 * WHAT IS DELIBERATELY NOT HERE
 * No "pack" filter. The catalogue lists one priced pack per product (the
 * server's own `defaultPackId`), so a pack-size filter would have nothing to
 * filter on; pack choice lives on the product page, where every active pack is
 * priced. Inventing a pack filter here is exactly the kind of control that looks
 * real and does nothing.
 */

/** What applying the draft produced. */
sealed interface CatalogFilterOutcome {
  /** The query to send. One state change, one catalogue read. */
  data class Apply(val query: CatalogQuery) : CatalogFilterOutcome

  /**
   * The draft is not a filter the server could act on, with the sentence the
   * sheet shows. Refusing is the honest answer: sending `minPrice=abc` would be
   * dropped by the server's `parseOptionalNumber` and the shopper would see an
   * unfiltered list behind a control that looks applied.
   */
  data class Refused(val message: String) : CatalogFilterOutcome
}

/**
 * The sheet's editable state.
 *
 * Price bounds are TEXT while they are being edited (a half-typed "1" must not
 * be reformatted out from under the keyboard) and are only parsed on Apply. The
 * other filters are choices from a fixed list, so they are already typed.
 */
data class CatalogFilterDraft(
  val minPriceText: String = "",
  val maxPriceText: String = "",
  /** Whole percent off MRP, or null for "any discount". */
  val minDiscountPercent: Int? = null,
  /** Maximum minimum-order-quantity in pieces, or null for "any MOQ". */
  val maxMoq: Int? = null,
  val offersOnly: Boolean = false,
  val newOnly: Boolean = false,
  val inStockOnly: Boolean = false,
) {

  /** How many filters are actually narrowing the list — the button's badge. */
  val activeCount: Int
    get() = listOfNotNull(
      parseBound(minPriceText),
      parseBound(maxPriceText),
      minDiscountPercent?.takeIf { it > 0 },
      maxMoq?.takeIf { it > 0 },
    ).size + (if (offersOnly) 1 else 0) + (if (newOnly) 1 else 0) + (if (inStockOnly) 1 else 0)

  val isUntouched: Boolean get() = activeCount == 0

  /**
   * Fold this draft onto [base], which keeps the search term, the category/brand
   * scope and the sort — the sheet narrows a result set, it does not replace one.
   */
  fun applyTo(base: CatalogQuery): CatalogFilterOutcome {
    val min = minPriceText.trim()
    val max = maxPriceText.trim()

    val minBound = when {
      min.isEmpty() -> null
      else -> parseBound(min) ?: return CatalogFilterOutcome.Refused(PRICE_FORMAT_MESSAGE)
    }
    val maxBound = when {
      max.isEmpty() -> null
      else -> parseBound(max) ?: return CatalogFilterOutcome.Refused(PRICE_FORMAT_MESSAGE)
    }
    if (minBound != null && maxBound != null && minBound > maxBound) {
      return CatalogFilterOutcome.Refused(PRICE_RANGE_MESSAGE)
    }

    return CatalogFilterOutcome.Apply(
      base.copy(
        minPriceRupees = minBound,
        maxPriceRupees = maxBound,
        minDiscountPercent = minDiscountPercent?.takeIf { it > 0 },
        maxMoq = maxMoq?.takeIf { it > 0 },
        offersOnly = offersOnly,
        newOnly = newOnly,
        inStockOnly = inStockOnly,
      ),
    )
  }

  companion object {
    /**
     * The discount steps the sheet offers, in whole percent off the printed MRP.
     *
     * They live on the draft rather than at file scope so the sheet imports one
     * symbol — the draft — and cannot ask for a step list that the draft's own
     * `applyTo` does not understand.
     */
    val DISCOUNT_STEPS: List<Int> = listOf(5, 10, 20, 30, 50)

    /** The MOQ ceilings the sheet offers, in pieces. */
    val MOQ_STEPS: List<Int> = listOf(1, 2, 5, 10, 25)

    /**
     * The highest rupee bound the sheet accepts.
     *
     * Not a business rule — a guard against a pasted number that would make the
     * server's bounded working set (`CATALOG_MAX_ROWS`) do pointless work. It is
     * well above any wholesale line in this catalogue.
     */
    const val MAX_PRICE_BOUND_RUPEES = 1_000_000

    const val PRICE_FORMAT_MESSAGE =
      "Enter a whole rupee amount, or leave the box empty for no limit."
    const val PRICE_RANGE_MESSAGE =
      "The minimum price cannot be higher than the maximum."

    /** The draft that reflects an already-applied query, so the sheet reopens truthful. */
    fun from(query: CatalogQuery): CatalogFilterDraft = CatalogFilterDraft(
      minPriceText = query.minPriceRupees?.toString() ?: "",
      maxPriceText = query.maxPriceRupees?.toString() ?: "",
      minDiscountPercent = query.minDiscountPercent,
      maxMoq = query.maxMoq,
      offersOnly = query.offersOnly,
      newOnly = query.newOnly,
      inStockOnly = query.inStockOnly,
    )

    /**
     * Parse one rupee bound.
     *
     * `null` means "this text is not a usable bound" — the caller decides whether
     * that is a refusal (a non-empty box) or an absent filter (an empty one).
     * A leading ₹, commas and surrounding spaces are accepted because that is
     * what a shopkeeper pastes; anything else is refused rather than truncated
     * into a bound they did not type.
     */
    fun parseBound(text: String): Int? {
      val cleaned = text.trim().removePrefix("\u20B9").replace(",", "").trim()
      if (cleaned.isEmpty()) return null
      val value = cleaned.toIntOrNull() ?: return null
      if (value <= 0 || value > MAX_PRICE_BOUND_RUPEES) return null
      return value
    }
  }
}
