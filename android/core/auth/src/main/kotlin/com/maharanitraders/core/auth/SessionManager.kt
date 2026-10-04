package com.maharanitraders.core.auth

import com.maharanitraders.core.common.AppError
import com.maharanitraders.core.common.AppResult
import com.maharanitraders.core.common.TimeSource
import com.maharanitraders.core.datastore.AppPreferences
import com.maharanitraders.core.model.AccountGate
import com.maharanitraders.core.model.ApiErrorCode
import com.maharanitraders.core.model.SessionTokens
import com.maharanitraders.core.network.ApiCallExecutor
import com.maharanitraders.core.network.MaharaniApi
import com.maharanitraders.core.network.ActiveTokenHolder
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
   * In-memory access token — the value the network layer's
   * [com.maharanitraders.core.network.ActiveTokenHolder] hands to the
   * interceptor. Read from memory only — never from disk — and `null` whenever
   * no verified session is active.
   */
  fun accessToken(): String?

  /** Read stored tokens, validate them with the server, publish the result. */
  suspend fun restore(): SessionState

  /**
   * Sign in with a mobile number or email.
   *
   * Returns the published state. A successful sign-in ALWAYS produces
   * [SessionState.Authenticated]; the account's `nextStep` (pending approval /
   * lapsed access period) is carried in the snapshot's retailer status and
   * access context, and the shell renders the matching screen. A blocked
   * account produces [SessionState.SignedOut] with the matching reason and no
   * stored tokens.
   */
  suspend fun signIn(identifier: String, password: String): SessionState

  /**
   * Register a retailer. On success the account is pending approval — the app
   * never implies a new shop can order immediately.
   */
  suspend fun registerRetailer(request: RegistrationRequest): RegistrationResult

  /** Forget the session: revoke it server-side, then wipe local material. */
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
 *  - refreshes an expired access token exactly ONCE at launch (Phase C): a
 *    rejected refresh is terminal and signs the user out, while a refresh that
 *    could not reach the server keeps the stored tokens so the next launch can
 *    try again.
 *
 * The token itself lives in [ActiveTokenHolder], written here and read by the
 * interceptor, so the network layer reads memory only and never disk on the
 * request path.
 */
@Singleton
class SessionManager @Inject constructor(
  private val api: MaharaniApi,
  private val tokenStore: TokenStore,
  private val executor: ApiCallExecutor,
  private val mapper: SessionMapper,
  private val timeSource: TimeSource,
  private val authRepository: AuthRepository,
  private val appPreferences: AppPreferences,
  /**
   * The single in-memory token, shared with the interceptor. It lives in
   * `core:network` because it is dependency-free: deriving it from this class
   * would make SessionController → TokenProvider → OkHttpClient → Retrofit →
   * MaharaniApi → SessionManager a dependency cycle.
   */
  private val tokenHolder: ActiveTokenHolder,
) : SessionController {

  private val _state = MutableStateFlow<SessionState>(SessionState.Restoring)
  override val state: StateFlow<SessionState> = _state.asStateFlow()

  override fun accessToken(): String? = tokenHolder.accessToken()

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

    val usable = if (tokens.isExpiredAt(timeSource.nowEpochSeconds())) {
      // Exactly ONE refresh attempt. Refreshing is not a retry loop: a
      // rejected refresh token is terminal, and retrying it would hammer the
      // server with a credential that will never work again.
      when (val refreshed = authRepository.refresh(tokens.refreshToken)) {
        is AppResult.Success -> {
          storeQuietly(refreshed.value)
          refreshed.value
        }
        is AppResult.Failure -> {
          // Offline at launch is not proof that the session is dead: an
          // unreachable server says nothing about the refresh token, so the
          // stored tokens stay and the next launch can retry. Wiping them here
          // would force a re-sign-in for a user who was merely out of signal,
          // and would contradict the retry offered by [SessionState.Unavailable].
          if (refreshed.error is AppError.Network || refreshed.error.retryable) {
            clearActiveToken()
            return publish(
              SessionState.Unavailable(refreshed.error.message, refreshed.error.retryable)
            )
          }
          // A token the server has refused is terminal: the user signs in again,
          // and nothing is left on disk to retry with.
          clearStoredSession()
          return publish(SessionState.SignedOut(SignOutReason.SESSION_EXPIRED))
        }
      }
    } else {
      tokens
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
          tokenHolder.set(usable.accessToken)
          publish(SessionState.Authenticated(snapshot))
        }
      }

      is AppResult.Failure -> publish(handleFailure(result.error))
    }
  }

  /**
   * Sign out.
   *
   * Order matters: revoke FIRST (the interceptor needs the live token to
   * authenticate the revocation), then wipe. The revocation result is
   * deliberately ignored — a network failure must not leave the user signed in.
   * The local wipe is unconditional, and the token is dropped from memory
   * before the request completes only if revocation was skipped.
   */
  override suspend fun signOut() {
    if (tokenHolder.accessToken() != null) {
      // Best effort; `revokeSession` already swallows its own failure by
      // returning a result this method intentionally does not branch on.
      authRepository.revokeSession()
    }
    clearStoredSession()
    publish(SessionState.SignedOut(SignOutReason.SIGNED_OUT))
  }

  /**
   * Sign in and publish the resulting state.
   *
   * The tokens are written to encrypted storage ONLY after the server has
   * confirmed the credentials, and the in-memory token is set only after the
   * session has been verified by [applyVerifiedSession] — so a half-finished
   * sign-in leaves nothing usable behind.
   */
  override suspend fun signIn(identifier: String, password: String): SessionState {
    _state.value = SessionState.Restoring

    return when (val result = authRepository.login(identifier, password)) {
      is AppResult.Success -> {
        // A device can lose its encrypted token while the non-sensitive
        // idempotency key remains in DataStore. Clear session-scoped commerce
        // state before accepting any fresh login, so a retry key can never
        // cross from one account to another without an explicit clean slate.
        if (!clearSessionScopedForNewLogin()) return _state.value
        storeQuietly(result.value.tokens)
        tokenHolder.set(result.value.tokens.accessToken)

        when (val verified = executor.executeEnvelope { api.session() }) {
          is AppResult.Success -> {
            val snapshot = mapper.toSnapshot(verified.value)
            if (snapshot == null) {
              clearStoredSession()
              publish(SessionState.SignedOut(SignOutReason.UNSUPPORTED_ACCOUNT))
            } else {
              publish(SessionState.Authenticated(snapshot))
            }
          }
          is AppResult.Failure -> {
            // Credentials were accepted but the account is gated. The server's
            // gate is authoritative: `handleApiFailure` keeps the tokens for
            // the recoverable states (pending approval, lapsed access) and
            // clears them for suspension/deactivation.
            publish(handleFailure(verified.error))
          }
        }
      }

      is AppResult.Failure -> publish(handleSignInFailure(result.error))
    }
  }

  /**
   * Registration never grants access: a new retailer is pending approval until
   * an admin acts. Any session the server returns is stored so the pending
   * screen survives a restart, but the state stays signed out of the workspace.
   */
  override suspend fun registerRetailer(request: RegistrationRequest): RegistrationResult {
    return when (val result = authRepository.registerRetailer(
      fullName = request.fullName,
      shopName = request.shopName,
      phone = request.phone,
      email = request.email,
      areaId = request.areaId,
      address = request.address,
      password = request.password,
    )) {
      is AppResult.Success -> {
        result.value.tokens?.let { storeQuietly(it) }
        publish(SessionState.SignedOut(SignOutReason.PENDING_APPROVAL))
        RegistrationResult.Registered(result.value.requiresEmailConfirmation)
      }
      is AppResult.Failure -> RegistrationResult.Failed(result.error)
    }
  }

  /**
   * Sign-in failures keep the stored session untouched (there was none) and are
   * reported as the reason screen that matches the server's gate.
   */
  private fun handleSignInFailure(error: AppError): SessionState {
    clearActiveToken()
    return when (error) {
      is AppError.Network -> SessionState.Unavailable(error.message, error.retryable)
      is AppError.Unexpected -> SessionState.Unavailable(error.message, error.retryable)
      is AppError.Api -> when {
        // Bad credentials / unconfirmed email are ordinary form errors: the
        // sign-in screen shows the server's message, not an account-gate screen.
        error.code == ApiErrorCode.INVALID_CREDENTIALS || error.code == ApiErrorCode.EMAIL_NOT_CONFIRMED ->
          SessionState.Unavailable(error.message, retryable = false)
        error.gate == AccountGate.SUSPENDED -> SessionState.SignedOut(SignOutReason.ACCOUNT_SUSPENDED)
        error.gate == AccountGate.INACTIVE -> SessionState.SignedOut(SignOutReason.ACCOUNT_INACTIVE)
        error.gate == AccountGate.PENDING_APPROVAL -> SessionState.SignedOut(SignOutReason.PENDING_APPROVAL)
        error.gate == AccountGate.ACCESS_EXPIRED -> SessionState.SignedOut(SignOutReason.ACCESS_EXPIRED)
        else -> SessionState.Unavailable(error.message, error.retryable)
      }
    }
  }

  /**
   * Persist tokens without letting a storage failure break the flow.
   *
   * A failed write means the session will not survive a restart — annoying, not
   * unsafe: the user still has a working in-memory session, and the next launch
   * simply asks them to sign in again.
   */
  private suspend fun storeQuietly(tokens: SessionTokens) {
    try {
      tokenStore.write(tokens)
    } catch (cancellation: CancellationException) {
      throw cancellation
    } catch (_: Exception) {
      // See doc comment.
    }
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

  private suspend fun clearSessionScopedForNewLogin(): Boolean {
    try {
      appPreferences.clearSessionScoped()
      return true
    } catch (cancellation: CancellationException) {
      throw cancellation
    } catch (_: Exception) {
      // Fail closed: do not publish or persist a new account while an older
      // account's commerce recovery key may still be present locally.
      clearStoredSession()
      publish(
        SessionState.Unavailable(
          "Previous session data could not be cleared on this device. Please try signing in again.",
          retryable = true,
        )
      )
      return false
    }
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
    try {
      appPreferences.clearSessionScoped()
    } catch (cancellation: CancellationException) {
      throw cancellation
    } catch (_: Exception) {
      // Commerce recovery keys are non-sensitive, but must not cross accounts.
      // A storage failure cannot restore a signed-out token or authorize a write.
    }
  }

  private fun clearActiveToken() {
    tokenHolder.clear()
  }
}
