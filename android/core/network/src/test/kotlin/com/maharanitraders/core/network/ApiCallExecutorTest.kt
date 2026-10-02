package com.maharanitraders.core.network

import com.maharanitraders.core.common.AppError
import com.maharanitraders.core.common.AppResult
import com.maharanitraders.core.model.ApiErrorCode
import java.io.IOException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

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

  @Test
  fun `http failures become api errors with the mapped code`() = runTest(dispatcher) {
    val mapper = ApiErrorMapper(Json { ignoreUnknownKeys = true })
    val mapped = mapper.fromHttp(401, """{"error":{"code":"invalid_token","message":"Please sign in again."}}""")
    assertTrue(mapped is AppError.Api)
    assertEquals(ApiErrorCode.INVALID_TOKEN, (mapped as AppError.Api).code)
    assertTrue(mapped.requiresSignIn)
  }
}
