package com.maharanitraders.core.network

import com.maharanitraders.core.common.AppError
import com.maharanitraders.core.model.ApiErrorCode
import com.maharanitraders.core.network.dto.ApiErrorEnvelope
import java.io.IOException
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import retrofit2.HttpException

/**
 * Turns transport failures into [AppError] values.
 *
 * Rules that matter for the migration:
 *  - the server's `error.code` is authoritative (never inferred from the UI);
 *  - an unrecognised code becomes [ApiErrorCode.UNKNOWN] (retryable), so a new
 *    server code can never be mistaken for success;
 *  - when the body cannot be parsed, a conservative code for the HTTP status is
 *    used and the raw body is DISCARDED. Server internals (SQL text, hostnames)
 *    must not reach the UI or the logs.
 */
@Singleton
class ApiErrorMapper @Inject constructor(
  private val json: Json,
) {

  fun fromHttp(statusCode: Int, body: String?): AppError {
    val envelope = parseEnvelope(body)
    val code = envelope?.error?.code?.let { ApiErrorCode.fromWire(it) }
      ?: fallbackCode(statusCode)
    val serverMessage = envelope?.error?.message?.takeIf { it.isNotBlank() }
    // Only non-blank entries are kept: an empty field message would render as a
    // blank error under an input.
    val fieldErrors = envelope?.error?.details?.fields
      ?.filterValues { it.isNotBlank() }
      .orEmpty()
    return AppError.Api(
      code = code,
      message = serverMessage ?: defaultMessage(code),
      fieldErrors = fieldErrors,
    )
  }

  fun fromThrowable(throwable: Throwable): AppError = when (throwable) {
    is HttpException -> fromHttp(throwable.code(), readErrorBody(throwable))
    is IOException -> AppError.Network()
    is SerializationException -> AppError.Unexpected()
    else -> AppError.Unexpected()
  }

  private fun readErrorBody(throwable: HttpException): String? =
    try {
      throwable.response()?.errorBody()?.string()
    } catch (_: Throwable) {
      null
    }

  private fun parseEnvelope(body: String?): ApiErrorEnvelope? {
    if (body.isNullOrBlank()) return null
    return try {
      json.decodeFromString(ApiErrorEnvelope.serializer(), body)
    } catch (_: SerializationException) {
      null
    } catch (_: IllegalArgumentException) {
      null
    }
  }

  private fun fallbackCode(statusCode: Int): ApiErrorCode = when (statusCode) {
    400 -> ApiErrorCode.INVALID_REQUEST
    401 -> ApiErrorCode.INVALID_TOKEN
    403 -> ApiErrorCode.FORBIDDEN
    404 -> ApiErrorCode.NOT_FOUND
    409 -> ApiErrorCode.CONFLICT
    413 -> ApiErrorCode.PAYLOAD_TOO_LARGE
    422 -> ApiErrorCode.VALIDATION_FAILED
    429 -> ApiErrorCode.RATE_LIMITED
    503 -> ApiErrorCode.DATABASE_UNAVAILABLE
    else -> ApiErrorCode.UNKNOWN
  }

  private fun defaultMessage(code: ApiErrorCode): String = when (code) {
    ApiErrorCode.MISSING_TOKEN,
    ApiErrorCode.INVALID_TOKEN,
    ApiErrorCode.EXPIRED_TOKEN,
    -> "Your session has expired. Please sign in again."

    ApiErrorCode.FORBIDDEN -> "You do not have permission to do that."
    ApiErrorCode.ACCOUNT_INACTIVE -> "This account is not active. Please contact Maharani Traders."
    ApiErrorCode.ACCOUNT_SUSPENDED -> "This account is suspended. Please contact Maharani Traders."
    ApiErrorCode.RETAILER_PENDING_APPROVAL -> "Your shop is still awaiting approval."
    ApiErrorCode.ACCESS_EXPIRED -> "Your access period has ended. Please contact Maharani Traders."
    ApiErrorCode.RATE_LIMITED -> "Too many attempts. Please wait and try again."
    ApiErrorCode.DATABASE_UNAVAILABLE,
    ApiErrorCode.INTERNAL_ERROR,
    -> "Something went wrong. Please try again."

    else -> "Something went wrong. Please try again."
  }

  val networkErrorMessage: String get() = "You appear to be offline. Check your connection and try again."
}
