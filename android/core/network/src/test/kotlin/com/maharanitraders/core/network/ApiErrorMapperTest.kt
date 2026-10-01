package com.maharanitraders.core.network

import com.maharanitraders.core.common.AppError
import com.maharanitraders.core.model.AccountGate
import com.maharanitraders.core.model.ApiErrorCode
import java.io.IOException
import java.net.SocketTimeoutException
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Error handling contract: the server's code is authoritative, unknown codes
 * stay retryable, and internal detail never reaches the UI.
 */
class ApiErrorMapperTest {

  private val mapper = ApiErrorMapper(Json { ignoreUnknownKeys = true })

  @Test
  fun `uses the server code and message when the envelope parses`() {
    val error = mapper.fromHttp(
      422,
      """{"error":{"code":"insufficient_stock","message":"Only 4 available",
          "details":{"available":4}},"requestId":"r"}"""
    ) as AppError.Api

    assertEquals(ApiErrorCode.INSUFFICIENT_STOCK, error.code)
    assertEquals("Only 4 available", error.message)
    assertFalse(error.retryable)
  }

  @Test
  fun `missing token responses require sign-in`() {
    val error = mapper.fromHttp(401, """{"error":{"code":"expired_token","message":"Your session has expired. Please sign in again."}}""") as AppError.Api
    assertEquals(ApiErrorCode.EXPIRED_TOKEN, error.code)
    assertTrue(error.requiresSignIn)
  }

  @Test
  fun `account gates surface as gates, not generic errors`() {
    val pending = mapper.fromHttp(403, """{"error":{"code":"retailer_pending_approval","message":"Your shop is still awaiting approval."}}""") as AppError.Api
    assertEquals(AccountGate.PENDING_APPROVAL, pending.gate)

    val suspended = mapper.fromHttp(403, """{"error":{"code":"account_suspended","message":"This account is suspended. Please contact Maharani Traders."}}""") as AppError.Api
    assertEquals(AccountGate.SUSPENDED, suspended.gate)

    val expired = mapper.fromHttp(403, """{"error":{"code":"access_expired","message":"Your access period has ended."}}""") as AppError.Api
    assertEquals(AccountGate.ACCESS_EXPIRED, expired.gate)
  }

  @Test
  fun `unknown codes stay retryable and never succeed silently`() {
    val error = mapper.fromHttp(409, """{"error":{"code":"brand_new_server_code","message":"Something changed."}}""") as AppError.Api
    assertEquals(ApiErrorCode.UNKNOWN, error.code)
    assertTrue(error.retryable)
    assertEquals("Something changed.", error.message)
  }

  @Test
  fun `falls back to a conservative code when the body is unusable`() {
    assertEquals(ApiErrorCode.DATABASE_UNAVAILABLE, (mapper.fromHttp(503, null) as AppError.Api).code)
    assertEquals(ApiErrorCode.RATE_LIMITED, (mapper.fromHttp(429, "<html>nope</html>") as AppError.Api).code)
    assertEquals(ApiErrorCode.INVALID_TOKEN, (mapper.fromHttp(401, "") as AppError.Api).code)
    // Never leaks the raw body.
    val text = (mapper.fromHttp(500, "SQLSTATE 42P01 relation \"orders\" does not exist") as AppError.Api).message
    assertFalse(text.contains("SQLSTATE"))
    assertFalse(text.contains("orders"))
  }

  @Test
  fun `network failures are retryable and offline-shaped`() {
    val timeout = mapper.fromThrowable(SocketTimeoutException("timed out"))
    assertTrue(timeout is AppError.Network)
    assertTrue(timeout.retryable)

    val io = mapper.fromThrowable(IOException("connection reset"))
    assertTrue(io is AppError.Network)
  }

  @Test
  fun `unexpected failures never expose their cause`() {
    val error = mapper.fromThrowable(IllegalStateException("ClassCastException in OrderRepository"))
    assertTrue(error is AppError.Unexpected)
    assertEquals("Something went wrong. Please try again.", error.message)
    assertFalse(error.message.contains("OrderRepository"))
  }
}
