package com.maharanitraders.core.network

import com.maharanitraders.core.network.dto.ApiEnvelope
import com.maharanitraders.core.network.dto.ApiErrorEnvelope
import com.maharanitraders.core.network.dto.HealthDto
import com.maharanitraders.core.network.dto.MobileNotificationPreferencesDto
import com.maharanitraders.core.network.dto.SessionDto
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory

/**
 * Serialization contract tests: the app must parse exactly what the server
 * sends (verified against `app/api/mobile/v1/session/route.ts`) and must
 * tolerate additive server changes without crashing.
 */
class ApiSerializationTest {

  private val json = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
    coerceInputValues = true
  }

  @Test
  fun `parses the session response the server actually sends`() {
    val body = """
      {
        "data": {
          "user": {
            "id": "5f0c1a2e-0000-0000-0000-000000000001",
            "email": "gupta@example.com",
            "role": "retailer",
            "fullName": "Gupta Kirana",
            "phone": "9876543210",
            "isActive": true
          },
          "retailer": { "status": "active", "shopName": "Gupta Kirana Store" },
          "access": { "status": "active", "expiresAt": "2026-10-08T00:00:00.000Z" },
          "navigation": {
            "homeRoute": "/retailer/home",
            "workspaces": ["retailer"],
            "permissions": ["orders.create", "orders.view.own", "products.view"]
          }
        },
        "requestId": "0f1c2d3e"
      }
    """.trimIndent()

    val envelope = json.decodeFromString(ApiEnvelope.serializer(SessionDto.serializer()), body)

    assertEquals("0f1c2d3e", envelope.requestId)
    assertEquals("retailer", envelope.data.user.role)
    assertEquals("Gupta Kirana Store", envelope.data.retailer?.shopName)
    assertEquals("/retailer/home", envelope.data.navigation.homeRoute)
    assertEquals(listOf("retailer"), envelope.data.navigation.workspaces)
    assertTrue(envelope.data.navigation.permissions.contains("orders.create"))
  }

  @Test
  fun `tolerates a newer server adding fields and omitting optional ones`() {
    val body = """
      {
        "data": {
          "user": { "id": "u1", "role": "salesman", "isActive": true, "loyaltyTier": "gold" },
          "navigation": { "homeRoute": "/salesman/dashboard", "workspaces": ["salesman"], "permissions": [], "extra": 42 },
          "retailer": null,
          "access": null,
          "unexpectedTopLevel": { "a": 1 }
        }
      }
    """.trimIndent()

    val envelope = json.decodeFromString(ApiEnvelope.serializer(SessionDto.serializer()), body)

    assertNull(envelope.requestId)
    assertNull(envelope.data.user.email)
    assertNull(envelope.data.retailer)
    assertEquals("/salesman/dashboard", envelope.data.navigation.homeRoute)
  }

  @Test
  fun `parses the error envelope including details`() {
    val body = """
      {
        "error": {
          "code": "insufficient_stock",
          "message": "Only 4 available",
          "details": { "available": 4, "fields": { "quantity": "Too many" } }
        },
        "requestId": "abc123"
      }
    """.trimIndent()

    val envelope = json.decodeFromString(ApiErrorEnvelope.serializer(), body)

    assertEquals("insufficient_stock", envelope.error.code)
    assertEquals("Only 4 available", envelope.error.message)
    assertEquals(4, envelope.error.details?.available)
    assertEquals("Too many", envelope.error.details?.fields?.get("quantity"))
  }

  @Test
  fun `encodes all notification preferences even when every value is the default`() {
    val body = json.encodeToString(
      MobileNotificationPreferencesDto.serializer(),
      MobileNotificationPreferencesDto(),
    )
    assertEquals(
      """{"orderUpdates":true,"paymentUpdates":true,"walletUpdates":true,"offerUpdates":true}""",
      body,
    )
    val defaults = json.decodeFromString(MobileNotificationPreferencesDto.serializer(), "{}")
    assertTrue(defaults.orderUpdates && defaults.paymentUpdates && defaults.walletUpdates && defaults.offerUpdates)
  }

  @Test
  fun `parses the health response`() {
    val body = """
      { "data": { "status": "ok", "database": "reachable", "apiVersion": "v1",
                  "serverTime": "2026-10-01T09:15:00.000Z", "latencyMs": 12 },
        "requestId": "r1" }
    """.trimIndent()

    val envelope = json.decodeFromString(ApiEnvelope.serializer(HealthDto.serializer()), body)

    assertEquals("ok", envelope.data.status)
    assertEquals("reachable", envelope.data.database)
    assertEquals(12L, envelope.data.latencyMs)
  }
}

/**
 * End-to-end header behaviour through Retrofit: a token is attached when the
 * session layer has one, and nothing is attached when it does not.
 */
class AuthInterceptorTest {

  private var server: MockWebServer? = null

  private fun apiWith(token: String?): Pair<MaharaniApi, MockWebServer> {
    val mockServer = MockWebServer()
    mockServer.enqueue(
      MockResponse()
        .setResponseCode(200)
        .setBody("""{"data":{"status":"ok","database":"reachable"},"requestId":"r"}""")
    )
    mockServer.start()
    server = mockServer

    val json = Json { ignoreUnknownKeys = true }
    val client = okhttp3.OkHttpClient.Builder()
      .addInterceptor(AuthInterceptor(RecordingTokenProvider(token)))
      .build()
    val retrofit = Retrofit.Builder()
      .baseUrl(mockServer.url("/"))
      .client(client)
      .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
      .build()
    return retrofit.create(MaharaniApi::class.java) to mockServer
  }

  @After
  fun tearDown() {
    server?.shutdown()
  }

  @Test
  fun `attaches the bearer token and platform marker`() = runBlocking {
    val (api, mockServer) = apiWith("access-token-123")

    api.health()

    val recorded = mockServer.takeRequest()
    assertEquals("Bearer access-token-123", recorded.getHeader("Authorization"))
    assertEquals("android", recorded.getHeader("X-Platform"))
    assertEquals("/api/mobile/v1/health", recorded.path)
    // The token must never travel in the URL.
    assertTrue(recorded.path?.contains("access-token") == false)
  }

  @Test
  fun `omits the authorization header when there is no token`() = runBlocking {
    val (api, mockServer) = apiWith(null)

    api.health()

    val recorded = mockServer.takeRequest()
    assertNull(recorded.getHeader("Authorization"))
    assertEquals("android", recorded.getHeader("X-Platform"))
  }

  @Test
  fun `blank tokens are never sent as an empty bearer`() {
    assertEquals("Bearer abc", AuthInterceptor.bearerHeaderValue("abc"))
    assertEquals("Bearer abc", AuthInterceptor.bearerHeaderValue("  abc  "))
    assertNull(AuthInterceptor.bearerHeaderValue(null))
    assertNull(AuthInterceptor.bearerHeaderValue("   "))
  }
}
