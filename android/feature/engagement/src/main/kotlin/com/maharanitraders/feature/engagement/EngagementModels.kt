package com.maharanitraders.feature.engagement

/**
 * Domain models for the engagement features: notifications, wallet,
 * favorites and coupons. All values are server-authoritative.
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
)

// ---- Wallet / Coins ----

data class WalletSummary(
  val creditLimitPaise: Long,
  val outstandingPaise: Long,
  val availablePaise: Long,
  val hasConfiguredLimit: Boolean,
  val isOverLimit: Boolean,
  val allowOverdue: Boolean,
) {
  val coinBalancePaise: Long get() = availablePaise.coerceAtLeast(0)
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