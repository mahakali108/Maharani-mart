package com.maharanitraders.feature.engagement

import com.maharanitraders.core.common.AppResult
import com.maharanitraders.core.common.SessionScopedStore
import com.maharanitraders.core.common.map
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * The ONE source of the notifications badge.
 *
 * The count comes from `GET /api/mobile/v1/notifications`'s first-page meta
 * (`unreadCount`), which the server computes over the caller's own feed while
 * it serves the page. It is therefore exact, not "how many the app happened to
 * load" — the previous screen-level guess was the reason the badge could
 * undercount on a long feed.
 *
 * Null means "not known yet": the badge renders nothing rather than claiming
 * zero unread notifications before the server has spoken.
 */
@Singleton
class UnreadStore @Inject constructor(
  private val repository: EngagementRepository,
) : SessionScopedStore {

  private val _unreadCount = MutableStateFlow<Int?>(null)
  val unreadCount: StateFlow<Int?> = _unreadCount.asStateFlow()

  /** Record the exact count the server reported with a first page. */
  fun record(count: Int?) {
    if (count == null) return
    _unreadCount.value = count.coerceAtLeast(0)
  }

  /**
   * Re-read the first page purely for its `unreadCount` meta. A failure keeps
   * the last known value: a slightly stale badge is better than a badge that
   * silently says "all read".
   */
  suspend fun refresh(): AppResult<Int?> =
    repository.loadNotifications(cursor = null, unreadOnly = false).map { page ->
      record(page.unreadCount)
      _unreadCount.value
    }

  /**
   * Subtract notifications the server just confirmed as read. Never goes below
   * zero, and does nothing while the count is not yet known.
   */
  fun applyMarkedRead(marked: Int) {
    if (marked <= 0) return
    val current = _unreadCount.value ?: return
    _unreadCount.value = (current - marked).coerceAtLeast(0)
  }

  /** Session ended: clear the previous account's badge. */
  fun clear() {
    _unreadCount.value = null
  }

  /**
   * Session-scoped contract: the unread count belongs to the signed-in
   * recipient, so it goes back to "not known yet" with the session rather than
   * showing the previous account's number to the next one.
   */
  override suspend fun onSessionEnded() {
    clear()
  }
}
