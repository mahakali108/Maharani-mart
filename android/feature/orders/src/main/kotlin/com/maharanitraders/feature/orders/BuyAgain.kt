package com.maharanitraders.feature.orders

import com.maharanitraders.core.model.PackAvailability
import com.maharanitraders.core.model.ProductDetail
import com.maharanitraders.core.model.ProductPackDetail

/** How many products the Buy again screen revalidates in one visit. */
const val MAX_BUY_AGAIN_ITEMS = 12

/** How many order-history pages Buy again reads (20 orders per page). */
const val BUY_AGAIN_ORDER_PAGES = 3

/**
 * One product this shop has bought before.
 *
 * [timesOrdered] and [lastPieces] are FACTS from the retailer's own order rows:
 * how many past orders contain this pack, and how many pieces the most recent
 * one covered. They are history, never a price — the current rate is read
 * separately, from the catalogue, before anything is offered for reorder.
 */
data class BuyAgainCandidate(
  val packId: String,
  val productId: String,
  val productName: String?,
  val packName: String?,
  /** Orders (of the pages read) that contained this pack. */
  val timesOrdered: Int,
  /** The placed-at stamp of the most recent order that contained it, as sent. */
  val lastOrderedAt: String,
  /** Pieces the most recent of those orders covered. */
  val lastPieces: Int,
)

/**
 * Today's facts for a previously bought pack — everything the screen needs to
 * answer "can I still buy this, at what price, in what minimum".
 *
 * Every figure came from `GET /catalog/products/{id}` for the signed-in
 * retailer, i.e. from the same pricing engine the cart uses. Nothing here is
 * carried over from the old order: the historical unit price is deliberately NOT
 * part of this type, because a rate from last month is exactly the number a
 * reorder must never quote.
 */
data class BuyAgainCurrent(
  val unitPricePaise: Long?,
  val mrpPaise: Long?,
  val moq: Int,
  val unitsPerCase: Int?,
  val derivedCasePricePaise: Long?,
  val lineTotalAtMoqPaise: Long?,
  val gstPercent: Double,
  val availability: PackAvailability,
  /** The pricing engine's own explanation when a pack cannot be sold. */
  val message: String?,
)

/** Where a Buy again row stands after revalidation. */
enum class BuyAgainStatus {
  /** The current pack state has not been read yet. */
  CHECKING,

  /** Priced and in stock: the row can be added to the cart. */
  READY,

  /** The server reports it out of stock, or has no pack at all any more. */
  UNAVAILABLE,

  /** The revalidation read failed, or the server priced it without a rate. */
  UNKNOWN,
}

/** One Buy again row: the history, and today's revalidated facts. */
data class BuyAgainItem(
  val candidate: BuyAgainCandidate,
  val current: BuyAgainCurrent? = null,
  val status: BuyAgainStatus = BuyAgainStatus.CHECKING,
) {
  val packId: String get() = candidate.packId

  /** The quantity the row starts at: never below the server's current MOQ. */
  fun suggestedQuantity(): Int {
    val moq = current?.moq ?: 1
    return candidate.lastPieces.coerceAtLeast(moq).coerceAtLeast(1)
  }
}

/**
 * What this shop buys most often, newest first, from real order rows.
 *
 * HOW THE ORDER IS DECIDED
 * Two keys, both from the order history itself: how many past orders contain
 * the pack, then how recently it was bought. "Frequently ordered" therefore
 * means *this retailer's* frequency — there is no popularity signal, no
 * cross-shop ranking and nothing synthesised on the device.
 *
 * Lines with no pack id are skipped rather than guessed at: a pack the server
 * no longer exposes cannot be reordered, and matching it by product name would
 * be a guess wearing the clothes of a fact.
 *
 * [orders] is expected newest-first, as `GET /orders` returns it.
 */
fun buyAgainCandidates(
  orders: List<RetailerOrder>,
  limit: Int = MAX_BUY_AGAIN_ITEMS,
): List<BuyAgainCandidate> {
  val counts = LinkedHashMap<String, Int>()
  val firstSeen = LinkedHashMap<String, Int>()
  val newest = LinkedHashMap<String, BuyAgainCandidate>()

  orders.forEachIndexed { index, order ->
    // One pack per order at most: buying the same pack twice in one order is
    // one "time ordered", not two.
    val seenInOrder = HashSet<String>()
    for (item in order.items) {
      val packId = item.packId ?: continue
      val pieces = item.reorderPieces
      if (pieces <= 0) continue
      if (!seenInOrder.add(packId)) continue
      counts[packId] = (counts[packId] ?: 0) + 1
      firstSeen.putIfAbsent(packId, index)
      // The first order to mention the pack is the most recent one, so its
      // pieces are the suggestion and its date is "last ordered".
      if (!newest.containsKey(packId)) {
        newest[packId] = BuyAgainCandidate(
          packId = packId,
          productId = item.productId,
          productName = item.productName,
          packName = item.packName,
          timesOrdered = 0,
          lastOrderedAt = order.placedAt,
          lastPieces = pieces,
        )
      }
    }
  }

  return newest.values
    .map { candidate -> candidate.copy(timesOrdered = counts[candidate.packId] ?: 1) }
    .sortedWith(
      compareByDescending<BuyAgainCandidate> { it.timesOrdered }
        .thenBy { firstSeen[it.packId] ?: Int.MAX_VALUE },
    )
    .take(limit)
}

/**
 * Revalidate one row against the product the server just returned.
 *
 * The pack is looked up by the id the order stored. A pack the server no longer
 * publishes is [BuyAgainStatus.UNAVAILABLE] — never matched to a different pack
 * of the same product, because a different pack is a different price, size and
 * minimum, and reordering it would silently change what the shop receives.
 *
 * A pack the server priced WITHOUT a rate is [BuyAgainStatus.UNKNOWN] rather
 * than "free": the app refuses to offer a row it cannot price, and shows the
 * pricing engine's own explanation when it sent one.
 */
fun revalidateBuyAgainItem(item: BuyAgainItem, detail: ProductDetail): BuyAgainItem {
  val pack: ProductPackDetail? = detail.packs.firstOrNull { it.packId == item.packId }
  if (pack == null) {
    return item.copy(
      current = null,
      status = BuyAgainStatus.UNAVAILABLE,
    )
  }
  val current = BuyAgainCurrent(
    unitPricePaise = pack.unitPricePaise,
    mrpPaise = pack.mrpPaise,
    moq = pack.moq.coerceAtLeast(1),
    unitsPerCase = pack.unitsPerCase.takeIf { it > 0 },
    derivedCasePricePaise = pack.derivedCasePricePaise,
    lineTotalAtMoqPaise = pack.lineTotalAtMoqPaise,
    gstPercent = pack.gstPercent,
    availability = pack.availability,
    message = pack.message,
  )
  val status = when {
    pack.availability == PackAvailability.OUT_OF_STOCK -> BuyAgainStatus.UNAVAILABLE
    pack.unitPricePaise == null -> BuyAgainStatus.UNKNOWN
    pack.availability == PackAvailability.IN_STOCK -> BuyAgainStatus.READY
    else -> BuyAgainStatus.UNKNOWN
  }
  return item.copy(current = current, status = status)
}
