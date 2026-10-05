package com.maharanitraders.feature.engagement

import com.maharanitraders.core.common.AppResult
import com.maharanitraders.core.common.map
import com.maharanitraders.core.network.ApiCallExecutor
import com.maharanitraders.core.network.MaharaniApi
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

/**
 * The two counters the authenticated shell paints: lines in the cart, unread
 * alerts. Exactly what `GET /api/mobile/v1/shell/badges` answers, and nothing
 * else — no cart rows, no notification bodies.
 */
data class ShellBadges(
  val cartCount: Int = 0,
  val unreadNotifications: Int = 0,
  val loading: Boolean = false,
  /** False until the first successful read: an unseen badge is not an empty one. */
  val loaded: Boolean = false,
)

/**
 * Where the shell counters come from.
 *
 * A seam rather than a convenience: [ShellBadgeStore]'s logic is "publish what the
 * server said, keep the last answer when the server did not answer", and that is
 * worth testing without an HTTP layer behind it.
 */
interface ShellBadgeSource {
  suspend fun fetch(): AppResult<BadgeCounts>
}

/** The raw pair, before the store decides what a failure means. */
data class BadgeCounts(
  val cartCount: Int,
  val unreadNotificationCount: Int,
)

@Singleton
class NetworkShellBadgeSource @Inject constructor(
  private val api: MaharaniApi,
  private val executor: ApiCallExecutor,
) : ShellBadgeSource {

  // `map` (not `mapCatching`) so a failure keeps its typed AppError: the store's
  // "keep the last count" rule depends on knowing the read failed at all.
  override suspend fun fetch(): AppResult<BadgeCounts> =
    executor.executeEnvelope { api.shellBadges() }.map { dto ->
      BadgeCounts(
        cartCount = dto.cartCount,
        unreadNotificationCount = dto.unreadNotificationCount,
      )
    }
}

/**
 * The shell's counters, held once for the whole signed-in surface.
 *
 * The bottom bar, the masthead and the drawer all show the same digit, so a
 * process-wide store keeps them from disagreeing with each other — and with the
 * cart underneath. Nothing is accumulated on the device: the value is whatever the
 * server last reported, refreshed when the shell resumes and when the shopper
 * leaves a screen that can change it. Never on a timer.
 *
 * A failed read deliberately leaves the LAST value in place instead of clearing it
 * to zero: a badge that blinks out because a request timed out tells the shopper
 * something untrue, while a stale count is at least a count they can act on.
 */
@Singleton
class ShellBadgeStore @Inject constructor(
  private val source: ShellBadgeSource,
) {

  private val _state = MutableStateFlow(ShellBadges())
  val state: StateFlow<ShellBadges> = _state.asStateFlow()

  /** Non-reentrant by design: concurrent triggers collapse into one read. */
  private var inFlight = false

  suspend fun refresh() {
    if (inFlight) return
    inFlight = true
    _state.update { it.copy(loading = true) }
    try {
      when (val result = source.fetch()) {
        is AppResult.Success -> _state.update {
          ShellBadges(
            // A negative count is not a fact about anything; 0 is what "none" is.
            cartCount = result.value.cartCount.coerceAtLeast(0),
            unreadNotifications = result.value.unreadNotificationCount.coerceAtLeast(0),
            loaded = true,
          )
        }

        is AppResult.Failure -> _state.update { it.copy(loading = false) }
      }
    } finally {
      inFlight = false
    }
  }

  /** Sign-out: the next account must not inherit this one's numbers. */
  fun clear() {
    _state.value = ShellBadges()
  }
}
