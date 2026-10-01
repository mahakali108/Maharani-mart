package com.maharanitraders.core.auth

import com.maharanitraders.core.common.AppError
import com.maharanitraders.core.common.AppResult
import com.maharanitraders.core.common.TimeSource
import com.maharanitraders.core.model.AccountGate
import com.maharanitraders.core.network.ApiCallExecutor
import com.maharanitraders.core.network.MaharaniApi
import com.maharanitraders.core.network.TokenProvider
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * What the app shell is allowed to ask of the session layer.
 * (An interface, so view models can be tested without the network or a device.)
 */
interface SessionController {

  val state: StateFlow<SessionState>

  /**
   * In-memory access token for the network layer's
   * [com.maharanitraders.core.network.TokenProvider]. Reads from memory only —
   * never from disk — and is `null` whenever no verified session is active.
   */
  fun accessToken(): String?

  /** Read stored tokens, validate them with the server, publish the result. */
  suspend fun restore(): SessionState

  /** Forget the session locally. Server-side revocation is Phase C. */
  suspend fun signOut()
}

/**
 * THE single source of truth for authentication state.
 *
 * Phase B behaviour (deliberately limited, and stated as such):
 *  - restores a stored, unexpired session and validates it against
 *    `GET /api/mobile/v1/session`;
 *  - clears stored tokens when the server says the token is gone;
 *  - keeps tokens for account gates (pending approval / lapsed access period)
 *    so the user can retry without retyping credentials;
 *  - does NOT refresh tokens (that is Phase C, together with sign-in) — an
 *    expired token leads to [SignOutReason.SESSION_EXPIRED] rather than a
 *    silent failure.
 *
 * It also implements [TokenProvider], so the network layer reads the token from
 * memory only and never from disk on the request path.
 */
@Singleton
class SessionManager @Inject constructor(
  private val api: MaharaniApi,
  private val tokenStore: TokenStore,
  private val executor: ApiCallExecutor,
  private val mapper: SessionMapper,
  private val timeSource: TimeSource,
) : SessionController, TokenProvider {

  private val _state = MutableStateFlow<SessionState>(SessionState.Restoring)
  override val state: StateFlow<SessionState> = _state.asStateFlow()

  @Volatile
  private var activeAccessToken: String? = null

  override fun accessToken(): String? = activeAccessToken

  override suspend fun restore(): SessionState {
    _state.value = SessionState.Restoring

    val tokens = try {
      tokenStore.read()
    } catch (cancellation: CancellationException) {
      throw cancellation
    } catch (_: Exception) {
      null
    }
    if (tokens == null) {
      clearActiveToken()
      return publish(SessionState.SignedOut(SignOutReason.NEVER_SIGNED_IN))
    }

    if (tokens.isExpiredAt(timeSource.nowEpochSeconds())) {
      // Phase C refreshes here; until then an expired token means sign-in again.
      clearStoredSession()
      return publish(SessionState.SignedOut(SignOutReason.SESSION_EXPIRED))
    }

    return when (val result = executor.executeEnvelope { api.session() }) {
      is AppResult.Success -> {
        val snapshot = mapper.toSnapshot(result.value)
        if (snapshot == null) {
          clearStoredSession()
          publish(SessionState.SignedOut(SignOutReason.UNSUPPORTED_ACCOUNT))
        } else {
          // The network layer may now use the token: this is the only place the
          // in-memory token is ever set.
          activeAccessToken = tokens.accessToken
          publish(SessionState.Authenticated(snapshot))
        }
      }

      is AppResult.Failure -> publish(handleFailure(result.error))
    }
  }

  override suspend fun signOut() {
    clearStoredSession()
    publish(SessionState.SignedOut(SignOutReason.SIGNED_OUT))
  }

  /**
   * Failure policy:
   *  - token failures  → tokens are gone, so clear them and require sign-in;
   *  - suspension / deactivation → clear (the account cannot be used);
   *  - pending approval / lapsed access → KEEP tokens (recoverable states);
   *  - network / server problems → keep tokens and offer retry.
   */
  private suspend fun handleFailure(error: AppError): SessionState {
    // Whatever the reason, the token must not stay available to the network
    // layer: a failed verification means "no verified session".
    clearActiveToken()

    return when (error) {
      is AppError.Network -> SessionState.Unavailable(error.message, error.retryable)
      is AppError.Unexpected -> SessionState.Unavailable(error.message, error.retryable)
      is AppError.Api -> handleApiFailure(error)
    }
  }

  /**
   * API failure policy:
   *  - token failures   → the token is dead, clear it and require sign-in;
   *  - suspension / deactivation → clear (the account cannot be used at all);
   *  - pending approval / lapsed access → KEEP the tokens (recoverable states the
   *    user can resolve and then retry without re-entering credentials);
   *  - anything else → keep the session and offer a retry.
   */
  private suspend fun handleApiFailure(error: AppError.Api): SessionState {
    if (error.requiresSignIn) {
      clearStoredSession()
      return SessionState.SignedOut(SignOutReason.SESSION_EXPIRED)
    }

    return when (error.gate) {
      AccountGate.PENDING_APPROVAL -> SessionState.SignedOut(SignOutReason.PENDING_APPROVAL)
      AccountGate.ACCESS_EXPIRED -> SessionState.SignedOut(SignOutReason.ACCESS_EXPIRED)
      AccountGate.SUSPENDED -> {
        clearStoredSession()
        SessionState.SignedOut(SignOutReason.ACCOUNT_SUSPENDED)
      }
      AccountGate.INACTIVE -> {
        clearStoredSession()
        SessionState.SignedOut(SignOutReason.ACCOUNT_INACTIVE)
      }
      null -> SessionState.Unavailable(error.message, error.retryable)
    }
  }

  private fun publish(state: SessionState): SessionState {
    _state.value = state
    return state
  }

  private suspend fun clearStoredSession() {
    clearActiveToken()
    try {
      tokenStore.clear()
    } catch (cancellation: CancellationException) {
      throw cancellation
    } catch (_: Exception) {
      // A failed local wipe must not block sign-out: the token is already
      // unusable in memory, and the next restore re-validates with the server.
    }
  }

  private fun clearActiveToken() {
    activeAccessToken = null
  }
}
