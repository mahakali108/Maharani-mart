package com.maharanitraders.core.auth

import com.maharanitraders.core.model.SessionSnapshot

/**
 * Why the app is not showing a signed-in workspace.
 *
 * Gates mirror the server's 403 codes exactly, so the screen the user sees
 * always corresponds to the state the server actually enforced.
 */
enum class SignOutReason {
  /** No stored session — a first launch or after an explicit sign-out. */
  NEVER_SIGNED_IN,

  /** The stored access token expired (Phase C refreshes it first). */
  SESSION_EXPIRED,

  /** The user tapped sign out. */
  SIGNED_OUT,

  /** Server reported the account no longer resolves / is deactivated. */
  ACCOUNT_INACTIVE,

  /** Retailer account suspended. */
  ACCOUNT_SUSPENDED,

  /** Retailer account awaiting approval. */
  PENDING_APPROVAL,

  /** Access period lapsed (`user_access_periods`). */
  ACCESS_EXPIRED,

  /** The server sent a role or navigation payload this build cannot use. */
  UNSUPPORTED_ACCOUNT,
}

/**
 * Session lifecycle state. Exactly one source of truth for "who is signed in",
 * observed by the navigation shell and every feature module.
 */
sealed interface SessionState {

  /** Reading stored tokens / contacting the server. Drives the splash screen. */
  data object Restoring : SessionState

  /** A verified session with the server's own navigation policy. */
  data class Authenticated(val snapshot: SessionSnapshot) : SessionState

  /** No usable session; [reason] selects the screen the shell shows. */
  data class SignedOut(val reason: SignOutReason) : SessionState

  /**
   * Stored tokens exist but the session could not be verified right now
   * (offline, server error). Tokens are KEPT and the app offers retry — it
   * never shows a cached identity as if it were freshly verified.
   *
   * [storageFailure] is true when the cause is on-device credential storage, not
   * the network. The UI must not present it as a connectivity problem.
   */
  data class Unavailable(
    val message: String,
    val retryable: Boolean,
    val storageFailure: Boolean = false,
  ) : SessionState
}
