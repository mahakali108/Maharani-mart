package com.maharanitraders.feature.engagement

import com.maharanitraders.core.common.AppError
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
    WalletSummary(0, 0, 0, false, false, false),
  )
  var walletLedgerResult: AppResult<WalletLedgerPage> = AppResult.Success(
    WalletLedgerPage(entries = emptyList(), nextCursor = null, hasMore = false, total = 0),
  )
  var favoritesResult: AppResult<FavoritesState> = AppResult.Success(FavoritesState())
  var toggleResult: AppResult<Boolean> = AppResult.Success(false)
  var couponsResult: AppResult<CouponsState> = AppResult.Success(CouponsState())

  /** Every read the screen asked for, so a test can see WHICH query was run. */
  val notificationQueries: MutableList<Pair<String?, Boolean>> = mutableListOf()

  /** Every batch of ids the screen tried to mark read, in order. */
  val readBatches: MutableList<List<String>> = mutableListOf()

  override suspend fun loadNotifications(cursor: String?, unreadOnly: Boolean): AppResult<NotificationPage> {
    notificationQueries += cursor to unreadOnly
    return notificationsResult
  }

  override suspend fun markNotificationsRead(ids: List<String>): AppResult<Int> {
    readBatches += ids
    return markReadResult
  }

  override suspend fun loadWalletSummary(): AppResult<WalletSummary> =
    walletSummaryResult

  override suspend fun loadWalletLedger(cursor: String?): AppResult<WalletLedgerPage> =
    walletLedgerResult

  override suspend fun loadFavorites(): AppResult<FavoritesState> =
    favoritesResult

  override suspend fun toggleFavorite(productId: String): AppResult<Boolean> =
    toggleResult

  override suspend fun loadCoupons(): AppResult<CouponsState> =
    couponsResult
}