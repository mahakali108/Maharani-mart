package com.maharanitraders.feature.orders

import com.maharanitraders.core.designsystem.MoneyFormat

/** What changed about a cart line between two server answers. */
enum class CartNoticeKind {
  /** The server re-priced the line (a price, slab or pack change). */
  PRICE_CHANGED,

  /** The server's availability answer for the pack changed. */
  STOCK_CHANGED,

  /** The server now refuses the line, with its own reason. */
  NOT_ORDERABLE,
}

/** One warning the cart must show before the shopper checks out. */
data class CartLineNotice(
  val lineId: String,
  val productName: String,
  val kind: CartNoticeKind,
  /** The explanation, built from the two server answers or the server's words. */
  val detail: String,
)

/**
 * What the server changed in this shopper's basket, line by line.
 *
 * WHY THIS IS A DIFF OF TWO SERVER ANSWERS
 * The cart is the server's, and it is re-priced on every read: a nightly price
 * change, a stock-out or a withdrawn pack all arrive as an ordinary cart
 * response. If the app just replaced the numbers, the shopper would see a
 * different total than the one they added and would have no way to tell what
 * moved. Comparing the two SNAPSHOTS THE SERVER SENT is the honest way to say
 * "this line changed" — nothing here is inferred from a rule the app invented,
 * and no price is ever recomputed on the device.
 *
 * A line that vanished is deliberately NOT reported: a disappearance is either a
 * removal this shopper made (which needs no warning) or a server-side change the
 * cart endpoint has already answered with its own message, and guessing which
 * would put a false alarm on the screen.
 */
fun cartNotices(before: List<CartLine>, after: List<CartLine>): List<CartLineNotice> {
  if (before.isEmpty()) return emptyList()
  val previous = before.associateBy { it.id }
  val notices = mutableListOf<CartLineNotice>()

  for (line in after) {
    val old = previous[line.id] ?: continue
    val name = line.productName ?: line.packName ?: "This item"

    // Price: only when BOTH answers carried a rate. A null either side means
    // "could not price", which is the NOT_ORDERABLE case below, not a change.
    val oldPrice = old.unitPricePaise
    val newPrice = line.unitPricePaise
    if (oldPrice != null && newPrice != null && oldPrice != newPrice) {
      notices += CartLineNotice(
        lineId = line.id,
        productName = name,
        kind = CartNoticeKind.PRICE_CHANGED,
        detail = "Price updated by the server: ${MoneyFormat.formatPaiseShort(oldPrice)} → " +
          "${MoneyFormat.formatPaiseShort(newPrice)} per piece.",
      )
    }

    if (old.availability != line.availability) {
      notices += CartLineNotice(
        lineId = line.id,
        productName = name,
        kind = CartNoticeKind.STOCK_CHANGED,
        detail = when (line.availability) {
          "in_stock" -> "Back in stock."
          "out_of_stock" -> "Now out of stock — remove it or check back soon."
          else -> "Stock could not be confirmed right now."
        },
      )
    }

    // The server's own refusal (below minimum, withdrawn pack, unpriced).
    if (!line.orderable && line.message != null && line.message != old.message) {
      notices += CartLineNotice(
        lineId = line.id,
        productName = name,
        kind = CartNoticeKind.NOT_ORDERABLE,
        detail = line.message,
      )
    }
  }

  return notices
}
