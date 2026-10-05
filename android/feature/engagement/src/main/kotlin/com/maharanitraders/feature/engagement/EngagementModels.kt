package com.maharanitraders.feature.engagement

/**
 * Domain models for the engagement features: notifications, coins and
 * coupons. All values are server-authoritative.
 */

// ---- Notifications ----

data class AppNotification(
  val id: String,
  val title: String,
  val body: String,
  val linkUrl: String?,
  val isRead: Boolean,
  val createdAt: String,
)

data class NotificationPage(
  val items: List<AppNotification>,
  val nextCursor: String?,
  val hasMore: Boolean,
  /**
   * The caller's exact unread total, as the server reported it on the FIRST
   * page. Null on cursor pages (the server does not re-count) and null when an
   * older server does not send it — in both cases the app says "at least",
   * never "all read".
   */
  val unreadCount: Int? = null,
)

// ---- Coins ----

/**
 * The shop's COIN position. Maharani Traders has no retailer credit: a
 * shopkeeper has coins, funded by the distributor and spent on orders, where
 * 1 coin = ₹1.
 *
 * The transport still calls the funded amount `creditLimitPaise` and the spent
 * amount `outstandingPaise` — those are the wire names in
 * `GET /api/mobile/v1/wallet` and renaming them would break the contract with
 * the deployed server. The rename stops at this boundary: from here inward,
 * and everywhere a shopkeeper can read, the app speaks coins.
 */
data class WalletSummary(
  /** Coins funded to this account, in paise. Wire name: `creditLimitPaise`. */
  val coinsFundedPaise: Long,
  /** Coins already spent on orders, in paise. Wire name: `outstandingPaise`. */
  val coinsSpentPaise: Long,
  val hasConfiguredLimit: Boolean,
  val isOverLimit: Boolean,
  val allowOverdue: Boolean,
) {

  /**
   * Spendable coins. NEVER negative.
   *
   * This is `coinBalancePaise()` from `lib/coins/math.ts`, written once more in
   * Kotlin: `max(0, funded − spent)`. The server's own `availablePaise` is the
   * same subtraction WITHOUT the clamp, so a shop that has spent past its
   * funded amount reports a negative number there. Rendering that as a balance
   * would tell a shopkeeper they owe coins, which is not what the coin model
   * means — so the unclamped value is deliberately not carried into the app.
   */
  val coinBalancePaise: Long get() = (coinsFundedPaise - coinsSpentPaise).coerceAtLeast(0)
}

/**
 * Coin vocabulary for ledger rows.
 *
 * These are the SAME strings the PWA shows (`TX_TYPE_LABELS` in
 * `components/retailer/wallet-ledger-list.tsx`), so the two clients describe
 * one movement identically. An unrecognised type falls back to the raw value
 * rather than being hidden or guessed at.
 */
object CoinVocabulary {

  private val typeLabels = mapOf(
    "ORDER_DEBIT" to "Coins spent",
    "PAYMENT_CREDIT" to "Coins added",
    "REFUND_CREDIT" to "Coins refunded",
    "MANUAL_CREDIT" to "Coins added",
    "MANUAL_DEBIT" to "Coins removed",
    "ORDER_REVERSAL" to "Coins refunded",
    "ADJUSTMENT" to "Coin adjustment",
    "CREDIT_LIMIT_CHANGE" to "Coins funded",
  )

  fun typeLabel(type: String): String =
    typeLabels[type.uppercase()] ?: type.replace('_', ' ')

  /** Whether this movement ADDS coins, from the ledger's own direction field. */
  fun addsCoins(direction: String): Boolean = direction.equals("credit", ignoreCase = true)
}

data class WalletLedgerEntry(
  val id: String,
  val type: String,
  val amountPaise: Long,
  val direction: String,
  val description: String,
  val reason: String?,
  val referenceType: String?,
  val referenceId: String?,
  val isReversed: Boolean,
  val createdAt: String,
)

data class WalletLedgerPage(
  val entries: List<WalletLedgerEntry>,
  val nextCursor: String?,
  val hasMore: Boolean,
  val total: Int,
)

// ---- Favorites ----
//
// Intentionally absent: favourite state is owned by
// `com.maharanitraders.feature.catalog.FavoritesStore`, the single source of
// truth every surface reads. See EngagementRepository's note.

// ---- Coupons ----

data class CouponItem(
  val id: String,
  val code: String,
  val title: String,
  val description: String?,
  val discountType: String,
  val discountValue: Double,
  val minimumOrderValue: Double,
  val maximumDiscount: Double?,
  val startsAt: String?,
  val expiresAt: String?,
  val firstOrderOnly: Boolean,
  val section: String,
)

data class CouponsState(
  val coupons: List<CouponItem> = emptyList(),
)