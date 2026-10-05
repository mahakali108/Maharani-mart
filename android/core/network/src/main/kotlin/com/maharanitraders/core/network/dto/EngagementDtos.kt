package com.maharanitraders.core.network.dto

import kotlinx.serialization.Serializable

/**
 * Wire models for the Phase F engagement endpoints:
 * notifications, wallet/coins, favorites and coupons.
 *
 * Every field matches the route handler response exactly.
 * Optional fields are defaulted so additive server changes
 * cannot crash an installed app.
 */

// ---- Notifications ----

@Serializable
data class MobileNotificationDto(
  val id: String,
  val title: String,
  val body: String,
  val linkUrl: String? = null,
  val isRead: Boolean = false,
  val createdAt: String,
)

@Serializable
data class MarkReadRequestDto(
  val ids: List<String>,
)

@Serializable
data class MarkReadResponseDto(
  val marked: Int,
)

// ---- Wallet / Coins ----

@Serializable
data class MobileWalletSummaryDto(
  val creditLimitPaise: Long,
  val outstandingPaise: Long,
  val availablePaise: Long,
  val hasConfiguredLimit: Boolean,
  val isOverLimit: Boolean,
  val allowOverdue: Boolean,
)

@Serializable
data class MobileWalletLedgerEntryDto(
  val id: String,
  val type: String,
  val amountPaise: Long,
  val direction: String,
  val description: String,
  val reason: String? = null,
  val referenceType: String? = null,
  val referenceId: String? = null,
  val isReversed: Boolean = false,
  val createdAt: String,
)

// ---- Favorites ----

@Serializable
data class MobileFavoritesDto(
  val productIds: List<String> = emptyList(),
)

@Serializable
data class FavoriteToggleRequestDto(
  val productId: String,
)

@Serializable
data class FavoriteToggleResponseDto(
  val isFavorite: Boolean,
)

// ---- Coupons ----

@Serializable
data class MobileCouponsDto(
  val coupons: List<MobileCouponDto> = emptyList(),
)

@Serializable
data class MobileCouponDto(
  val id: String,
  val code: String,
  val title: String,
  val description: String? = null,
  val discountType: String,
  val discountValue: Double,
  val minimumOrderValue: Double = 0.0,
  val maximumDiscount: Double? = null,
  val usageLimit: Int? = null,
  val perRetailerLimit: Int = 1,
  val startsAt: String? = null,
  val expiresAt: String? = null,
  val firstOrderOnly: Boolean = false,
  val isRetailerSpecific: Boolean = false,
  val section: String = "available",
)