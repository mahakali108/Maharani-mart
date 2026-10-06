package com.maharanitraders.core.network

import com.maharanitraders.core.common.AppError
import com.maharanitraders.core.common.AppResult
import com.maharanitraders.core.model.ApiErrorCode
import java.io.IOException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import retrofit2.HttpException
import retrofit2.Response

/**
 * The executor is the single place where a thrown exception becomes a typed
 * failure — and where cancellation stays cancellation.
 */
class ApiCallExecutorTest {

  private val dispatcher = StandardTestDispatcher()
  private val executor = ApiCallExecutor(ApiErrorMapper(Json { ignoreUnknownKeys = true }), dispatcher)

  @Test
  fun `returns success values untouched`() = runTest(dispatcher) {
    val result = executor.execute { 42 }
    assertEquals(AppResult.Success(42), result)
  }

  @Test
  fun `maps IO failures to a retryable network error`() = runTest(dispatcher) {
    val result = executor.execute<Int> { throw IOException("offline") }
    assertTrue(result is AppResult.Failure)
    assertTrue((result as AppResult.Failure).error is AppError.Network)
  }

  @Test
  fun `rethrows cancellation instead of reporting a failure`() = runTest(dispatcher) {
    var cancelled = false
    try {
      executor.execute<Int> { throw CancellationException("screen left") }
    } catch (_: CancellationException) {
      cancelled = true
    }
    assertTrue("cancellation must propagate", cancelled)
  }

  @Test
  fun `unwraps the standard data envelope`() = runTest(dispatcher) {
    val json = Json { ignoreUnknownKeys = true }
    val result = executor.executeEnvelope {
      json.decodeFromString(
        com.maharanitraders.core.network.dto.ApiEnvelope.serializer(
          com.maharanitraders.core.network.dto.HealthDto.serializer()
        ),
        """{"data":{"status":"ok","database":"reachable"},"requestId":"r"}"""
      )
    }
    assertEquals("ok", (result as AppResult.Success).value.status)
  }

  /**
   * The expired-token retry.
   *
   * A live session whose access token has expired must not turn into an error
   * screen: the request that answered `401 invalid_token` is retried once, after
   * the session layer has exchanged the refresh token. These tests use the real
   * executor, the real error mapper and the real coordinator — only the token
   * holder and the refresh block are doubles.
   */
  private fun expiredTokenError(): HttpException = HttpException(
    Response.error<Any>(
      401,
      """{"error":{"code":"invalid_token","message":"Please sign in again."}}"""
        .toResponseBody("application/json".toMediaType()),
    ),
  )

  @Test
  fun `retries once after refreshing an expired token`() = runTest(dispatcher) {
    val holder = ActiveTokenHolder().apply { set("stale-token") }
    val coordinator = TokenRefreshCoordinator()
    var refreshCalls = 0
    coordinator.install {
      refreshCalls += 1
      // What SessionManager does: publish the new pair, return the new token.
      holder.set("fresh-token")
      "fresh-token"
    }
    val executor = ApiCallExecutor(
      ApiErrorMapper(Json { ignoreUnknownKeys = true }),
      dispatcher,
      holder,
      coordinator,
    )
    var attempts = 0

    val result = executor.execute {
      attempts += 1
      // The interceptor reads the holder on every attempt.
      if (holder.accessToken() != "fresh-token") throw expiredTokenError()
      "priced for your shop"
    }

    assertEquals(AppResult.Success("priced for your shop"), result)
    assertEquals(2, attempts)
    assertEquals(1, refreshCalls)
  }

  @Test
  fun `reports the original failure when the token cannot be refreshed`() = runTest(dispatcher) {
    val holder = ActiveTokenHolder().apply { set("stale-token") }
    val coordinator = TokenRefreshCoordinator()
    coordinator.install { null }
    val executor = ApiCallExecutor(
      ApiErrorMapper(Json { ignoreUnknownKeys = true }),
      dispatcher,
      holder,
      coordinator,
    )
    var attempts = 0

    val result = executor.execute<String> {
      attempts += 1
      throw expiredTokenError()
    }

    assertTrue(result is AppResult.Failure)
    assertEquals(ApiErrorCode.INVALID_TOKEN, (result as AppResult.Failure).error.let {
      (it as com.maharanitraders.core.common.AppError.Api).code
    })
    // No retry without a new token: repeating the same 401 helps nobody.
    assertEquals(1, attempts)
  }

  /**
   * The other half of the same rule, and the one a shopper actually hits: the
   * API answers `expired_token` (read from the JWT's own `exp`, see
   * `lib/mobile/auth.ts`'s `classifyTokenFailure`) once the access token's hour
   * is up, which is what happens to the FIRST request after the app has been in
   * the background. Refreshing only on `invalid_token` left that request failing
   * until the process restarted, so the catalogue stopped loading on a session
   * that was still perfectly refreshable.
   */
  private fun expiredTokenCodeError(): HttpException = HttpException(
    Response.error<Any>(
      401,
      """{"error":{"code":"expired_token","message":"Your session has expired. Please sign in again."}}"""
        .toResponseBody("application/json".toMediaType()),
    ),
  )

  @Test
  fun `refreshes and retries when the server reports the access token expired`() = runTest(dispatcher) {
    val holder = ActiveTokenHolder().apply { set("stale-token") }
    val coordinator = TokenRefreshCoordinator()
    var refreshCalls = 0
    coordinator.install {
      refreshCalls += 1
      holder.set("fresh-token")
      "fresh-token"
    }
    val executor = ApiCallExecutor(
      ApiErrorMapper(Json { ignoreUnknownKeys = true }),
      dispatcher,
      holder,
      coordinator,
    )
    var attempts = 0

    val result = executor.execute {
      attempts += 1
      if (holder.accessToken() != "fresh-token") throw expiredTokenCodeError()
      "priced for your shop"
    }

    assertEquals(AppResult.Success("priced for your shop"), result)
    assertEquals(2, attempts)
    assertEquals(1, refreshCalls)
  }

  @Test
  fun `maps the expired-token code to the sign-in error it is`() = runTest(dispatcher) {
    val mapper = ApiErrorMapper(Json { ignoreUnknownKeys = true })
    val mapped = mapper.fromHttp(
      401,
      """{"error":{"code":"expired_token","message":"Your session has expired. Please sign in again."}}""",
    )
    assertTrue(mapped is AppError.Api)
    assertEquals(ApiErrorCode.EXPIRED_TOKEN, (mapped as AppError.Api).code)
    assertTrue(mapped.requiresSignIn)
  }

  @Test
  fun `does not retry a transport failure`() = runTest(dispatcher) {
    val coordinator = TokenRefreshCoordinator()
    var refreshCalls = 0
    coordinator.install { refreshCalls += 1; "fresh-token" }
    val executor = ApiCallExecutor(
      ApiErrorMapper(Json { ignoreUnknownKeys = true }),
      dispatcher,
      ActiveTokenHolder().apply { set("stale-token") },
      coordinator,
    )
    var attempts = 0

    val result = executor.execute<Int> {
      attempts += 1
      throw IOException("offline")
    }

    assertTrue(result is AppResult.Failure)
    assertEquals(1, attempts)
    assertEquals(0, refreshCalls)
  }

  @Test
  fun `http failures become api errors with the mapped code`() = runTest(dispatcher) {
    val mapper = ApiErrorMapper(Json { ignoreUnknownKeys = true })
    val mapped = mapper.fromHttp(401, """{"error":{"code":"invalid_token","message":"Please sign in again."}}""")
    assertTrue(mapped is AppError.Api)
    assertEquals(ApiErrorCode.INVALID_TOKEN, (mapped as AppError.Api).code)
    assertTrue(mapped.requiresSignIn)
  }
}
