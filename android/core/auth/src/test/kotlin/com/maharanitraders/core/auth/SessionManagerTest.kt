package com.maharanitraders.core.auth

import com.maharanitraders.core.common.AppResult
import com.maharanitraders.core.common.TimeSource
import com.maharanitraders.core.model.SessionTokens
import com.maharanitraders.core.network.ApiCallExecutor
import com.maharanitraders.core.network.ApiErrorMapper
import com.maharanitraders.core.network.MaharaniApi
import com.maharanitraders.core.network.dto.ApiEnvelope
import com.maharanitraders.core.network.dto.AccessDto
import com.maharanitraders.core.network.dto.HealthDto
import com.maharanitraders.core.network.dto.NavigationDto
import com.maharanitraders.core.network.dto.RetailerDto
import com.maharanitraders.core.network.dto.SessionDto
import com.maharanitraders.core.network.dto.SessionUserDto
import java.io.IOException
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import retrofit2.HttpException
import retrofit2.Response

/**
 * Session lifecycle contract for Phase B.
 *
 * What is asserted:
 *  - no network call at all without a stored, unexpired token;
 *  - a 401 clears stored tokens (the app can never keep retrying a dead session);
 *  - account gates keep tokens (recoverable) while suspension clears them;
 *  - transient failures keep the session and surface a retryable state;
 *  - the in-memory token handed to the interceptor is cleared on sign-out.
 *
 * Token REFRESH is deliberately absent: it is Phase C, together with sign-in.
 */
class SessionManagerTest {

  private val dispatcher = StandardTestDispatcher()

  private fun manager(
    api: FakeMaharaniApi,
    store: FakeTokenStore,
    now: Long = 1_000_000,
  ): SessionManager = SessionManager(
    api = api,
    tokenStore = store,
    executor = ApiCallExecutor(ApiErrorMapper(Json { ignoreUnknownKeys = true }), dispatcher),
    mapper = SessionMapper(),
    timeSource = FakeTimeSource(now),
  )

  private fun validTokens(expiresAt: Long = 2_000_000) = SessionTokens(
    accessToken = "access-token-1",
    refreshToken = "refresh-token-1",
    expiresAtEpochSeconds = expiresAt,
  )

  private fun sessionDto(
    role: String = "retailer",
    homeRoute: String = "/retailer/home",
    retailer: RetailerDto? = RetailerDto(status = "active", shopName = "Gupta Kirana Store"),
  ) = SessionDto(
    user = SessionUserDto(
      id = "user-1",
      email = "gupta@example.com",
      role = role,
      fullName = "Gupta Kirana",
      phone = "9876543210",
      isActive = true,
    ),
    retailer = retailer,
    access = AccessDto(status = "active", expiresAt = "2026-10-08T00:00:00.000Z"),
    navigation = NavigationDto(
      homeRoute = homeRoute,
      workspaces = listOf("retailer"),
      permissions = listOf("orders.create", "orders.view.own"),
    ),
  )

  private fun httpError(status: Int, code: String, message: String): HttpException =
    HttpException(
      Response.error<Any>(
        status,
        """{"error":{"code":"$code","message":"$message"},"requestId":"r"}"""
          .toResponseBody("application/json".toMediaType())
      )
    )

  @Test
  fun `never calls the network when there is no stored session`() = runTest {
    val api = FakeMaharaniApi()
    val store = FakeTokenStore(initial = null)
    val session = manager(api, store)

    val state = session.restore()

    assertEquals(SessionState.SignedOut(SignOutReason.NEVER_SIGNED_IN), state)
    assertEquals(0, api.sessionCalls)
    assertNull(session.accessToken())
  }

  @Test
  fun `an expired stored token is cleared without a network call`() = runTest {
    val api = FakeMaharaniApi()
    val store = FakeTokenStore(initial = validTokens(expiresAt = 999_000))
    val session = manager(api, store)

    val state = session.restore()

    assertEquals(SessionState.SignedOut(SignOutReason.SESSION_EXPIRED), state)
    assertEquals(0, api.sessionCalls)
    assertNull(store.stored)
  }

  @Test
  fun `restores a verified session with the server navigation policy`() = runTest {
    val api = FakeMaharaniApi().apply { nextResult = { ApiEnvelope(sessionDto()) } }
    val store = FakeTokenStore(initial = validTokens())
    val session = manager(api, store)

    val state = session.restore()

    assertTrue(state is SessionState.Authenticated)
    val snapshot = (state as SessionState.Authenticated).snapshot
    assertEquals("user-1", snapshot.user.id)
    assertEquals("/retailer/home", snapshot.navigation.homeRoute)
    assertTrue(snapshot.navigation.can("orders.create"))
    assertEquals(1, api.sessionCalls)
    // The interceptor can now authenticate requests from memory.
    assertEquals("access-token-1", session.accessToken())
  }

  @Test
  fun `a rejected token clears the session and requires sign-in`() = runTest {
    val api = FakeMaharaniApi().apply {
      nextResult = { throw httpError(401, "invalid_token", "Please sign in again.") }
    }
    val store = FakeTokenStore(initial = validTokens())
    val session = manager(api, store)

    val state = session.restore()

    assertEquals(SessionState.SignedOut(SignOutReason.SESSION_EXPIRED), state)
    assertNull(store.stored)
    assertNull(session.accessToken())
  }

  @Test
  fun `pending approval keeps the tokens so the shop can retry after approval`() = runTest {
    val api = FakeMaharaniApi().apply {
      nextResult = { throw httpError(403, "retailer_pending_approval", "Your shop is still awaiting approval.") }
    }
    val store = FakeTokenStore(initial = validTokens())
    val session = manager(api, store)

    val state = session.restore()

    assertEquals(SessionState.SignedOut(SignOutReason.PENDING_APPROVAL), state)
    assertNotNull("tokens must be kept for a recoverable gate", store.stored)
  }

  @Test
  fun `a lapsed access period keeps the tokens`() = runTest {
    val api = FakeMaharaniApi().apply {
      nextResult = { throw httpError(403, "access_expired", "Your access period has ended.") }
    }
    val store = FakeTokenStore(initial = validTokens())
    val session = manager(api, store)

    val state = session.restore()

    assertEquals(SessionState.SignedOut(SignOutReason.ACCESS_EXPIRED), state)
    assertNotNull(store.stored)
  }

  @Test
  fun `suspension and deactivation clear the session`() = runTest {
    val suspended = FakeMaharaniApi().apply {
      nextResult = { throw httpError(403, "account_suspended", "This account is suspended.") }
    }
    val store = FakeTokenStore(initial = validTokens())
    val session = manager(suspended, store)
    assertEquals(SessionState.SignedOut(SignOutReason.ACCOUNT_SUSPENDED), session.restore())
    assertNull(store.stored)

    val inactive = FakeMaharaniApi().apply {
      nextResult = { throw httpError(403, "account_inactive", "This account is not active.") }
    }
    val store2 = FakeTokenStore(initial = validTokens())
    val session2 = manager(inactive, store2)
    assertEquals(SessionState.SignedOut(SignOutReason.ACCOUNT_INACTIVE), session2.restore())
    assertNull(store2.stored)
  }

  @Test
  fun `offline keeps the session and offers retry instead of signing the user out`() = runTest {
    val api = FakeMaharaniApi().apply { nextResult = { throw IOException("no network") } }
    val store = FakeTokenStore(initial = validTokens())
    val session = manager(api, store)

    val state = session.restore()

    assertTrue(state is SessionState.Unavailable)
    assertTrue((state as SessionState.Unavailable).retryable)
    assertNotNull(store.stored)
  }

  @Test
  fun `a server outage is retryable and never treated as success`() = runTest {
    val api = FakeMaharaniApi().apply {
      nextResult = { throw httpError(503, "database_unavailable", "The service is temporarily unavailable.") }
    }
    val store = FakeTokenStore(initial = validTokens())
    val session = manager(api, store)

    val state = session.restore()

    assertTrue(state is SessionState.Unavailable)
    assertTrue((state as SessionState.Unavailable).retryable)
  }

  @Test
  fun `an unusable payload signs out instead of routing somewhere arbitrary`() = runTest {
    val api = FakeMaharaniApi().apply {
      nextResult = { ApiEnvelope(sessionDto(role = "regional_manager")) }
    }
    val store = FakeTokenStore(initial = validTokens())
    val session = manager(api, store)

    val state = session.restore()

    assertEquals(SessionState.SignedOut(SignOutReason.UNSUPPORTED_ACCOUNT), state)
    assertNull(store.stored)
  }

  @Test
  fun `sign out wipes storage and the in-memory token`() = runTest {
    val api = FakeMaharaniApi().apply { nextResult = { ApiEnvelope(sessionDto()) } }
    val store = FakeTokenStore(initial = validTokens())
    val session = manager(api, store)
    session.restore()
    assertEquals("access-token-1", session.accessToken())

    session.signOut()

    assertEquals(SessionState.SignedOut(SignOutReason.SIGNED_OUT), session.state.value)
    assertNull(store.stored)
    assertNull(session.accessToken())
  }

  @Test
  fun `restore publishes Restoring first so the shell keeps the splash up`() = runTest {
    val api = FakeMaharaniApi().apply { nextResult = { ApiEnvelope(sessionDto()) } }
    val session = manager(api, FakeTokenStore(initial = validTokens()))
    assertEquals(SessionState.Restoring, session.state.value)
    session.restore()
    assertTrue(session.state.value is SessionState.Authenticated)
  }
}

class SessionMapperTest {

  private val mapper = SessionMapper()

  private fun dto(
    role: String = "retailer",
    homeRoute: String = "/retailer/home",
    workspaces: List<String> = listOf("retailer"),
    permissions: List<String> = listOf("orders.create"),
  ) = SessionDto(
    user = SessionUserDto(id = "u1", role = role, isActive = true),
    navigation = NavigationDto(homeRoute = homeRoute, workspaces = workspaces, permissions = permissions),
  )

  @Test
  fun `maps a complete payload`() {
    val snapshot = mapper.toSnapshot(dto())
    assertNotNull(snapshot)
    assertEquals("/retailer/home", snapshot!!.navigation.homeRoute)
    assertEquals(1, snapshot.navigation.workspaces.size)
  }

  @Test
  fun `rejects anything it cannot route safely`() {
    assertNull(mapper.toSnapshot(dto(role = "unknown_role")))
    assertNull(mapper.toSnapshot(dto(homeRoute = "   ")))
    assertNull(mapper.toSnapshot(dto(homeRoute = "")))
  }

  @Test
  fun `drops workspaces this build does not know`() {
    val snapshot = mapper.toSnapshot(dto(workspaces = listOf("retailer", "time_travel")))
    assertNotNull(snapshot)
    assertEquals(1, snapshot!!.navigation.workspaces.size)
  }

  @Test
  fun `permissions are trimmed, de-duplicated and never invented`() {
    val snapshot = mapper.toSnapshot(dto(permissions = listOf(" orders.create ", "", "orders.create")))
    assertEquals(setOf("orders.create"), snapshot!!.navigation.permissions)
    assertTrue(!snapshot.navigation.can("coins.manage"))
  }
}

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

class FakeTokenStore(initial: SessionTokens? = null) : TokenStore {
  var stored: SessionTokens? = initial
    private set

  var writeCount: Int = 0
    private set

  override suspend fun read(): SessionTokens? = stored

  override suspend fun write(tokens: SessionTokens) {
    stored = tokens
    writeCount += 1
  }

  override suspend fun clear() {
    stored = null
  }
}

class FakeTimeSource(var now: Long) : TimeSource {
  override fun nowEpochSeconds(): Long = now
}

class FakeMaharaniApi : MaharaniApi {
  var sessionCalls: Int = 0
    private set

  var nextResult: () -> ApiEnvelope<SessionDto> = { throw IOException("not configured") }

  override suspend fun health(): ApiEnvelope<HealthDto> =
    throw UnsupportedOperationException("health is not used by the session layer")

  override suspend fun session(): ApiEnvelope<SessionDto> {
    sessionCalls += 1
    return nextResult()
  }
}
