package com.maharanitraders.feature.engagement

import com.maharanitraders.core.common.AppResult
import com.maharanitraders.core.common.map
import com.maharanitraders.core.network.ApiCallExecutor
import com.maharanitraders.core.network.MaharaniApi
import com.maharanitraders.core.network.dto.MarkReadRequestDto
import com.maharanitraders.core.network.dto.MobileNotificationDto
import com.maharanitraders.core.network.dto.MobileWalletLedgerEntryDto
import com.maharanitraders.core.network.dto.MobileCouponDto
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Reads engagement data from the server: notifications, wallet and coupons.
 * Every value is server-authoritative.
 *
 * Favourites deliberately live in `:feature:catalog`'s `FavoritesStore`, not
 * here. They were briefly implemented in both places, and two implementations
 * of "is this product saved" is exactly how a heart ends up disagreeing with
 * the server. Favourites are a catalogue concept, so the catalogue owns them
 * and every surface reads that one store.
 */
interface EngagementRepository {
  suspend fun loadNotifications(cursor: String?, unreadOnly: Boolean): AppResult<NotificationPage>
  suspend fun markNotificationsRead(ids: List<String>): AppResult<Int>
  suspend fun loadWalletSummary(): AppResult<WalletSummary>
  suspend fun loadWalletLedger(cursor: String?): AppResult<WalletLedgerPage>
  suspend fun loadCoupons(): AppResult<CouponsState>
}

@Singleton
class NetworkEngagementRepository @Inject constructor(
  private val api: MaharaniApi,
  private val executor: ApiCallExecutor,
) : EngagementRepository {

  override suspend fun loadNotifications(cursor: String?, unreadOnly: Boolean): AppResult<NotificationPage> =
    executor.execute {
      api.notifications(
        cursor = cursor?.trim()?.ifEmpty { null },
        unreadOnly = if (unreadOnly) "1" else null,
      )
    }.map { envelope ->
      NotificationPage(
        items = envelope.data.map(MobileNotificationDto::toDomain),
        nextCursor = envelope.page?.nextCursor,
        hasMore = envelope.page?.hasMore == true,
        unreadCount = envelope.meta?.unreadCount,
      )
    }

  override suspend fun markNotificationsRead(ids: List<String>): AppResult<Int> =
    executor.executeEnvelope {
      api.markNotificationsRead(MarkReadRequestDto(ids = ids))
    }.map { it.marked }

  override suspend fun loadWalletSummary(): AppResult<WalletSummary> =
    executor.executeEnvelope { api.walletSummary() }.map { dto ->
      WalletSummary(
        // Wire names in, coin names out. `availablePaise` is deliberately
        // dropped: it is `funded − spent` unclamped, and `coinBalancePaise`
        // recomputes it with the clamp the coin model requires.
        coinsFundedPaise = dto.creditLimitPaise,
        coinsSpentPaise = dto.outstandingPaise,
        hasConfiguredLimit = dto.hasConfiguredLimit,
        isOverLimit = dto.isOverLimit,
        allowOverdue = dto.allowOverdue,
      )
    }

  override suspend fun loadWalletLedger(cursor: String?): AppResult<WalletLedgerPage> =
    executor.execute {
      api.walletLedger(cursor = cursor?.trim()?.ifEmpty { null })
    }.map { envelope ->
      WalletLedgerPage(
        entries = envelope.data.map(MobileWalletLedgerEntryDto::toDomain),
        nextCursor = envelope.page?.nextCursor,
        hasMore = envelope.page?.hasMore == true,
        total = (envelope.meta?.resultCount ?: envelope.data.size),
      )
    }

  override suspend fun loadCoupons(): AppResult<CouponsState> =
    executor.executeEnvelope { api.coupons() }.map { dto ->
      CouponsState(
        coupons = dto.coupons
          .filter { it.section != "hidden" }
          .map(MobileCouponDto::toDomain),
      )
    }
}

private fun MobileNotificationDto.toDomain() = AppNotification(
  id = id,
  title = title,
  body = body,
  linkUrl = linkUrl,
  isRead = isRead,
  createdAt = createdAt,
)

private fun MobileWalletLedgerEntryDto.toDomain() = WalletLedgerEntry(
  id = id,
  type = type,
  amountPaise = amountPaise,
  direction = direction,
  description = description,
  reason = reason,
  referenceType = referenceType,
  referenceId = referenceId,
  isReversed = isReversed,
  createdAt = createdAt,
)

private fun MobileCouponDto.toDomain() = CouponItem(
  id = id,
  code = code,
  title = title,
  description = description,
  discountType = discountType,
  discountValue = discountValue,
  minimumOrderValue = minimumOrderValue,
  maximumDiscount = maximumDiscount,
  startsAt = startsAt,
  expiresAt = expiresAt,
  firstOrderOnly = firstOrderOnly,
  section = section,
)