package com.maharanitraders.core.network

import com.maharanitraders.core.common.AppResult
import com.maharanitraders.core.common.IoDispatcher
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
 */
@Singleton
class ApiCallExecutor @Inject constructor(
  private val errorMapper: ApiErrorMapper,
  @IoDispatcher private val ioDispatcher: CoroutineDispatcher,
) {

  suspend fun <T> execute(block: suspend () -> T): AppResult<T> = withContext(ioDispatcher) {
    try {
      AppResult.Success(block())
    } catch (cancellation: CancellationException) {
      throw cancellation
    } catch (throwable: Throwable) {
      AppResult.Failure(errorMapper.fromThrowable(throwable))
    }
  }

  /** Convenience for endpoints that answer with the standard `{ data }` envelope. */
  suspend fun <T> executeEnvelope(block: suspend () -> ApiEnvelope<T>): AppResult<T> =
    execute { block().data }
}
