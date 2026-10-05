package com.maharanitraders.feature.engagement

import com.maharanitraders.core.common.AppResult

/**
 * Test double for [EngagementRepository]. Returns pre-configured results.
 */
class FakeEngagementRepository : EngagementRepository {

  var notificationsResult: AppResult<NotificationPage> = AppResult.Success(
    NotificationPage(items = emptyList(), nextCursor = null, hasMore = false),
  )
  var markReadResult: AppResult<Int> = AppResult.Success(0)
  var walletSummaryResult: AppResult<WalletSummary> = AppResult.Success(
    WalletSummary(coinsFundedPaise = 0, coinsSpentPaise = 0, hasConfiguredLimit = false, isOverLimit = false, allowOverdue = false),
  )
  var walletLedgerResult: AppResult<WalletLedgerPage> = AppResult.Success(
    WalletLedgerPage(entries = emptyList(), nextCursor = null, hasMore = false, total = 0),
  )
  var couponsResult: AppResult<CouponsState> = AppResult.Success(CouponsState())

  override suspend fun loadNotifications(cursor: String?, unreadOnly: Boolean): AppResult<NotificationPage> =
    notificationsResult

  override suspend fun markNotificationsRead(ids: List<String>): AppResult<Int> =
    markReadResult

  override suspend fun loadWalletSummary(): AppResult<WalletSummary> =
    walletSummaryResult

  override suspend fun loadWalletLedger(cursor: String?): AppResult<WalletLedgerPage> =
    walletLedgerResult

  override suspend fun loadCoupons(): AppResult<CouponsState> =
    couponsResult
}