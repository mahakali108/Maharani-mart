package com.maharanitraders.core.network

import com.maharanitraders.core.common.AppError
import com.maharanitraders.core.common.AppResult
import com.maharanitraders.core.common.di.IoDispatcher
import com.maharanitraders.core.model.ApiErrorCode
import com.maharanitraders.core.network.dto.ApiEnvelope
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.withContext

/**
 * Runs one API call on the IO dispatcher and converts every failure into a
 * typed [com.maharanitraders.core.common.AppError].
 *
 * Cancellation is rethrown, never swallowed: a screen that goes away must not
 * report a spurious error, and a cancelled coroutine must stay cancelled.
 *
 * THE ONE RETRY THIS APP MAKES
 * A request that the server rejects with a 401 TOKEN failure — `invalid_token`
 * OR `expired_token` — is retried ONCE, and only after the access token has been
 * exchanged through [TokenRefreshCoordinator] (single-flight, at most one
 * refresh in flight, no recursion). That is what makes a restored session usable
 * for a whole browsing session rather than only until the access token's hour is
 * up. Nothing else is retried: a transport failure on a mutation is ambiguous,
 * so the app leaves replaying those to the caller and to the server's own
 * idempotency keys.
 *
 * WHY `expired_token` IS NOT OPTIONAL HERE
 * The API does not answer every rejected token with one code. It reads `exp` off
 * the presented JWT and answers `expired_token` when the hour is simply up, and
 * `invalid_token` only when Supabase itself refused the token
 * (`classifyTokenFailure`, `lib/mobile/auth.ts`). `expired_token` is therefore
 * the NORMAL answer to the first request after the app has been in the
 * background for more than an hour — and a build that refreshed only on
 * `invalid_token` left every screen, the catalogue first, failing with a 401
 * until the process was restarted and `SessionManager.restore` refreshed the
 * pair. Treating both codes as "refresh and replay once" is what makes a
 * long-lived session actually long-lived.
 *
 * The two new collaborators are defaulted so a test can construct the executor
 * exactly as before; production wiring passes the real token holder and
 * coordinator (see `NetworkModule`).
 */
@Singleton
class ApiCallExecutor @Inject constructor(
  private val errorMapper: ApiErrorMapper,
  @IoDispatcher private val ioDispatcher: CoroutineDispatcher,
  private val tokenProvider: TokenProvider = TokenProvider { null },
  private val tokenRefreshCoordinator: TokenRefreshCoordinator = TokenRefreshCoordinator(),
) {

  suspend fun <T> execute(block: suspend () -> T): AppResult<T> = withContext(ioDispatcher) {
    val first = attempt(block)
    if (first is AppResult.Failure && isExpiredToken(first.error)) {
      val stale = tokenProvider.accessToken()
      val fresh = tokenRefreshCoordinator.refresh(stale)
      // Retry with whatever the holder now carries. A fresh token that is
      // identical to the failed one means no refresh happened; retrying would
      // simply repeat the 401.
      if (fresh != null && fresh != stale) return@withContext attempt(block)
    }
    first
  }

  /** Convenience for endpoints that answer with the standard `{ data }` envelope. */
  suspend fun <T> executeEnvelope(block: suspend () -> ApiEnvelope<T>): AppResult<T> =
    execute { block().data }

  private suspend fun <T> attempt(block: suspend () -> T): AppResult<T> = try {
    AppResult.Success(block())
  } catch (cancellation: CancellationException) {
    throw cancellation
  } catch (throwable: Throwable) {
    AppResult.Failure(errorMapper.fromThrowable(throwable))
  }

  /**
   * The server's "this token is no longer good" answers, and nothing else.
   *
   * Both token codes are refreshable; see the class comment. A `missing_token`
   * 401 is deliberately NOT included: the request carried no bearer token, so
   * there is nothing to refresh, and the coordinator answers `null` for a null
   * token anyway.
   */
  private fun isExpiredToken(error: AppError): Boolean =
    error is AppError.Api &&
      (error.code == ApiErrorCode.INVALID_TOKEN || error.code == ApiErrorCode.EXPIRED_TOKEN)
}
