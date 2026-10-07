package com.maharanitraders.feature.catalog

import com.maharanitraders.core.designsystem.MoneyFormat
import com.maharanitraders.core.model.PackAvailability
import com.maharanitraders.core.model.ProductDetail
import com.maharanitraders.core.model.ProductPackDetail

/**
 * One row of the product comparison table: a label and one value per product.
 *
 * A MISSING server value is the string "Not published" — never a dash that
 * reads as "zero" and never a value copied from another product. Comparison is
 * only useful when a blank stays visibly blank, so the row is drawn with what
 * the server published and nothing else.
 */
data class CompareRow(
  val label: String,
  val values: List<String>,
)

/** A product currently in the comparison tray. */
data class ComparedProduct(
  val id: String,
  val name: String,
  val brandName: String?,
  val imageUrl: String?,
)

/** What the server did not publish, in words a shopkeeper can read. */
const val NOT_PUBLISHED = "Not published"

/**
 * Product comparison, built ONLY from product rows the server returned.
 *
 * WHY THESE FIELDS AND NO OTHERS
 * The brief asks for the facts a wholesale buyer actually decides on: brand,
 * pack size, the per-piece rate, the case rate, the minimum, availability, GST
 * and lead time. Ratings, review counts, "popularity" and delivery estimates
 * are NOT compared because the backend publishes none of them for a retailer,
 * and inventing a column would be fabricating data.
 *
 * NOTHING IS COMPUTED HERE except the arithmetic-free formatting: the per-piece
 * and per-case figures are the rates the pricing engine returned for the pack,
 * and the GST figure is the product's own rate. The table never divides a case
 * price by a case size, because the server's own derived figure is the one the
 * cart will honour.
 */
object ProductCompare {

  /** Compare at most three products: more will not fit a phone, side by side. */
  const val MAX_PRODUCTS = 3

  /** Add (or remove) one product, refusing to grow past [MAX_PRODUCTS]. */
  fun toggle(selected: Set<String>, productId: String): Set<String> {
    if (productId.isBlank()) return selected
    if (productId in selected) return selected - productId
    if (selected.size >= MAX_PRODUCTS) return selected
    return selected + productId
  }

  fun rows(details: List<ProductDetail>): List<CompareRow> {
    if (details.isEmpty()) return emptyList()
    return listOf(
      CompareRow("Brand", details.map { it.brandName ?: NOT_PUBLISHED }),
      CompareRow("Pack size", details.map { packSize(it.pack) }),
      CompareRow("Price per piece", details.map { perPiece(it.pack) }),
      CompareRow("Price per case", details.map { perCase(it.pack) }),
      CompareRow("Minimum order", details.map { minimum(it.pack) }),
      CompareRow("Availability", details.map { availability(it.pack) }),
      CompareRow("GST", details.map { gst(it) }),
      CompareRow("Lead time", details.map { leadTime(it) }),
    )
  }

  private fun pack(detail: ProductDetail): ProductPackDetail? =
    detail.packs.firstOrNull { it.selected } ?: detail.packs.firstOrNull()

  private fun packSize(pack: ProductPackDetail?): String {
    if (pack == null) return NOT_PUBLISHED
    val name = pack.packName.takeIf { it.isNotBlank() } ?: return NOT_PUBLISHED
    return if (pack.unitsPerCase > 1) "$name · ${pack.unitsPerCase} pcs/case" else name
  }

  private fun perPiece(pack: ProductPackDetail?): String {
    val price = pack?.unitPricePaise ?: return NOT_PUBLISHED
    return "${MoneyFormat.formatPaiseShort(price)} / pc"
  }

  private fun perCase(pack: ProductPackDetail?): String {
    val price = pack?.derivedCasePricePaise ?: return NOT_PUBLISHED
    val size = pack.unitsPerCase.takeIf { it > 1 } ?: return NOT_PUBLISHED
    return "${MoneyFormat.formatPaiseShort(price)} / case of $size"
  }

  private fun minimum(pack: ProductPackDetail?): String {
    if (pack == null) return NOT_PUBLISHED
    return "${pack.moq.coerceAtLeast(1)} pcs"
  }

  private fun availability(pack: ProductPackDetail?): String = when {
    pack == null -> NOT_PUBLISHED
    pack.availability == PackAvailability.IN_STOCK -> "In stock"
    pack.availability == PackAvailability.OUT_OF_STOCK -> "Out of stock"
    else -> "Not confirmed"
  }

  private fun gst(detail: ProductDetail): String {
    val value = detail.gstPercent
    if (value <= 0.0) return NOT_PUBLISHED
    val rounded = Math.round(value * 100.0) / 100.0
    return "${trimFraction(rounded)}%"
  }

  private fun leadTime(detail: ProductDetail): String =
    if (detail.leadTimeDays > 0) "${detail.leadTimeDays} day(s)" else NOT_PUBLISHED

  /** `5.0` → `5`, `12.5` → `12.5`. Never leaks binary float noise. */
  private fun trimFraction(value: Double): String {
    val text = value.toString()
    return if (text.endsWith(".0")) text.dropLast(2) else text
  }
}
