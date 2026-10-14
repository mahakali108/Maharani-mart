package com.maharanitraders.core.auth

import com.maharanitraders.core.common.AppError
import com.maharanitraders.core.common.AppResult
import com.maharanitraders.core.common.SessionScopedStore
import com.maharanitraders.core.common.TimeSource
import com.maharanitraders.core.datastore.AppPreferences
import com.maharanitraders.core.model.AccountGate
import com.maharanitraders.core.model.ApiErrorCode
import com.maharanitraders.core.model.SessionTokens
import com.maharanitraders.core.network.ApiCallExecutor
import com.maharanitraders.core.network.MaharaniApi
import com.maharanitraders.core.network.ActiveTokenHolder
import com.maharanitraders.core.network.TokenRefreshCoordinator
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlin.jvm.JvmSuppressWildcards

/** Shown when credentials the server has accepted could not be written to encrypted storage. */
internal const val SESSION_NOT_SAVED_MESSAGE =
  "Your session could not be saved on this device, so you have not been signed in. Please try again."

/** Shown when the previous account's cached data could not be cleared before a new sign-in. */
internal const val COMMERCE_CLEAR_FAILED_MESSAGE =
  "Previous session data could not be cleared on this device. Please try signing in again."

/** Shown when a refresh was refused but the stored credentials changed underneath it. Nothing is cleared. */
internal const val REFRESH_RETRY_MESSAGE =
  "Your session could not be refreshed. Please try again."

/**
 * Outcome of making a credential pair durable.
 *  - [SAVED]: the pair was written, read back and matched. It is the only result
 *    that may be used for authenticated access.
 *  - [FAILED]: the write or the read-back failed. The pair is held in memory as
 *    pending and nothing authenticated may use it yet.
 *  - [ABANDONED]: the session generation changed while the result was in flight.
 *    The pair belongs to a session that has ended and must not be written.
 */
internal enum class PersistOutcome { SAVED, FAILED, ABANDONED }

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
   * stored tokens. A local storage failure or a wrong-password result is
   * returned as [SessionState.Unavailable] WITHOUT being published, so the
   * login screen stays in place and shows the message.
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
 * SYNCHRONISATION MODEL
 *  - [sessionMutex] serialises the operations that START a session: [restore]
 *    and [signIn] (and registration). Two restores never spend the same refresh
 *    token, and a restore never reads credentials while a sign-in is replacing
 *    them. It is held across network calls, which is safe because nothing
 *    reached through it takes it again.
 *  - [refreshMutex] serialises every use of the refresh token. A rotation is
 *    finished (saved or pending) before the next exchange selects credentials,
 *    so an invalidated refresh token is never sent while a newer pair exists.
 *    It is held across the refresh network call, which never replays (see
 *    [ApiCallExecutor.execute]), so it cannot re-enter.
 *  - [credentialLock] guards the generation, the pending pair, the encrypted file
 *    and the in-memory token, and makes "check the generation, then act" atomic.
 *    It is held only for local work (disk, Keystore, state publication), never
 *    across a network call.
 *  - [generation] advances whenever a session begins or ends. A result that was
 *    requested under an older generation is discarded: it may neither publish
 *    state nor touch the token, file, or pending pair.
 *
 * Lock order (outermost first): [sessionMutex] → coordinator mutex →
 * [refreshMutex] → [credentialLock]. No path takes them in another order.
 * Session-scoped store callbacks run under [credentialLock] and must be local
 * cache clears; they must not call back into this class.
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
  /**
   * The in-memory caches that belong to ONE account (favourites, the cart badge,
   * the unread count). They are cleared whenever a session ends, so nothing the
   * previous account loaded can be shown to the next one. Multibound, so this
   * class never has to know which features have caches.
   *
   * `@JvmSuppressWildcards` is required: Kotlin's `Set<out E>` would otherwise
   * emit `Set<? extends SessionScopedStore>`, which Dagger cannot match to the
   * declared `Set<SessionScopedStore>` multibinding.
   */
  private val sessionScopedStores: Set<@JvmSuppressWildcards SessionScopedStore>,
  /**
   * Where the network layer asks for a fresh access token when a request comes
   * back `401 invalid_token`. The session layer installs the block below, so the
   * network layer never has to know who owns the refresh token.
   */
  private val tokenRefreshCoordinator: TokenRefreshCoordinator,
) : SessionController {

  private val _state = MutableStateFlow<SessionState>(SessionState.Restoring)
  override val state: StateFlow<SessionState> = _state.asStateFlow()

  private val sessionMutex = Mutex()
  private val refreshMutex = Mutex()
  private val credentialLock = Mutex()

  /**
   * Advances whenever a session begins or ends. Written only under
   * [credentialLock]; read without it only as a hint, and every decision is
   * re-checked under the lock.
   */
  @Volatile
  private var generation: Long = 0L

  /**
   * Credentials the server has accepted but that are NOT yet durable. When a
   * rotation succeeds but the encrypted write fails, the server has already
   * invalidated the previous refresh token, so this pair is the only valid
   * credential. It is used in preference to disk, and access is withheld until
   * it is saved. Lost only if the process dies first (see `docs/AUTH_PERSISTENCE.md`).
   * Guarded by [credentialLock].
   */
  private var pendingTokens: SessionTokens? = null

  init {
    // Installed once, for the life of the process. The block reads the refresh
    // token from the encrypted store at call time (never a captured value), so a
    // sign-in or sign-out that happened in between is always respected.
    tokenRefreshCoordinator.install { refreshAccessToken() }
  }

  /** The newest credential selected under [credentialLock]. */
  private sealed interface Newest {
    object Stale : Newest
    object SaveFailed : Newest
    object None : Newest
    /** A pending pair that has just been saved durably. It needs no network exchange. */
    class Renewed(val tokens: SessionTokens) : Newest
    /** A pair read from encrypted storage. It may or may not need an exchange. */
    class Stored(val tokens: SessionTokens) : Newest
  }

  /** The result of one refresh exchange. */
  private sealed interface Exchange {
    object Stale : Exchange
    object SaveFailed : Exchange
    object NoCredentials : Exchange
    /** The server refused the token. The session has ended and the shell has been told. */
    object Refused : Exchange
    /** The server refused, but the stored credentials changed first. Nothing was cleared. */
    object Changed : Exchange
    class Renewed(val tokens: SessionTokens) : Exchange
    class Transient(val error: AppError) : Exchange
  }

  override fun accessToken(): String? = tokenHolder.accessToken()

  override suspend fun restore(): SessionState = sessionMutex.withLock { restoreOnce() }

  private suspend fun restoreOnce(): SessionState {
    _state.value = SessionState.Restoring
    val gen = generation

    // Select the newest credential. A pending pair is saved first, so the stored
    // refresh token is never read as if it were current.
    val first: SessionTokens = when (val newest = credentialLock.withLock { selectNewestLocked(gen) }) {
      Newest.Stale -> return _state.value
      Newest.SaveFailed -> return withdrawIfCurrent(gen, saveFailedState())
      Newest.None -> return withdrawIfCurrent(gen, SessionState.SignedOut(SignOutReason.NEVER_SIGNED_IN))
      is Newest.Renewed -> newest.tokens
      is Newest.Stored -> newest.tokens
    }

    val usable: SessionTokens = if (!first.isExpiredAt(timeSource.nowEpochSeconds())) {
      first
    } else {
      // Exactly ONE refresh attempt. The exchange re-selects the newest credential
      // under the refresh lock, so a rotation that finished meanwhile is used
      // instead of spending the one that was invalidated.
      when (val exchanged = exchange(gen, skipIfFresh = true)) {
        is Exchange.Renewed -> exchanged.tokens
        Exchange.Stale, Exchange.Refused -> return _state.value
        Exchange.SaveFailed -> return withdrawIfCurrent(gen, saveFailedState())
        Exchange.NoCredentials -> return withdrawIfCurrent(gen, SessionState.SignedOut(SignOutReason.NEVER_SIGNED_IN))
        is Exchange.Transient -> return withdrawIfCurrent(
          gen,
          SessionState.Unavailable(exchanged.error.message, exchanged.error.retryable),
        )
        Exchange.Changed -> return withdrawIfCurrent(gen, SessionState.Unavailable(REFRESH_RETRY_MESSAGE, retryable = true))
      }
    }

    return verifyAndPublish(gen, usable.accessToken)
  }

  /**
   * Exchange the stored refresh token for a new access token, for a request that
   * was rejected with a 401 token failure while the app was running. Called by the
   * [TokenRefreshCoordinator], which already guarantees single-flight.
   *
   * Policy:
   *  - success → the new pair is saved durably and published to the interceptor;
   *  - a REFUSED refresh token → terminal: the session ends and the shell is told;
   *  - a refresh that could not reach the server → the stored tokens stay and the
   *    published state is left alone.
   */
  suspend fun refreshAccessToken(): String? {
    val gen = generation
    return when (val exchanged = exchange(gen, skipIfFresh = false)) {
      is Exchange.Renewed ->
        if (setActiveTokenIfCurrent(gen, exchanged.tokens.accessToken)) exchanged.tokens.accessToken else null
      Exchange.SaveFailed -> {
        // Rotated but not durable: withhold access. The pair stays pending and the
        // next restore or refresh saves it.
        clearActiveTokenIfCurrent(gen)
        null
      }
      Exchange.Stale, Exchange.Refused, Exchange.Changed, Exchange.NoCredentials -> null
      is Exchange.Transient -> null
    }
  }

  /**
   * One refresh exchange, serialised by [refreshMutex]. The credential is
   * selected INSIDE the lock, so it is the newest valid pair at the moment of the
   * request. Nothing under this lock waits on another lock that could be held by
   * a caller of this function.
   */
  private suspend fun exchange(gen: Long, skipIfFresh: Boolean): Exchange = refreshMutex.withLock {
    when (val newest = credentialLock.withLock { selectNewestLocked(gen) }) {
      Newest.Stale -> Exchange.Stale
      Newest.SaveFailed -> Exchange.SaveFailed
      Newest.None -> Exchange.NoCredentials
      is Newest.Renewed -> Exchange.Renewed(newest.tokens)
      is Newest.Stored -> refreshWith(gen, newest.tokens, skipIfFresh)
    }
  }

  /** Called under [refreshMutex] only. The network call here never replays. */
  private suspend fun refreshWith(gen: Long, stored: SessionTokens, skipIfFresh: Boolean): Exchange {
    // A restore that waited for the lock may find that a concurrent exchange has
    // already produced a fresh pair. Use it, rather than rotating again.
    if (skipIfFresh && !stored.isExpiredAt(timeSource.nowEpochSeconds())) return Exchange.Renewed(stored)

    val sent = stored.refreshToken
    return when (val refreshed = authRepository.refresh(sent)) {
      is AppResult.Success -> when (persistDurably(refreshed.value, gen)) {
        PersistOutcome.SAVED -> Exchange.Renewed(refreshed.value)
        PersistOutcome.FAILED -> Exchange.SaveFailed
        PersistOutcome.ABANDONED -> Exchange.Stale
      }
      is AppResult.Failure -> {
        val transient = refreshed.error is AppError.Network || refreshed.error.retryable
        if (transient) Exchange.Transient(refreshed.error) else refuseIfUnchanged(gen, sent)
      }
    }
  }

  /**
   * A refused refresh token ends the session, but only if this generation still
   * owns the credentials and the stored refresh token is still the one the server
   * refused. If the stored credentials changed, the newer pair is left alone.
   */
  private suspend fun refuseIfUnchanged(gen: Long, rejected: String): Exchange =
    credentialLock.withLock {
      if (gen != generation) return@withLock Exchange.Stale
      val current = pendingTokens ?: readStoredLocked()
      if (current?.refreshToken != rejected) return@withLock Exchange.Changed
      endSessionLocked(SessionState.SignedOut(SignOutReason.SESSION_EXPIRED))
      Exchange.Refused
    }

  override suspend fun signIn(identifier: String, password: String): SessionState = sessionMutex.withLock {
    val startGen = generation
    when (val result = authRepository.login(identifier, password)) {
      is AppResult.Success -> {
        // Commit point. The new account replaces whatever generation was current,
        // but only if nothing ended or started while the server was answering.
        val gen = beginSessionIfCurrent(startGen) ?: return@withLock _state.value

        // A device can lose its encrypted token while the non-sensitive idempotency
        // key remains in DataStore. Clear session-scoped commerce state before
        // accepting the new account, so a retry key cannot cross accounts.
        if (!clearSessionScopedForNewLogin()) {
          endSessionIfCurrent(gen, loginScreenState())
          return@withLock storageFailure(COMMERCE_CLEAR_FAILED_MESSAGE)
        }

        // The credentials must be durable before the account is used. If the write
        // fails, nothing authenticated runs and nothing is kept on disk. The shell
        // stays on the login screen, which shows the returned message.
        when (persistDurably(result.value.tokens, gen)) {
          PersistOutcome.SAVED -> Unit
          PersistOutcome.FAILED -> {
            endSessionIfCurrent(gen, loginScreenState())
            return@withLock saveFailedState()
          }
          PersistOutcome.ABANDONED -> return@withLock _state.value
        }

        verifyAndPublish(gen, result.value.tokens.accessToken)
      }

      is AppResult.Failure -> {
        val next = handleSignInFailure(result.error)
        if (next is SessionState.Unavailable) {
          // A wrong password or an unreachable server is a form-level message. The
          // login screen shows it, so the shell state is not replaced.
          clearActiveTokenIfCurrent(startGen)
          next
        } else {
          withdrawIfCurrent(startGen, next)
        }
      }
    }
  }

  /**
   * Registration never grants access: a new retailer is pending approval until
   * an admin acts. Any session the server returns is stored so the pending
   * screen survives a restart, but the state stays signed out of the workspace.
   */
  override suspend fun registerRetailer(request: RegistrationRequest): RegistrationResult = sessionMutex.withLock {
    val startGen = generation
    when (val result = authRepository.registerRetailer(
      fullName = request.fullName,
      shopName = request.shopName,
      phone = request.phone,
      email = request.email,
      areaId = request.areaId,
      address = request.address,
      password = request.password,
    )) {
      is AppResult.Success -> {
        val pendingApproval = SessionState.SignedOut(SignOutReason.PENDING_APPROVAL)
        val tokens = result.value.tokens
        // Tokens returned by registration start a session, so they are accepted only
        // if the generation captured before the request is still current. A session
        // that ended while the server answered (sign-out) must not be overwritten by
        // a stale registration. If the generation changed, nothing is stored or
        // published. The account still exists on the server, so the caller still
        // gets Registered. Without tokens, the call only publishes, which is also
        // guarded.
        val gen: Long? = if (tokens == null) startGen else beginSessionIfCurrent(startGen)
        if (gen != null) {
          // The pending-approval screen does not need these tokens. If they cannot be
          // saved, keep nothing in memory or on disk rather than a half-stored pair.
          if (tokens != null && persistDurably(tokens, gen) != PersistOutcome.SAVED) {
            endSessionIfCurrent(gen, pendingApproval)
          } else {
            publishCurrent(gen, pendingApproval)
          }
        }
        RegistrationResult.Registered(result.value.requiresEmailConfirmation)
      }
      is AppResult.Failure -> RegistrationResult.Failed(result.error)
    }
  }

  /**
   * Sign out.
   *
   * Sign-out wins over an operation in flight, and it is deliberately NOT behind
   * [sessionMutex]. It captures the generation first: if a newer session started
   * during the revocation, that session is left alone. The revocation result is
   * ignored: a network failure must not leave the user signed in.
   */
  override suspend fun signOut() {
    val gen = generation
    if (tokenHolder.accessToken() != null) {
      // Best effort. The revocation is authenticated with the live token, so it
      // must run before the token is cleared.
      authRepository.revokeSession()
    }
    endSessionIfCurrent(gen, SessionState.SignedOut(SignOutReason.SIGNED_OUT))
  }

  // ---------------------------------------------------------------------------
  // Credential selection and persistence. Every function below marked "Locked"
  // must only be called while holding [credentialLock].
  // ---------------------------------------------------------------------------

  /** Locked. Selects the newest credential. A pending pair is saved first. */
  private suspend fun selectNewestLocked(gen: Long): Newest {
    if (gen != generation) return Newest.Stale
    val pending = pendingTokens
    if (pending != null) {
      return when (persistLocked(pending, gen)) {
        PersistOutcome.SAVED -> Newest.Renewed(pending)
        PersistOutcome.FAILED -> Newest.SaveFailed
        PersistOutcome.ABANDONED -> Newest.Stale
      }
    }
    val stored = readStoredLocked() ?: return Newest.None
    return Newest.Stored(stored)
  }

  /** Locked. Write, read back and compare. Sets or clears the pending slot. */
  private suspend fun persistLocked(tokens: SessionTokens, gen: Long): PersistOutcome {
    if (gen != generation) return PersistOutcome.ABANDONED
    val saved = try {
      tokenStore.write(tokens)
      tokenStore.read() == tokens
    } catch (cancellation: CancellationException) {
      throw cancellation
    } catch (_: Exception) {
      false
    }
    return if (saved) {
      pendingTokens = null
      PersistOutcome.SAVED
    } else {
      pendingTokens = tokens
      PersistOutcome.FAILED
    }
  }

  /** Locked-or-not: takes [credentialLock] itself. Never call while already holding it. */
  private suspend fun persistDurably(tokens: SessionTokens, gen: Long): PersistOutcome =
    credentialLock.withLock { persistLocked(tokens, gen) }

  /** Locked. Reads the encrypted file. A read failure is "nothing stored" (fails closed). */
  private suspend fun readStoredLocked(): SessionTokens? = try {
    tokenStore.read()
  } catch (cancellation: CancellationException) {
    throw cancellation
  } catch (_: Exception) {
    null
  }

  /** Locked. Drops the in-memory token and the coordinator's cache. */
  private fun clearActiveTokenLocked() {
    tokenHolder.clear()
    // The coordinator caches the last token it produced; drop it with the token
    // itself, so one account's access token can never be handed to another.
    tokenRefreshCoordinator.reset()
  }

  /** Locked. Ends the current session: generation advances, pending and disk are wiped. */
  private suspend fun invalidateLocked() {
    generation += 1
    pendingTokens = null
    clearActiveTokenLocked()
    try {
      tokenStore.clear()
    } catch (cancellation: CancellationException) {
      throw cancellation
    } catch (_: Exception) {
      // A failed local wipe must not block sign-out: the token is already
      // unusable in memory, and the next restore re-validates with the server.
    }
  }

  /**
   * Locked. Ends the session and publishes [next] if given. Storage clears are
   * best effort. Commerce recovery keys are non-sensitive, but must not cross
   * accounts.
   */
  private suspend fun endSessionLocked(next: SessionState?): SessionState {
    invalidateLocked()
    try {
      appPreferences.clearSessionScoped()
    } catch (cancellation: CancellationException) {
      throw cancellation
    } catch (_: Exception) {
      // See doc comment.
    }
    return if (next != null) publishLocked(next) else _state.value
  }

  /** Locked. Publishes [state]. Session-scoped caches are dropped unless the state is Authenticated. */
  private suspend fun publishLocked(state: SessionState): SessionState {
    if (state !is SessionState.Authenticated) endSessionScopedState()
    _state.value = state
    return state
  }

  // ---------------------------------------------------------------------------
  // Generation-guarded actions. Each one checks the generation it was started
  // under and does nothing if the session has since changed.
  // ---------------------------------------------------------------------------

  /** Starts a new session if [startGen] is still current. Returns the new generation, or null if stale. */
  private suspend fun beginSessionIfCurrent(startGen: Long): Long? = credentialLock.withLock {
    if (startGen != generation) {
      null
    } else {
      invalidateLocked()
      generation
    }
  }

  /** Sets the in-memory token only while [gen] is current. Returns false if stale. */
  private suspend fun setActiveTokenIfCurrent(gen: Long, accessToken: String): Boolean = credentialLock.withLock {
    if (gen != generation) {
      false
    } else {
      tokenHolder.set(accessToken)
      true
    }
  }

  /** Clears the in-memory token only while [gen] is current, so a newer account's token is never erased. */
  private suspend fun clearActiveTokenIfCurrent(gen: Long) {
    credentialLock.withLock {
      if (gen == generation) clearActiveTokenLocked()
    }
  }

  /** Publishes only while [gen] is current. Returns the state the shell now sees. */
  private suspend fun publishCurrent(gen: Long, state: SessionState): SessionState = credentialLock.withLock {
    if (gen != generation) _state.value else publishLocked(state)
  }

  /**
   * Withhold access and publish [next], keeping stored credentials. Used for
   * failures that do not prove the session is dead.
   */
  private suspend fun withdrawIfCurrent(gen: Long, next: SessionState): SessionState = credentialLock.withLock {
    if (gen != generation) {
      _state.value
    } else {
      clearActiveTokenLocked()
      publishLocked(next)
    }
  }

  /** End the session (wipe storage and token) and publish [next], only while [gen] is current. */
  private suspend fun endSessionIfCurrent(gen: Long, next: SessionState?): SessionState = credentialLock.withLock {
    if (gen != generation) _state.value else endSessionLocked(next)
  }

  /**
   * Verify the session with the server, after the token has been placed in memory.
   *
   * The token must be published BEFORE the verification call. `GET /session` is
   * bearer-authenticated, and the Authorization header comes from the interceptor
   * reading the holder. Setting it afterwards sent every restore request
   * anonymously. Publishing it here is not a privilege escalation: it came from
   * encrypted storage, the call that follows is the verification, and every
   * failure path clears the holder again.
   */
  private suspend fun verifyAndPublish(gen: Long, accessToken: String): SessionState {
    if (!setActiveTokenIfCurrent(gen, accessToken)) return _state.value

    return when (val result = executor.executeEnvelope { api.session() }) {
      is AppResult.Success -> {
        val snapshot = mapper.toSnapshot(result.value)
        if (snapshot == null) {
          endSessionIfCurrent(gen, SessionState.SignedOut(SignOutReason.UNSUPPORTED_ACCOUNT))
        } else {
          publishCurrent(gen, SessionState.Authenticated(snapshot))
        }
      }
      is AppResult.Failure -> applyVerificationFailure(gen, accessToken, result.error)
    }
  }

  /**
   * A token rejection during verification ends the session only if the rejected
   * token is still the newest credential. A runtime rotation can save a newer
   * pair while this request was in flight. Its failure then says nothing about
   * that pair, so ending the session here would wipe it (finding F3). In that
   * case the newer credentials are kept, access is withheld, and retry is offered.
   */
  private suspend fun applyVerificationFailure(gen: Long, verifiedToken: String, error: AppError): SessionState {
    if (error !is AppError.Api || !error.requiresSignIn) return applyFailure(gen, error)
    return credentialLock.withLock {
      if (gen != generation) {
        _state.value
      } else {
        val current = pendingTokens ?: readStoredLocked()
        if (current?.accessToken == verifiedToken) {
          endSessionLocked(SessionState.SignedOut(SignOutReason.SESSION_EXPIRED))
        } else {
          clearActiveTokenLocked()
          publishLocked(SessionState.Unavailable(REFRESH_RETRY_MESSAGE, retryable = true))
        }
      }
    }
  }

  /**
   * Failure policy for a verification (or other session-bound) request:
   *  - token failures → the token is dead: end the session and require sign-in;
   *  - suspension / deactivation → end the session (the account cannot be used);
   *  - pending approval / lapsed access → withdraw access, KEEP tokens (recoverable);
   *  - network / server problems → withdraw access, KEEP tokens, offer retry.
   */
  private suspend fun applyFailure(gen: Long, error: AppError): SessionState = when (error) {
    is AppError.Api -> when {
      error.requiresSignIn -> endSessionIfCurrent(gen, SessionState.SignedOut(SignOutReason.SESSION_EXPIRED))
      else -> when (error.gate) {
        AccountGate.PENDING_APPROVAL -> withdrawIfCurrent(gen, SessionState.SignedOut(SignOutReason.PENDING_APPROVAL))
        AccountGate.ACCESS_EXPIRED -> withdrawIfCurrent(gen, SessionState.SignedOut(SignOutReason.ACCESS_EXPIRED))
        AccountGate.SUSPENDED -> endSessionIfCurrent(gen, SessionState.SignedOut(SignOutReason.ACCOUNT_SUSPENDED))
        AccountGate.INACTIVE -> endSessionIfCurrent(gen, SessionState.SignedOut(SignOutReason.ACCOUNT_INACTIVE))
        null -> withdrawIfCurrent(gen, SessionState.Unavailable(error.message, error.retryable))
      }
    }
    is AppError.Network -> withdrawIfCurrent(gen, SessionState.Unavailable(error.message, error.retryable))
    is AppError.Unexpected -> withdrawIfCurrent(gen, SessionState.Unavailable(error.message, error.retryable))
  }

  /**
   * Sign-in failures keep the stored session untouched (there was none) and are
   * reported as the reason screen that matches the server's gate.
   */
  private fun handleSignInFailure(error: AppError): SessionState = when (error) {
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

  /** Returns the storage failure. It is returned to the caller, not published. */
  private fun storageFailure(message: String): SessionState =
    SessionState.Unavailable(message, retryable = true, storageFailure = true)

  private fun saveFailedState(): SessionState = storageFailure(SESSION_NOT_SAVED_MESSAGE)

  /**
   * The shell state when a sign-in cannot complete: signed out, so the login
   * screen is shown. The failure message travels in the returned value, which
   * the login view model shows as a form error.
   */
  private fun loginScreenState(): SessionState = SessionState.SignedOut(SignOutReason.NEVER_SIGNED_IN)

  /**
   * Ask every session-scoped store to forget the account that was signed in.
   * Failures are swallowed on purpose: a cache that could not be cleared is not
   * authorization (every read still goes to the server with the current token),
   * and a sign-out must never be blocked by it.
   */
  private suspend fun endSessionScopedState() {
    for (store in sessionScopedStores) {
      try {
        store.onSessionEnded()
      } catch (cancellation: CancellationException) {
        throw cancellation
      } catch (_: Exception) {
        // See doc comment.
      }
    }
  }

  /** Returns false when the previous account's commerce data could not be cleared. */
  private suspend fun clearSessionScopedForNewLogin(): Boolean {
    return try {
      // Both kinds of session-scoped state, before the new account is accepted:
      // the persisted commerce recovery key in DataStore, and the in-memory
      // caches that belong to whoever was signed in before.
      endSessionScopedState()
      appPreferences.clearSessionScoped()
      true
    } catch (cancellation: CancellationException) {
      throw cancellation
    } catch (_: Exception) {
      // Fail closed: the caller ends the session it just began and reports the failure.
      false
    }
  }
}
