package com.maharanitraders.core.common

import com.maharanitraders.core.model.AccountGate
import com.maharanitraders.core.model.ApiErrorCode

/**
 * Every failure the UI can be asked to render.
 *
 * Guarantees relied on across the app:
 *  - [message] is end-user safe. Server internals (SQL, hostnames, stack
 *    traces) never reach it — they stay in server logs, correlated by request
 *    id;
 *  - [retryable] is explicit, so screens can distinguish "try again" from
 *    "this will never work";
 *  - account gates are structured (`ApiErrorCode.gate`), never inferred from
 *    message text.
 */
sealed interface AppError {

  val message: String
  val retryable: Boolean

  /** The device could not talk to the API at all (offline, timeout, TLS). */
  data class Network(
    override val message: String = "You appear to be offline. Check your connection and try again.",
  ) : AppError {
    override val retryable = true
  }

  /** The API answered with the standard error envelope. */
  data class Api(
    val code: ApiErrorCode,
    override val message: String,
    /**
     * Field-level messages from `details.fields`, keyed by the server's field
     * name (`phone`, `email`, `areaId`, …). Empty when the failure was not a
     * field validation, so a form can attach messages to inputs without
     * parsing prose, and can never invent one.
     */
    val fieldErrors: Map<String, String> = emptyMap(),
  ) : AppError {
    override val retryable: Boolean get() = code.retryable

    /** True when the stored session is unusable and the user must sign in again. */
    val requiresSignIn: Boolean get() = code.requiresSignIn

    /** Set when the account is gated (pending approval, suspended, …). */
    val gate: AccountGate? get() = code.gate
  }

  /**
   * A bug or an unexpected throwable. Deliberately surfaced as a retryable,
   * generic message: the app must not leak a raw exception to the user.
   */
  data class Unexpected(
    val debugTag: String = "unexpected",
  ) : AppError {
    override val message: String = "Something went wrong. Please try again."
    override val retryable = true
  }
}

/** Result of an operation that talks to the network or the database. */
sealed interface AppResult<out T> {

  data class Success<T>(val value: T) : AppResult<T>

  data class Failure(val error: AppError) : AppResult<Nothing>
}

fun <T> AppResult<T>.getOrNull(): T? = when (this) {
  is AppResult.Success -> value
  is AppResult.Failure -> null
}

fun <T> AppResult<T>.errorOrNull(): AppError? = when (this) {
  is AppResult.Success -> null
  is AppResult.Failure -> error
}

/**
 * Transforms a success value, leaving failures untouched.
 *
 * A top-level extension (not a member) so `AppResult<out T>` stays covariant —
 * a member `map` would put `T` in an `in` position and break the variance.
 */
inline fun <T, R> AppResult<T>.map(transform: (T) -> R): AppResult<R> = when (this) {
  is AppResult.Success -> AppResult.Success(transform(value))
  is AppResult.Failure -> this
}

inline fun <T> AppResult<T>.onSuccess(action: (T) -> Unit): AppResult<T> {
  if (this is AppResult.Success) action(value)
  return this
}

inline fun <T> AppResult<T>.onFailure(action: (AppError) -> Unit): AppResult<T> {
  if (this is AppResult.Failure) action(error)
  return this
}
