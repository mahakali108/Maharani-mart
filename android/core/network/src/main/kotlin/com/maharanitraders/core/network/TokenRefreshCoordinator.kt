package com.maharanitraders.core.network

import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * The one place an expired access token is exchanged for a fresh one WHILE the
 * app is running.
 *
 * WHY THIS EXISTS SEPARATELY FROM `SessionManager`
 * The launch-time refresh lives in the session layer, which needs `MaharaniApi`
 * to call `POST /auth/refresh`. The API client cannot depend on the session layer
 * (that is the dependency cycle [ActiveTokenHolder] documents), so the session
 * layer installs its refresh block here instead — the same inversion that lets
 * the interceptor read the token without knowing who wrote it.
 *
 * WHAT IT GUARANTEES
 *  - at most ONE refresh at a time, and no second refresh for callers whose
 *    failed request already used the token that refresh replaced (so ten
 *    parallel calls that all saw 401 cost one refresh, not ten);
 *  - a caller that arrives while an exchange is genuinely in flight is answered
 *    `null` rather than queued: its request reports the original 401, and the
 *    retry it offers runs with the fresh token already in the holder;
 *  - no recursion: a refresh that itself answers 401 cannot start another
 *    refresh — it returns `null` and the original failure is reported;
 *  - no refresh at all while signed out, because no block has been installed
 *    with usable tokens (the block answers `null`).
 *
 * This class holds no token of its own: the access token lives in
 * [ActiveTokenHolder] and the refresh token stays in the encrypted store the
 * session layer owns. Nothing here can be logged or serialised.
 */
@Singleton
class TokenRefreshCoordinator @Inject constructor() {

  private val mutex = Mutex()

  /** Installed by the session layer; `null` until then (or after it is removed). */
  @Volatile
  private var refreshBlock: (suspend () -> String?)? = null

  /** The token the last successful refresh produced, if any. */
  @Volatile
  private var lastRefreshedToken: String? = null

  /** True while a refresh is in flight, checked before the mutex to stop recursion. */
  @Volatile
  private var refreshing: Boolean = false

  /**
   * Install the session layer's refresh block. Called once, at construction of
   * the single `SessionManager`.
   */
  fun install(block: suspend () -> String?) {
    refreshBlock = block
  }

  /** True when a session layer has installed a refresher. */
  val installed: Boolean get() = refreshBlock != null

  /**
   * Forget the token cache. Called by the session layer whenever the active token
   * is dropped — sign-out, a rejected session, a terminal refresh failure — so an
   * id from one account can never be handed back on another account's request.
   */
  fun reset() {
    lastRefreshedToken = null
  }

  /**
   * Exchange the refresh token for a new access token.
   *
   * [failedAccessToken] is the token the calling request was sent with. When the
   * coordinator has already produced a different one, that token is returned and
   * no request is made: another caller refreshed while this one was failing.
   *
   * Returns the usable access token, or `null` when there is nothing to do or the
   * refresh could not produce one. A `null` answer is never proof that the
   * session is dead — the session layer decides that, and a network failure keeps
   * the stored tokens (see `SessionManager`).
   */
  suspend fun refresh(failedAccessToken: String?): String? {
    // A request that carried no token is not an expired-token case: there is
    // nothing to replace, and handing back a cached token would be wrong.
    if (failedAccessToken == null) return null
    if (refreshing) return null
    val block = refreshBlock ?: return null

    return mutex.withLock {
      // Re-check inside the lock: a caller that lost the race above may have
      // refreshed with a token this request never saw.
      if (refreshing) return@withLock null
      val alreadyRefreshed = lastRefreshedToken
      if (alreadyRefreshed != null && alreadyRefreshed != failedAccessToken) {
        return@withLock alreadyRefreshed
      }

      refreshing = true
      try {
        val fresh = block()
        if (fresh != null) lastRefreshedToken = fresh
        fresh
      } finally {
        refreshing = false
      }
    }
  }
}
