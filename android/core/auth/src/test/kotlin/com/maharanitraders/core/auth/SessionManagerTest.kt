package com.maharanitraders.core.auth

import com.maharanitraders.core.common.SessionScopedStore
import com.maharanitraders.core.common.TimeSource
import com.maharanitraders.core.datastore.AppPreferences
import com.maharanitraders.core.datastore.PreferenceStore
import com.maharanitraders.core.model.SessionTokens
import com.maharanitraders.core.network.ActiveTokenHolder
import com.maharanitraders.core.network.TokenRefreshCoordinator
import com.maharanitraders.core.network.ApiCallExecutor
import com.maharanitraders.core.network.ApiErrorMapper
import com.maharanitraders.core.network.MaharaniApi
import com.maharanitraders.core.network.dto.AccessDto
import com.maharanitraders.core.network.dto.AckDto
import com.maharanitraders.core.network.dto.ApiEnvelope
import com.maharanitraders.core.network.dto.AreasDto
import com.maharanitraders.core.network.dto.AuthSessionDto
import com.maharanitraders.core.network.dto.CatalogBrandsDto
import com.maharanitraders.core.network.dto.CatalogCategoriesDto
import com.maharanitraders.core.network.dto.CatalogProductDto
import com.maharanitraders.core.network.dto.CatalogSearchDto
import com.maharanitraders.core.network.dto.CartLineRequestDto
import com.maharanitraders.core.network.dto.CartQuantityRequestDto
import com.maharanitraders.core.network.dto.CheckoutQuoteDto
import com.maharanitraders.core.network.dto.CheckoutQuoteRequestDto
import com.maharanitraders.core.network.dto.CouponRemovedDto
import com.maharanitraders.core.network.dto.CouponRequestDto
import com.maharanitraders.core.network.dto.CouponResultDto
import com.maharanitraders.core.network.dto.HealthDto
import com.maharanitraders.core.network.dto.MobileAddressesDto
import com.maharanitraders.core.network.dto.MobileCartDto
import com.maharanitraders.core.network.dto.MobileDeliveryDto
import com.maharanitraders.core.network.dto.MobileInvoiceDto
import com.maharanitraders.core.network.dto.MobileOrderDto
import com.maharanitraders.core.network.dto.PlaceOrderRequestDto
import com.maharanitraders.core.network.dto.PlaceOrderResponseDto
import com.maharanitraders.core.network.dto.LoginRequestDto
import com.maharanitraders.core.network.dto.NavigationDto
import com.maharanitraders.core.network.dto.PasswordResetRequestDto
import com.maharanitraders.core.network.dto.PasswordUpdateRequestDto
import com.maharanitraders.core.network.dto.ProductDetailDto
import com.maharanitraders.core.network.dto.RefreshRequestDto
import com.maharanitraders.core.network.dto.RefreshSessionDto
import com.maharanitraders.core.network.dto.RegisterRetailerRequestDto
import com.maharanitraders.core.network.dto.RegisterRetailerResponseDto
import com.maharanitraders.core.network.dto.RetailerHomeDto
import com.maharanitraders.core.network.dto.RetailerDto
import com.maharanitraders.core.network.dto.SessionDto
import com.maharanitraders.core.network.dto.SessionUserDto
import java.io.IOException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import retrofit2.HttpException
import retrofit2.Response

/**
 * Session lifecycle contract (Phase C).
 *
 * What is asserted:
 *  - no network call at all without a stored, unexpired token;
 *  - an expired access token is refreshed exactly once and the session re-verified;
 *  - a refresh the server rejects clears storage and signs the user out, while a
 *    transient (network/5xx) failure keeps the stored tokens for the next launch;
 *  - a 401 clears stored tokens (the app can never keep retrying a dead session);
 *  - account gates keep tokens (recoverable) while suspension clears them;
 *  - transient failures keep the session and surface a retryable state;
 *  - the in-memory token handed to the interceptor is cleared on sign-out.
 *
 * Every test passes the shared `dispatcher` to `runTest` so the test body and the
 * code under test run on ONE TestCoroutineScheduler; two schedulers would make
 * `advanceUntilIdle()` throw "Detected use of different schedulers".
 */
class SessionManagerTest {

  private val dispatcher = StandardTestDispatcher()

  /**
   * The coordinator the network layer asks for a runtime refresh. One per test
   * instance, because the session manager installs its own refresher into it.
   */
  private val refreshCoordinator = TokenRefreshCoordinator()

  private fun manager(
    api: FakeMaharaniApi,
    store: FakeTokenStore,
    now: Long = 1_000_000,
    preferences: AppPreferences = AppPreferences(TestPreferenceStore()),
    /**
     * The same holder the interceptor reads. Tests that need to prove WHAT the
     * restore request carried hand one in, so the assertion is made against the
     * object the network layer would have used — not against a copy.
     */
    holder: ActiveTokenHolder = ActiveTokenHolder(),
    /** The account-scoped caches the session layer must clear when a session ends. */
    sessionScopedStores: Set<SessionScopedStore> = emptySet(),
  ): SessionManager {
    val executor = ApiCallExecutor(ApiErrorMapper(Json { ignoreUnknownKeys = true }), dispatcher)
    val timeSource = FakeTimeSource(now)
    return SessionManager(
      api = api,
      tokenStore = store,
      executor = executor,
      mapper = SessionMapper(),
      timeSource = timeSource,
      // Phase C gave SessionManager an AuthRepository so that sign-out can revoke
      // the refresh token server-side. This test is about the session lifecycle, so
      // the repository is wired to the same fakes and never exercised here.
      authRepository = AuthRepository(api = api, executor = executor, timeSource = timeSource),
      appPreferences = preferences,
      // The same holder the interceptor reads: `session.accessToken()` and the
      // Authorization header can never disagree, which is what the token tests
      // below rely on.
      tokenHolder = holder,
      sessionScopedStores = sessionScopedStores,
      tokenRefreshCoordinator = refreshCoordinator,
    )
  }

  private fun validTokens(expiresAt: Long = 2_000_000) = SessionTokens(
    accessToken = "access-token-1",
    refreshToken = "refresh-token-1",
    expiresAtEpochSeconds = expiresAt,
  )

  private fun sessionDto(
    role: String = "retailer",
    homeRoute: String = "/retailer/home",
    retailer: RetailerDto? = RetailerDto(status = "active", shopName = "Gupta Kirana Store"),
    userId: String = "user-1",
  ) = SessionDto(
    user = SessionUserDto(
      id = userId,
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
  fun `never calls the network when there is no stored session`() = runTest(dispatcher) {
    val api = FakeMaharaniApi()
    val store = FakeTokenStore(initial = null)
    val session = manager(api, store)

    val state = session.restore()

    assertEquals(SessionState.SignedOut(SignOutReason.NEVER_SIGNED_IN), state)
    assertEquals(0, api.sessionCalls)
    assertNull(session.accessToken())
  }

  @Test
  fun `an expired access token is refreshed once, then the session is verified`() = runTest(dispatcher) {
    // Phase B cleared an expired token on sight. Phase C refreshes it, so the
    // user keeps working through an ordinary access-token expiry.
    val api = FakeMaharaniApi().apply {
      nextRefreshResult = {
        ApiEnvelope(RefreshSessionDto(accessToken = "access-token-2", refreshToken = "refresh-token-2"))
      }
      nextResult = { ApiEnvelope(sessionDto()) }
    }
    val store = FakeTokenStore(initial = validTokens(expiresAt = 999_000))
    val session = manager(api, store)

    val state = session.restore()

    assertTrue(state is SessionState.Authenticated)
    assertEquals(1, api.refreshCalls)
    assertEquals(1, api.sessionCalls)
    // The rotated tokens are what the next launch reads, and the interceptor
    // carries the new access token rather than the expired one.
    assertEquals("access-token-2", store.stored?.accessToken)
    assertEquals("refresh-token-2", store.stored?.refreshToken)
    assertEquals("access-token-2", session.accessToken())
  }

  @Test
  fun `a rejected refresh wipes the session and signs the user out`() = runTest(dispatcher) {
    // The wire code is the contract's own: the refresh route answers a dead
    // refresh token with `401 invalid_token` ("Your session has expired. Please
    // sign in again."), and the platform agrees — docs/NATIVE_ANDROID_API_CONTRACT.md
    // §2.2. A test that invents a code the server never sends asserts behaviour
    // that cannot happen in production.
    val api = FakeMaharaniApi().apply {
      nextRefreshResult = { throw httpError(401, "invalid_token", "Your session has expired. Please sign in again.") }
    }
    val store = FakeTokenStore(initial = validTokens(expiresAt = 999_000))
    val session = manager(api, store)

    val state = session.restore()

    assertEquals(SessionState.SignedOut(SignOutReason.SESSION_EXPIRED), state)
    assertEquals(1, api.refreshCalls)
    // Terminal: the rejected token is not retried against the session endpoint,
    // and nothing is left on disk to retry with.
    assertEquals(0, api.sessionCalls)
    assertNull(store.stored)
    assertNull(session.accessToken())
  }

  @Test
  fun `an unreachable server during refresh keeps the stored tokens`() = runTest(dispatcher) {
    val api = FakeMaharaniApi().apply {
      nextRefreshResult = { throw IOException("offline") }
    }
    val store = FakeTokenStore(initial = validTokens(expiresAt = 999_000))
    val session = manager(api, store)

    val state = session.restore()

    assertTrue(state is SessionState.Unavailable)
    assertTrue((state as SessionState.Unavailable).retryable)
    assertEquals(0, api.sessionCalls)
    // Being offline says nothing about the refresh token: the user is offered a
    // retry, and the next launch still has something to retry with.
    assertEquals("refresh-token-1", store.stored?.refreshToken)
    assertNull(session.accessToken())
  }

  @Test
  fun `restores a verified session with the server navigation policy`() = runTest(dispatcher) {
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
  fun `a rejected token clears the session and requires sign-in`() = runTest(dispatcher) {
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
  fun `pending approval keeps the tokens so the shop can retry after approval`() = runTest(dispatcher) {
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
  fun `a lapsed access period keeps the tokens`() = runTest(dispatcher) {
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
  fun `suspension and deactivation clear the session`() = runTest(dispatcher) {
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
  fun `offline keeps the session and offers retry instead of signing the user out`() = runTest(dispatcher) {
    val api = FakeMaharaniApi().apply { nextResult = { throw IOException("no network") } }
    val store = FakeTokenStore(initial = validTokens())
    val session = manager(api, store)

    val state = session.restore()

    assertTrue(state is SessionState.Unavailable)
    assertTrue((state as SessionState.Unavailable).retryable)
    assertNotNull(store.stored)
  }

  @Test
  fun `a server outage is retryable and never treated as success`() = runTest(dispatcher) {
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
  fun `an unusable payload signs out instead of routing somewhere arbitrary`() = runTest(dispatcher) {
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
  fun `a fresh verified login clears a pending request key before account state is published`() = runTest(dispatcher) {
    val preferenceStore = TestPreferenceStore()
    val preferences = AppPreferences(preferenceStore)
    val oldPendingKey = preferences.getOrCreatePendingOrderRequestKey()
    val api = FakeMaharaniApi().apply {
      nextLoginResult = {
        ApiEnvelope(AuthSessionDto(
          accessToken = "new-access-token",
          refreshToken = "new-refresh-token",
          expiresAt = 2_000_000,
        ))
      }
      nextResult = { ApiEnvelope(sessionDto(userId = "different-user")) }
    }
    val tokenStore = FakeTokenStore()
    val session = manager(api, tokenStore, preferences = preferences)

    val state = session.signIn("different@example.com", "password")

    assertTrue(state is SessionState.Authenticated)
    assertEquals("different-user", (state as SessionState.Authenticated).snapshot.user.id)
    assertNull(preferences.pendingOrderRequestKey())
    assertEquals("new-access-token", session.accessToken())
    assertTrue(oldPendingKey.isNotBlank())
  }

  @Test
  fun `a fresh login fails closed when the pending order key cannot be cleared`() = runTest(dispatcher) {
    val preferenceStore = TestPreferenceStore()
    val preferences = AppPreferences(preferenceStore)
    val oldPendingKey = preferences.getOrCreatePendingOrderRequestKey()
    preferenceStore.failingRemoveKey = "pending_order_request"
    val api = FakeMaharaniApi().apply {
      nextLoginResult = {
        ApiEnvelope(AuthSessionDto(
          accessToken = "new-access-token",
          refreshToken = "new-refresh-token",
          expiresAt = 2_000_000,
        ))
      }
    }
    val tokenStore = FakeTokenStore()
    val session = manager(api, tokenStore, preferences = preferences)

    val state = session.signIn("different@example.com", "password")

    assertTrue(state is SessionState.Unavailable)
    assertNull(tokenStore.stored)
    assertNull(session.accessToken())
    assertEquals(0, api.sessionCalls)
    assertEquals(oldPendingKey, preferences.pendingOrderRequestKey())
  }

  @Test
  fun `sign out wipes storage and the in-memory token`() = runTest(dispatcher) {
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
  fun `restore verifies the session WITH the stored token attached to the request`() = runTest(dispatcher) {
    // REGRESSION TEST for the "I have to log in again every time" bug.
    //
    // `GET /api/mobile/v1/session` is bearer-authenticated: the Authorization
    // header comes from the interceptor reading the in-memory holder. restore()
    // used to publish that token only AFTER the response came back, so every
    // cold start asked the server anonymously, got 401, and — obeying its own
    // "the server refused the token" rule — wiped the stored session and showed
    // the sign-in screen. Asserting the state alone would not catch it (the
    // fake answers whatever it is told to); this asserts what the request
    // carried.
    val holder = ActiveTokenHolder()
    val api = FakeMaharaniApi(holder).apply { nextResult = { ApiEnvelope(sessionDto()) } }
    val session = manager(api, FakeTokenStore(initial = validTokens()), holder = holder)

    val state = session.restore()

    assertTrue(state is SessionState.Authenticated)
    assertEquals(1, api.sessionCalls)
    assertEquals("access-token-1", api.tokenDuringSessionCall)
    assertEquals("access-token-1", session.accessToken())
  }

  @Test
  fun `restore verifies with the rotated token after refreshing an expired one`() = runTest(dispatcher) {
    val holder = ActiveTokenHolder()
    val api = FakeMaharaniApi(holder).apply {
      nextRefreshResult = {
        ApiEnvelope(RefreshSessionDto(accessToken = "access-token-2", refreshToken = "refresh-token-2"))
      }
      nextResult = { ApiEnvelope(sessionDto()) }
    }
    val session = manager(
      api,
      FakeTokenStore(initial = validTokens(expiresAt = 999_000)),
      holder = holder,
    )

    val state = session.restore()

    assertTrue(state is SessionState.Authenticated)
    // The verification must carry the NEW token: sending the expired one would
    // be rejected exactly like sending none.
    assertEquals("access-token-2", api.tokenDuringSessionCall)
  }

  @Test
  fun `a runtime refresh persists and publishes the new access token`() = runTest(dispatcher) {
    // The 401 path: the app was already running when the access token expired.
    val api = FakeMaharaniApi()
    api.nextRefreshResult = {
      ApiEnvelope(
        RefreshSessionDto(
          accessToken = "access-token-2",
          refreshToken = "refresh-token-2",
          expiresAt = 2_000_000,
        ),
      )
    }
    val store = FakeTokenStore(initial = validTokens(expiresAt = 999_000))
    val holder = ActiveTokenHolder()
    val session = manager(api, store, holder = holder)

    val fresh = session.refreshAccessToken()

    assertEquals("access-token-2", fresh)
    // The interceptor's holder and the encrypted store must both carry the new
    // pair: publishing one without the other is how a session half-survives.
    assertEquals("access-token-2", holder.accessToken())
    assertEquals("access-token-2", store.stored?.accessToken)
    assertEquals("refresh-token-2", store.stored?.refreshToken)
  }

  @Test
  fun `a runtime refresh the server refuses ends the session`() = runTest(dispatcher) {
    val api = FakeMaharaniApi()
    api.nextRefreshResult = { throw httpError(401, "invalid_token", "Please sign in again.") }
    val store = FakeTokenStore(initial = validTokens(expiresAt = 999_000))
    val holder = ActiveTokenHolder()
    val session = manager(api, store, holder = holder)

    val fresh = session.refreshAccessToken()

    assertNull(fresh)
    assertNull(store.stored)
    assertNull(holder.accessToken())
    assertEquals(
      SessionState.SignedOut(SignOutReason.SESSION_EXPIRED),
      session.state.value,
    )
  }

  @Test
  fun `a runtime refresh that cannot reach the server keeps the session`() = runTest(dispatcher) {
    // The session was verified at launch with a token that is still valid — the
    // state the app is in when, an hour later, a request's refresh cannot reach
    // the server. (The token must NOT be expired here: with an expired token
    // `restore()` would refresh first, which is a different test.)
    val api = FakeMaharaniApi().apply { nextResult = { ApiEnvelope(sessionDto()) } }
    val store = FakeTokenStore(initial = validTokens())
    val holder = ActiveTokenHolder()
    val session = manager(api, store, holder = holder)
    assertTrue(session.restore() is SessionState.Authenticated)

    api.nextRefreshResult = { throw IOException("no route to host") }
    val fresh = session.refreshAccessToken()

    assertNull(fresh)
    // A blip must not sign the shopper out or throw away the tokens: the next
    // request (or the next launch) can still refresh.
    assertEquals("refresh-token-1", store.stored?.refreshToken)
    assertTrue(session.state.value is SessionState.Authenticated)
  }

  @Test
  fun `the session manager installs the network layer's refresher`() = runTest(dispatcher) {
    val api = FakeMaharaniApi()
    api.nextRefreshResult = {
      ApiEnvelope(
        RefreshSessionDto(accessToken = "access-token-2", refreshToken = "refresh-token-2"),
      )
    }
    val store = FakeTokenStore(initial = validTokens(expiresAt = 999_000))
    val session = manager(api, store, holder = ActiveTokenHolder())

    // What ApiCallExecutor does when a request answers 401 invalid_token.
    val fresh = refreshCoordinator.refresh("access-token-1")

    assertEquals("access-token-2", fresh)
    assertEquals(1, api.refreshCalls)
  }

  @Test
  fun `sign out clears the account-scoped caches`() = runTest(dispatcher) {
    val scoped = RecordingSessionScopedStore()
    val api = FakeMaharaniApi().apply { nextResult = { ApiEnvelope(sessionDto()) } }
    val session = manager(
      api,
      FakeTokenStore(initial = validTokens()),
      sessionScopedStores = setOf(scoped),
    )
    session.restore()

    session.signOut()

    assertEquals(1, scoped.clearCount)
  }

  @Test
  fun `a token the server refuses at startup clears the account-scoped caches`() = runTest(dispatcher) {
    val scoped = RecordingSessionScopedStore()
    val api = FakeMaharaniApi().apply {
      nextResult = { throw httpError(401, "invalid_token", "Your session has expired.") }
    }
    val session = manager(
      api,
      FakeTokenStore(initial = validTokens()),
      sessionScopedStores = setOf(scoped),
    )

    val state = session.restore()

    assertEquals(SessionState.SignedOut(SignOutReason.SESSION_EXPIRED), state)
    assertEquals(1, scoped.clearCount)
  }

  @Test
  fun `an unverified session publishes no account-scoped data`() = runTest(dispatcher) {
    // Offline at launch keeps the tokens (the next launch may still work), but
    // the shell shows the connection screen — so the caches of the account that
    // was signed in must not sit in memory waiting to be shown.
    val scoped = RecordingSessionScopedStore()
    val api = FakeMaharaniApi().apply { nextResult = { throw IOException("no route to host") } }
    val session = manager(
      api,
      FakeTokenStore(initial = validTokens()),
      sessionScopedStores = setOf(scoped),
    )

    val state = session.restore()

    assertTrue(state is SessionState.Unavailable)
    assertEquals(1, scoped.clearCount)
  }

  @Test
  fun `a second account cannot inherit the first account's cached state`() = runTest(dispatcher) {
    val privateData = mutableMapOf<String, String>()
    val scoped = object : SessionScopedStore {
      var clearCount = 0
      override suspend fun onSessionEnded() { clearCount++; privateData.clear() }
    }
    val api = FakeMaharaniApi().apply {
      nextResult = { ApiEnvelope(sessionDto(userId = "user-1")) }
      nextLoginResult = {
        ApiEnvelope(
          AuthSessionDto(
            accessToken = "second-access-token",
            refreshToken = "second-refresh-token",
            expiresAt = 2_000_000,
          )
        )
      }
    }
    val session = manager(
      api,
      FakeTokenStore(initial = validTokens()),
      sessionScopedStores = setOf(scoped),
    )

    // Account A signs in and loads its own favourites/badges (the caches it
    // populated are represented by the store's count).
    assertTrue(session.restore() is SessionState.Authenticated)
    val domains = listOf("orders", "cart", "favorites", "addresses", "Coins", "notifications", "saved carts")
    domains.forEach { privateData[it] = "user-1 private $it" }
    session.signOut()
    assertTrue(privateData.isEmpty())

    // Account B signs in on the SAME device.
    api.nextResult = { ApiEnvelope(sessionDto(userId = "user-2")) }
    val second = session.signIn("second@example.com", "password")

    assertTrue(second is SessionState.Authenticated)
    assertEquals("user-2", (second as SessionState.Authenticated).snapshot.user.id)
    // Once for A's sign-out, once while accepting B — never zero, which is the
    // leak this test exists to prevent.
    assertTrue(scoped.clearCount >= 2)
    assertTrue(privateData.isEmpty())
    domains.forEach { privateData[it] = "user-2 private $it" }
    assertTrue(privateData.values.none { it.contains("user-1") })
  }

  @Test
  fun `sign in does not replace the sign-in screen with the restoring state`() = runTest(dispatcher) {
    // The shell renders `Restoring` as the full-screen brand splash. Publishing
    // it while the credentials are being checked would blank the form the
    // shopper is typing into (and its own progress state) and then bring it
    // back — the login-screen flashing the shell is supposed to avoid.
    var stateWhileLoggingIn: SessionState? = null
    // The fake's `session()` endpoint is a member function, so the lambda that
    // reads the session state has to be assigned AFTER the manager exists:
    // inside an `apply { }` block the fake's own `session()` would win over the
    // local and the reference would not compile.
    val api = FakeMaharaniApi()
    val store = FakeTokenStore()
    val session = manager(api, store)
    api.nextResult = { ApiEnvelope(sessionDto()) }
    api.nextLoginResult = {
      stateWhileLoggingIn = session.state.value
      ApiEnvelope(
        AuthSessionDto(
          accessToken = "fresh-access-token",
          refreshToken = "fresh-refresh-token",
          expiresAt = 2_000_000,
        )
      )
    }
    session.signOut()
    assertEquals(SessionState.SignedOut(SignOutReason.SIGNED_OUT), session.state.value)

    val state = session.signIn("gupta@example.com", "password")

    assertTrue(state is SessionState.Authenticated)
    assertTrue(
      "the sign-in screen must not be replaced by the splash mid-submit",
      stateWhileLoggingIn !is SessionState.Restoring,
    )
    assertEquals("fresh-access-token", store.stored?.accessToken)
  }

  @Test
  fun `restore publishes Restoring first so the shell keeps the splash up`() = runTest(dispatcher) {
    val api = FakeMaharaniApi().apply { nextResult = { ApiEnvelope(sessionDto()) } }
    val session = manager(api, FakeTokenStore(initial = validTokens()))
    assertEquals(SessionState.Restoring, session.state.value)
    session.restore()
    assertTrue(session.state.value is SessionState.Authenticated)
  }

  // ---------------------------------------------------------------------------
  // Persistence: failed saves, refresh-token rotation recovery, concurrent
  // refresh and sign-out cleanup. Each of these was silently wrong before the
  // save outcome became explicit.
  // ---------------------------------------------------------------------------

  private fun loginSucceeds(api: FakeMaharaniApi) {
    api.nextLoginResult = {
      ApiEnvelope(
        AuthSessionDto(accessToken = "new-access-token", refreshToken = "new-refresh-token", expiresAt = 2_000_000),
      )
    }
  }

  /** A server that rotates `refresh-token-1` into `refresh-token-2` on the first refresh. */
  private fun rotatesOnRefresh(api: FakeMaharaniApi) {
    api.nextRefreshResult = {
      ApiEnvelope(
        RefreshSessionDto(accessToken = "access-token-2", refreshToken = "refresh-token-2", expiresAt = 2_000_000),
      )
    }
  }

  @Test
  fun `a sign-in whose credentials cannot be saved is not authenticated and keeps nothing`() = runTest(dispatcher) {
    val holder = ActiveTokenHolder()
    val api = FakeMaharaniApi(holder).apply {
      loginSucceeds(this)
      nextResult = { ApiEnvelope(sessionDto()) }
    }
    val store = FakeTokenStore().apply { failWrites = true }
    val session = manager(api, store, holder = holder)

    val state = session.signIn("gupta@example.com", "password")

    assertTrue(state is SessionState.Unavailable && state.retryable)
    assertEquals(SESSION_NOT_SAVED_MESSAGE, (state as SessionState.Unavailable).message)
    // Nothing authenticated may run on credentials the device could not keep.
    assertEquals(0, api.sessionCalls)
    assertNull(holder.accessToken())
    assertNull(store.stored)
  }

  @Test
  fun `a save that reads back different credentials counts as a failed save`() = runTest(dispatcher) {
    val holder = ActiveTokenHolder()
    val api = FakeMaharaniApi(holder).apply {
      loginSucceeds(this)
      nextResult = { ApiEnvelope(sessionDto()) }
    }
    val store = FakeTokenStore().apply { corruptWrites = true }
    val session = manager(api, store, holder = holder)

    val state = session.signIn("gupta@example.com", "password")

    assertTrue(state is SessionState.Unavailable && state.retryable)
    assertEquals(0, api.sessionCalls)
    assertNull(holder.accessToken())
    assertNull(store.stored)
  }

  @Test
  fun `a rotated pair that cannot be saved is withheld, then saved on retry without reusing the old refresh token`() =
    runTest(dispatcher) {
      val holder = ActiveTokenHolder()
      val api = FakeMaharaniApi(holder).apply {
        rotatesOnRefresh(this)
        nextResult = { ApiEnvelope(sessionDto()) }
      }
      val store = FakeTokenStore(initial = validTokens(expiresAt = 999_000)).apply { failWrites = true }
      val session = manager(api, store, holder = holder)

      val first = session.restore()

      assertTrue(first is SessionState.Unavailable && first.retryable)
      // Access is withheld: the rotated token is not handed to the interceptor and
      // no verification request runs with it.
      assertNull(holder.accessToken())
      assertEquals(0, api.sessionCalls)
      // The disk still holds the pre-rotation pair. The server has invalidated it.
      assertEquals("refresh-token-1", store.stored?.refreshToken)

      store.failWrites = false
      val second = session.restore()

      assertTrue(second is SessionState.Authenticated)
      // The retry saved the pending pair and did not refresh again. The only
      // refresh the server ever saw used the original token.
      assertEquals(1, api.refreshCalls)
      assertEquals(listOf("refresh-token-1"), api.refreshTokensUsed)
      assertEquals("refresh-token-2", store.stored?.refreshToken)
      assertEquals("access-token-2", api.tokenDuringSessionCall)
    }

  @Test
  fun `a runtime rotation that cannot be saved is kept in memory and reused without another server call`() =
    runTest(dispatcher) {
      val holder = ActiveTokenHolder()
      val api = FakeMaharaniApi(holder).apply {
        nextResult = { ApiEnvelope(sessionDto()) }
        rotatesOnRefresh(this)
      }
      val store = FakeTokenStore(initial = validTokens())
      val session = manager(api, store, holder = holder)
      assertTrue(session.restore() is SessionState.Authenticated)

      store.failWrites = true
      assertNull(session.refreshAccessToken())
      assertNull(holder.accessToken())

      store.failWrites = false
      assertEquals("access-token-2", session.refreshAccessToken())

      assertEquals(1, api.refreshCalls)
      assertEquals("access-token-2", holder.accessToken())
      assertEquals("refresh-token-2", store.stored?.refreshToken)
    }

  @Test
  fun `signing out discards a pending rotated pair so it is never written back`() = runTest(dispatcher) {
    val holder = ActiveTokenHolder()
    val api = FakeMaharaniApi(holder).apply {
      rotatesOnRefresh(this)
      nextResult = { ApiEnvelope(sessionDto()) }
    }
    val store = FakeTokenStore(initial = validTokens(expiresAt = 999_000)).apply { failWrites = true }
    val session = manager(api, store, holder = holder)
    assertTrue(session.restore() is SessionState.Unavailable)

    session.signOut()
    store.failWrites = false
    val state = session.restore()

    // The pending pair belonged to the session that just ended. It must not come
    // back to disk on the next restore.
    assertEquals(SessionState.SignedOut(SignOutReason.NEVER_SIGNED_IN), state)
    assertNull(store.stored)
    assertNull(holder.accessToken())
    assertEquals(1, api.refreshCalls)
  }

  @Test
  fun `concurrent 401s during one refresh cost one server refresh and one durable save`() = runTest(dispatcher) {
    val holder = ActiveTokenHolder()
    val api = FakeMaharaniApi(holder).apply {
      nextResult = { ApiEnvelope(sessionDto()) }
      rotatesOnRefresh(this)
    }
    val store = FakeTokenStore(initial = validTokens())
    val session = manager(api, store, holder = holder)
    assertTrue(session.restore() is SessionState.Authenticated)
    val writesBefore = store.writeCount

    // Eight requests all fail with the same stale access token at once.
    val results = coroutineScope {
      List(8) { async { refreshCoordinator.refresh("access-token-1") } }.awaitAll()
    }

    assertEquals(1, api.refreshCalls)
    assertEquals(writesBefore + 1, store.writeCount)
    assertTrue(results.any { it == "access-token-2" })
    assertTrue(results.filterNotNull().all { it == "access-token-2" })
    assertEquals("refresh-token-2", store.stored?.refreshToken)
  }

  // ---------------------------------------------------------------------------
  // Concurrency regressions. Every ordering below is forced with a Gate, so the
  // interleaving is the same on every run. None of them depends on timing.
  // ---------------------------------------------------------------------------

  @Test
  fun `sign-out during session verification is not overwritten by a late Authenticated`() = runTest(dispatcher) {
    val holder = ActiveTokenHolder()
    val api = FakeMaharaniApi(holder).apply {
      loginSucceeds(this)
      nextResult = { ApiEnvelope(sessionDto()) }
      sessionGate = Gate()
    }
    val store = FakeTokenStore()
    val session = manager(api, store, holder = holder)

    val signingIn = async { session.signIn("gupta@example.com", "password") }
    api.sessionGate!!.entered.await()
    // The shopper signs out while the server is still verifying the new account.
    session.signOut()
    api.sessionGate!!.release.complete(Unit)
    signingIn.await()

    assertEquals(SessionState.SignedOut(SignOutReason.SIGNED_OUT), session.state.value)
    assertNull(holder.accessToken())
    assertNull(store.stored)
  }

  @Test
  fun `a refresh refused for account A after account B signs in cannot clear account B`() = runTest(dispatcher) {
    val holder = ActiveTokenHolder()
    val api = FakeMaharaniApi(holder).apply {
      nextResult = { ApiEnvelope(sessionDto(userId = "account-a")) }
      loginSucceeds(this)
    }
    val store = FakeTokenStore(initial = validTokens())
    val session = manager(api, store, holder = holder)
    assertTrue(session.restore() is SessionState.Authenticated)

    api.refreshGate = Gate()
    api.nextRefreshResult = { throw httpError(401, "invalid_token", "Your session has expired. Please sign in again.") }
    val refreshingA = async { session.refreshAccessToken() }
    api.refreshGate!!.entered.await()

    // Account A is signed out and account B signs in while A's refresh is in flight.
    session.signOut()
    api.nextResult = { ApiEnvelope(sessionDto(userId = "account-b")) }
    assertTrue(session.signIn("b@example.com", "password") is SessionState.Authenticated)

    api.refreshGate!!.release.complete(Unit)
    assertNull(refreshingA.await())

    val current = session.state.value
    assertTrue("account B must survive A's late refusal", current is SessionState.Authenticated)
    assertEquals("account-b", (current as SessionState.Authenticated).snapshot.user.id)
    assertEquals("new-access-token", holder.accessToken())
    assertEquals("new-refresh-token", store.stored?.refreshToken)
  }

  @Test
  fun `a newer pending pair is not wiped when the superseded token is rejected during restore`() = runTest(dispatcher) {
    val holder = ActiveTokenHolder()
    val api = FakeMaharaniApi(holder).apply {
      rotatesOnRefresh(this)
      nextResult = { throw httpError(401, "invalid_token", "Please sign in again.") }
      sessionGate = Gate()
    }
    val store = FakeTokenStore(initial = validTokens())
    val session = manager(api, store, holder = holder)

    val restoring = async { session.restore() }
    // Restore has selected access-token-1 and is verifying it.
    api.sessionGate!!.entered.await()
    // A runtime rotation lands meanwhile, but its encrypted write fails, so the new
    // pair is pending in memory while the disk still holds the superseded pair.
    store.failWrites = true
    assertNull(session.refreshAccessToken())
    // The verification now answers with the rejection of the superseded token.
    api.sessionGate!!.release.complete(Unit)
    val first = restoring.await()

    assertTrue(first is SessionState.Unavailable && first.retryable)
    assertNull(holder.accessToken())
    // The rejection must not clear storage or the pending pair.
    assertEquals("refresh-token-1", store.stored?.refreshToken)

    store.failWrites = false
    api.nextResult = { ApiEnvelope(sessionDto()) }
    val second = session.restore()

    assertTrue(second is SessionState.Authenticated)
    assertEquals(1, api.refreshCalls)
    assertEquals("refresh-token-2", store.stored?.refreshToken)
    assertEquals("access-token-2", api.tokenDuringSessionCall)
  }

  @Test
  fun `two concurrent restores spend the starting refresh token exactly once`() = runTest(dispatcher) {
    val holder = ActiveTokenHolder()
    val api = FakeMaharaniApi(holder).apply {
      rotatesOnRefresh(this)
      nextResult = { ApiEnvelope(sessionDto()) }
      refreshGate = Gate()
    }
    val store = FakeTokenStore(initial = validTokens(expiresAt = 999_000))
    val session = manager(api, store, holder = holder)

    val first = async { session.restore() }
    api.refreshGate!!.entered.await()
    val second = async { session.restore() }
    api.refreshGate!!.release.complete(Unit)

    assertTrue(first.await() is SessionState.Authenticated)
    assertTrue(second.await() is SessionState.Authenticated)
    // Both restores started from refresh-token-1. Only one exchange may spend it;
    // the second restore must use the pair the first one saved.
    assertEquals(1, api.refreshCalls)
    assertEquals(listOf("refresh-token-1"), api.refreshTokensUsed)
    assertEquals("refresh-token-2", store.stored?.refreshToken)
  }

  @Test
  fun `a rotation that returns after sign-out is discarded and never written back`() = runTest(dispatcher) {
    val holder = ActiveTokenHolder()
    val api = FakeMaharaniApi(holder).apply {
      nextResult = { ApiEnvelope(sessionDto()) }
      rotatesOnRefresh(this)
      refreshGate = Gate()
    }
    val store = FakeTokenStore(initial = validTokens())
    val session = manager(api, store, holder = holder)
    assertTrue(session.restore() is SessionState.Authenticated)
    val writesBefore = store.writeCount

    val refreshing = async { session.refreshAccessToken() }
    api.refreshGate!!.entered.await()
    session.signOut()
    api.refreshGate!!.release.complete(Unit)

    assertNull(refreshing.await())
    // The rotated pair belonged to the session that just ended.
    assertEquals(writesBefore, store.writeCount)
    assertNull(store.stored)
    assertNull(holder.accessToken())
    assertEquals(SessionState.SignedOut(SignOutReason.SIGNED_OUT), session.state.value)

    assertEquals(SessionState.SignedOut(SignOutReason.NEVER_SIGNED_IN), session.restore())
    assertEquals(1, api.refreshCalls)
  }

  @Test
  fun `a sign-in that cannot be saved leaves the login screen with a storage message and no secrets`() =
    runTest(dispatcher) {
      val holder = ActiveTokenHolder()
      val api = FakeMaharaniApi(holder).apply {
        loginSucceeds(this)
        nextResult = { ApiEnvelope(sessionDto()) }
      }
      val store = FakeTokenStore().apply { failWrites = true }
      val session = manager(api, store, holder = holder)

      val returned = session.signIn("gupta@example.com", "password")

      assertEquals(
        SessionState.Unavailable(SESSION_NOT_SAVED_MESSAGE, retryable = true, storageFailure = true),
        returned,
      )
      // The shell stays on the sign-in screen. Nothing was authenticated or kept.
      assertEquals(SessionState.SignedOut(SignOutReason.NEVER_SIGNED_IN), session.state.value)
      assertEquals(0, api.sessionCalls)
      assertNull(holder.accessToken())
      assertNull(store.stored)
      // The message must not carry any credential.
      val message = (returned as SessionState.Unavailable).message
      assertFalse(message.contains("new-access-token"))
      assertFalse(message.contains("new-refresh-token"))
    }

  @Test
  fun `a wrong password is a form message and does not replace the shell state`() = runTest(dispatcher) {
    val api = FakeMaharaniApi().apply {
      nextLoginResult = { throw httpError(401, "invalid_credentials", "Invalid email or password. Please try again.") }
    }
    val session = manager(api, FakeTokenStore())

    val returned = session.signIn("gupta@example.com", "wrong")

    assertTrue(returned is SessionState.Unavailable)
    assertEquals("Invalid email or password. Please try again.", (returned as SessionState.Unavailable).message)
    assertFalse((returned as SessionState.Unavailable).storageFailure)
    assertEquals(SessionState.SignedOut(SignOutReason.NEVER_SIGNED_IN), session.state.value)
  }

  @Test
  fun `restore distinguishes a storage failure from being offline`() = runTest(dispatcher) {
    // Storage: the refresh succeeds but the rotated pair cannot be written.
    val storageApi = FakeMaharaniApi().apply { rotatesOnRefresh(this) }
    val storage = FakeTokenStore(initial = validTokens(expiresAt = 999_000)).apply { failWrites = true }
    val storageState = manager(storageApi, storage).restore()
    assertEquals(
      SessionState.Unavailable(SESSION_NOT_SAVED_MESSAGE, retryable = true, storageFailure = true),
      storageState,
    )

    // Connectivity: the refresh cannot reach the server.
    val offlineApi = FakeMaharaniApi().apply { nextRefreshResult = { throw IOException("offline") } }
    val offlineState = manager(offlineApi, FakeTokenStore(initial = validTokens(expiresAt = 999_000))).restore()
    assertTrue(offlineState is SessionState.Unavailable && !offlineState.storageFailure)
  }
  // ---------------------------------------------------------------------------
  // Registration generation guard (M1).
  // ---------------------------------------------------------------------------

  private fun registration() = RegistrationRequest(
    fullName = "Gupta Kirana",
    shopName = "Gupta Kirana Store",
    phone = "9876543210",
    email = "gupta@example.com",
    areaId = "area-1",
    address = "Main Road",
    password = "password",
  )

  @Test
  fun `a registration that returns a session stores it and shows pending approval without granting access`() =
    runTest(dispatcher) {
      val holder = ActiveTokenHolder()
      val api = FakeMaharaniApi(holder).apply {
        nextRegisterResult = {
          ApiEnvelope(
            RegisterRetailerResponseDto(
              ok = true,
              session = RefreshSessionDto(
                accessToken = "reg-access",
                refreshToken = "reg-refresh",
                expiresAt = 2_000_000,
              ),
            ),
          )
        }
      }
      val store = FakeTokenStore()
      val session = manager(api, store, holder = holder)

      val result = session.registerRetailer(registration())

      assertEquals(RegistrationResult.Registered(false), result)
      assertEquals(SessionState.SignedOut(SignOutReason.PENDING_APPROVAL), session.state.value)
      assertEquals("reg-refresh", store.stored?.refreshToken)
      // Registration never grants workspace access.
      assertNull(holder.accessToken())
      assertEquals(0, api.sessionCalls)
    }

  @Test
  fun `a registration answered after sign-out cannot store its session or overwrite the signed-out state`() =
    runTest(dispatcher) {
      val holder = ActiveTokenHolder()
      val api = FakeMaharaniApi(holder).apply {
        nextResult = { ApiEnvelope(sessionDto()) }
        registerGate = Gate()
        nextRegisterResult = {
          ApiEnvelope(
            RegisterRetailerResponseDto(
              ok = true,
              session = RefreshSessionDto(
                accessToken = "reg-access",
                refreshToken = "reg-refresh",
                expiresAt = 2_000_000,
              ),
            ),
          )
        }
      }
      val store = FakeTokenStore(initial = validTokens())
      val session = manager(api, store, holder = holder)
      assertTrue(session.restore() is SessionState.Authenticated)

      val registering = async { session.registerRetailer(registration()) }
      api.registerGate!!.entered.await()
      // The shopper signs out while the registration request is in flight.
      session.signOut()
      api.registerGate!!.release.complete(Unit)

      // The account still exists on the server, so the caller still gets Registered.
      assertEquals(RegistrationResult.Registered(false), registering.await())
      // The stale registration must not store its session, change the state, or
      // leave a token in memory.
      assertNull(store.stored)
      assertNull(holder.accessToken())
      assertEquals(SessionState.SignedOut(SignOutReason.SIGNED_OUT), session.state.value)
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

/**
 * One account-scoped cache, counted. The session layer must call [onSessionEnded]
 * every time a session stops being authenticated.
 */
class RecordingSessionScopedStore : SessionScopedStore {
  var clearCount: Int = 0
    private set

  override suspend fun onSessionEnded() {
    clearCount += 1
  }
}

class FakeTokenStore(initial: SessionTokens? = null) : TokenStore {
  var stored: SessionTokens? = initial
    private set

  var writeCount: Int = 0
    private set

  /** When true every write throws, as a full disk or an unusable Keystore key would. */
  var failWrites: Boolean = false

  /** When true the write reports success but stores a different pair: the read-back must catch it. */
  var corruptWrites: Boolean = false

  override suspend fun read(): SessionTokens? = stored

  override suspend fun write(tokens: SessionTokens) {
    if (failWrites) throw IOException("simulated write failure")
    stored = if (corruptWrites) tokens.copy(accessToken = tokens.accessToken + "-corrupt") else tokens
    writeCount += 1
  }

  override suspend fun clear() {
    stored = null
  }
}

/**
 * A deterministic pause point for a fake endpoint. The test awaits [entered] to
 * know the code under test is inside the call, does what it needs to, then
 * completes [release] to let the call finish. Nothing depends on timing.
 */
class Gate {
  val entered = CompletableDeferred<Unit>()
  val release = CompletableDeferred<Unit>()

  suspend fun pass() {
    entered.complete(Unit)
    release.await()
  }
}

class FakeTimeSource(var now: Long) : TimeSource {
  override fun nowEpochSeconds(): Long = now
}

private class TestPreferenceStore : PreferenceStore {
  private val values = mutableMapOf<String, Any>()
  var failingRemoveKey: String? = null

  override suspend fun getString(key: String): String? = values[key] as? String
  override suspend fun putString(key: String, value: String) { values[key] = value }
  override suspend fun getBoolean(key: String): Boolean? = values[key] as? Boolean
  override suspend fun putBoolean(key: String, value: Boolean) { values[key] = value }
  override suspend fun getLong(key: String): Long? = values[key] as? Long
  override suspend fun putLong(key: String, value: Long) { values[key] = value }
  override suspend fun remove(key: String) {
    check(key != failingRemoveKey) { "Test preference removal failed for $key" }
    values.remove(key)
  }
}

class FakeMaharaniApi(
  /**
   * The holder the interceptor would read. Optional so the tests that do not
   * care about the header stay short; when it is supplied, `session()` records
   * the token that was in memory at the moment of the call.
   */
  private val tokenHolder: ActiveTokenHolder? = null,
) : MaharaniApi {
  var sessionCalls: Int = 0
    private set

  /** The access token the bearer-authenticated verify request would carry. */
  var tokenDuringSessionCall: String? = null
    private set

  var nextResult: () -> ApiEnvelope<SessionDto> = { throw IOException("not configured") }
  var nextLoginResult: () -> ApiEnvelope<AuthSessionDto> = { unsupported("login") }

  override suspend fun health(): ApiEnvelope<HealthDto> =
    throw UnsupportedOperationException("health is not used by the session layer")

  /** When set, `session()` announces it has started and then waits for [Gate.release]. */
  var sessionGate: Gate? = null

  override suspend fun session(): ApiEnvelope<SessionDto> {
    sessionCalls += 1
    tokenDuringSessionCall = tokenHolder?.accessToken()
    sessionGate?.pass()
    return nextResult()
  }

  var refreshCalls: Int = 0
    private set

  /** Left unconfigured by default so a test that refreshes must say so. */
  var nextRefreshResult: () -> ApiEnvelope<RefreshSessionDto> =
    { throw UnsupportedOperationException("refresh() is not configured for this test") }

  // Phase C added these endpoints to MaharaniApi. Only `session()` is reachable
  // from the code under test; the rest exist because an interface implementation
  // has to name every member, and they throw rather than return a fabricated
  // envelope so that a test which accidentally depends on one fails loudly.
  /** When set, `login()` announces it has started and then waits for [Gate.release]. */
  var loginGate: Gate? = null

  override suspend fun login(body: LoginRequestDto): ApiEnvelope<AuthSessionDto> {
    loginGate?.pass()
    return nextLoginResult()
  }

  /** The refresh tokens the server was asked to exchange, in order. Tests only. */
  val refreshTokensUsed: MutableList<String> = mutableListOf()

  /** When set, the refresh exchange announces it has started and then waits for [Gate.release]. */
  var refreshGate: Gate? = null

  override suspend fun refresh(body: RefreshRequestDto): ApiEnvelope<RefreshSessionDto> {
    refreshCalls += 1
    refreshTokensUsed += body.refreshToken
    refreshGate?.pass()
    return nextRefreshResult()
  }

  override suspend fun logout(): ApiEnvelope<AckDto> = unsupported("logout")

  override suspend fun requestPasswordReset(body: PasswordResetRequestDto): ApiEnvelope<AckDto> =
    unsupported("requestPasswordReset")

  override suspend fun updatePassword(body: PasswordUpdateRequestDto): ApiEnvelope<AckDto> =
    unsupported("updatePassword")

  override suspend fun areas(): ApiEnvelope<AreasDto> = unsupported("areas")

  /** When set, `registerRetailer()` announces it has started and then waits for [Gate.release]. */
  var registerGate: Gate? = null

  var nextRegisterResult: () -> ApiEnvelope<RegisterRetailerResponseDto> = { unsupported("registerRetailer") }

  override suspend fun registerRetailer(
    body: RegisterRetailerRequestDto,
  ): ApiEnvelope<RegisterRetailerResponseDto> {
    registerGate?.pass()
    return nextRegisterResult()
  }

  // Phase D added the catalogue endpoints. Same rule as above: the session layer
  // cannot reach them, so they throw instead of returning a fabricated envelope.
  override suspend fun catalogProducts(
    search: String?,
    categoryId: String?,
    brandId: String?,
    sort: String?,
    inStock: String?,
    favoritesOnly: String?,
    minPrice: String?,
    maxPrice: String?,
    minDiscount: String?,
    maxMoq: String?,
    offersOnly: String?,
    newOnly: String?,
    cursor: String?,
  ): ApiEnvelope<List<CatalogProductDto>> = unsupported("catalogProducts")

  override suspend fun catalogSearch(search: String): ApiEnvelope<CatalogSearchDto> =
    unsupported("catalogSearch")

  override suspend fun catalogProduct(id: String): ApiEnvelope<ProductDetailDto> =
    unsupported("catalogProduct")

  override suspend fun catalogCategories(): ApiEnvelope<CatalogCategoriesDto> =
    unsupported("catalogCategories")

  override suspend fun catalogBrands(): ApiEnvelope<CatalogBrandsDto> = unsupported("catalogBrands")

  override suspend fun retailerHome(): ApiEnvelope<RetailerHomeDto> = unsupported("retailerHome")

  // Phase E commerce endpoints are not reachable from the session lifecycle.
  // Keep throwing implementations so an accidental dependency fails loudly.
  override suspend fun mobileCart(): ApiEnvelope<MobileCartDto> = unsupported("mobileCart")
  override suspend fun addCartLine(body: CartLineRequestDto): ApiEnvelope<MobileCartDto> = unsupported("addCartLine")
  override suspend fun updateCartLine(
    lineId: String,
    body: CartQuantityRequestDto,
  ): ApiEnvelope<MobileCartDto> = unsupported("updateCartLine")
  override suspend fun removeCartLine(lineId: String): ApiEnvelope<MobileCartDto> = unsupported("removeCartLine")
  override suspend fun applyCartCoupon(body: CouponRequestDto): ApiEnvelope<CouponResultDto> = unsupported("applyCartCoupon")
  override suspend fun removeCartCoupon(): ApiEnvelope<CouponRemovedDto> = unsupported("removeCartCoupon")
  override suspend fun mobileAddresses(): ApiEnvelope<MobileAddressesDto> = unsupported("mobileAddresses")
  override suspend fun createAddress(
    body: com.maharanitraders.core.network.dto.AddressPayloadDto,
  ): ApiEnvelope<com.maharanitraders.core.network.dto.MobileAddressMutationDto> = unsupported("createAddress")
  override suspend fun updateAddress(
    addressId: String,
    body: com.maharanitraders.core.network.dto.AddressPayloadDto,
  ): ApiEnvelope<com.maharanitraders.core.network.dto.MobileAddressMutationDto> = unsupported("updateAddress")
  override suspend fun deleteAddress(addressId: String): ApiEnvelope<MobileAddressesDto> = unsupported("deleteAddress")
  override suspend fun setDefaultAddress(
    addressId: String,
  ): ApiEnvelope<com.maharanitraders.core.network.dto.MobileAddressMutationDto> = unsupported("setDefaultAddress")
  override suspend fun checkoutQuote(body: CheckoutQuoteRequestDto): ApiEnvelope<CheckoutQuoteDto> = unsupported("checkoutQuote")
  override suspend fun placeOrder(
    requestKey: String,
    body: PlaceOrderRequestDto,
  ): ApiEnvelope<PlaceOrderResponseDto> = unsupported("placeOrder")
  override suspend fun orderHistory(cursor: String?): ApiEnvelope<List<MobileOrderDto>> = unsupported("orderHistory")
  override suspend fun orderDetail(orderId: String): ApiEnvelope<MobileOrderDto> = unsupported("orderDetail")
  override suspend fun recoverOrderRequest(requestKey: String): ApiEnvelope<MobileOrderDto> = unsupported("recoverOrderRequest")
  override suspend fun orderInvoice(orderId: String): ApiEnvelope<MobileInvoiceDto> = unsupported("orderInvoice")
  override suspend fun orderDelivery(orderId: String): ApiEnvelope<MobileDeliveryDto> = unsupported("orderDelivery")

  // Phase F engagement endpoints — not reachable from the session lifecycle.
  override suspend fun notifications(cursor: String?, unreadOnly: String?): ApiEnvelope<List<com.maharanitraders.core.network.dto.MobileNotificationDto>> = unsupported("notifications")
  override suspend fun markNotificationsRead(body: com.maharanitraders.core.network.dto.MarkReadRequestDto): ApiEnvelope<com.maharanitraders.core.network.dto.MarkReadResponseDto> = unsupported("markNotificationsRead")
  override suspend fun walletSummary(): ApiEnvelope<com.maharanitraders.core.network.dto.MobileWalletSummaryDto> = unsupported("walletSummary")
  override suspend fun walletLedger(cursor: String?): ApiEnvelope<List<com.maharanitraders.core.network.dto.MobileWalletLedgerEntryDto>> = unsupported("walletLedger")
  override suspend fun favorites(): ApiEnvelope<com.maharanitraders.core.network.dto.MobileFavoritesDto> = unsupported("favorites")
  override suspend fun toggleFavorite(body: com.maharanitraders.core.network.dto.FavoriteToggleRequestDto): ApiEnvelope<com.maharanitraders.core.network.dto.FavoriteToggleResponseDto> = unsupported("toggleFavorite")
  override suspend fun coupons(): ApiEnvelope<com.maharanitraders.core.network.dto.MobileCouponsDto> = unsupported("coupons")
  override suspend fun quickOrder(
    q: String,
  ): ApiEnvelope<com.maharanitraders.core.network.dto.MobileQuickOrderDto> = unsupported("quickOrder")
  override suspend fun matchBulkLines(
    body: com.maharanitraders.core.network.dto.MobileBulkMatchRequestDto,
  ): ApiEnvelope<com.maharanitraders.core.network.dto.MobileBulkMatchDto> = unsupported("matchBulkLines")


  override suspend fun changePassword(body: com.maharanitraders.core.network.dto.PasswordChangeRequestDto): ApiEnvelope<AckDto> = unsupported("changePassword")
  override suspend fun revokeAllSessions(): ApiEnvelope<AckDto> = unsupported("revokeAllSessions")
  override suspend fun retailerProfile(): ApiEnvelope<com.maharanitraders.core.network.dto.MobileRetailerProfileDto> = unsupported("retailerProfile")
  override suspend fun updateRetailerProfile(body: com.maharanitraders.core.network.dto.MobileProfilePatchDto): ApiEnvelope<AckDto> = unsupported("updateRetailerProfile")
  override suspend fun notificationPreferences(): ApiEnvelope<com.maharanitraders.core.network.dto.MobileNotificationPreferencesDto> = unsupported("notificationPreferences")
  override suspend fun updateNotificationPreferences(body: com.maharanitraders.core.network.dto.MobileNotificationPreferencesDto): ApiEnvelope<AckDto> = unsupported("updateNotificationPreferences")
  override suspend fun schemes(): ApiEnvelope<com.maharanitraders.core.network.dto.MobileSchemesDto> = unsupported("schemes")
  override suspend fun helpDetails(): ApiEnvelope<com.maharanitraders.core.network.dto.MobileHelpDto> = unsupported("helpDetails")
  override suspend fun accountRequests(): ApiEnvelope<com.maharanitraders.core.network.dto.MobileAccountRequestsDto> = unsupported("accountRequests")
  override suspend fun createAccountRequest(body: com.maharanitraders.core.network.dto.MobileAccountRequestCreateDto): ApiEnvelope<com.maharanitraders.core.network.dto.MobileAccountRequestDto> = unsupported("createAccountRequest")
  override suspend fun purchaseReports(): ApiEnvelope<com.maharanitraders.core.network.dto.MobileReportsDto> = unsupported("purchaseReports")
  override suspend fun reportStatementCsv(type: String, from: String?, to: String?): okhttp3.ResponseBody = unsupported("reportStatementCsv")
  override suspend fun supportTickets(cursor: String?, status: String?): ApiEnvelope<List<com.maharanitraders.core.network.dto.MobileSupportTicketDto>> = unsupported("supportTickets")
  override suspend fun createSupportTicket(body: com.maharanitraders.core.network.dto.MobileSupportCreateRequestDto): ApiEnvelope<com.maharanitraders.core.network.dto.MobileSupportCreateResponseDto> = unsupported("createSupportTicket")
  override suspend fun supportTicket(ticketId: String): ApiEnvelope<com.maharanitraders.core.network.dto.MobileSupportTicketDetailDto> = unsupported("supportTicket")
  override suspend fun replyToSupportTicket(ticketId: String, body: com.maharanitraders.core.network.dto.MobileSupportReplyRequestDto): ApiEnvelope<com.maharanitraders.core.network.dto.MobileSupportMessageDto> = unsupported("replyToSupportTicket")
  override suspend fun savedCarts(): ApiEnvelope<com.maharanitraders.core.network.dto.MobileSavedCartsDto> = unsupported("savedCarts")
  override suspend fun saveCurrentCart(body: com.maharanitraders.core.network.dto.MobileSavedCartCreateRequestDto): ApiEnvelope<com.maharanitraders.core.network.dto.MobileSavedCartMutationDto> = unsupported("saveCurrentCart")
  override suspend fun renameSavedCart(savedCartId: String, body: com.maharanitraders.core.network.dto.MobileSavedCartRenameRequestDto): ApiEnvelope<AckDto> = unsupported("renameSavedCart")
  override suspend fun deleteSavedCart(savedCartId: String): ApiEnvelope<AckDto> = unsupported("deleteSavedCart")
  override suspend fun restoreSavedCart(savedCartId: String): ApiEnvelope<com.maharanitraders.core.network.dto.MobileSavedCartRestoreDto> = unsupported("restoreSavedCart")
  override suspend fun saveCartItemForLater(body: com.maharanitraders.core.network.dto.MobileSaveForLaterRequestDto): ApiEnvelope<com.maharanitraders.core.network.dto.MobileSavedCartMutationDto> = unsupported("saveCartItemForLater")
  override suspend fun deleteSavedCartItem(itemId: String): ApiEnvelope<AckDto> = unsupported("deleteSavedCartItem")
  override suspend fun restoreSavedCartItem(itemId: String): ApiEnvelope<com.maharanitraders.core.network.dto.MobileSavedCartRestoreDto> = unsupported("restoreSavedCartItem")
  override suspend fun cancelOrder(orderId: String, body: com.maharanitraders.core.network.dto.MobileOrderActionRequestDto): ApiEnvelope<AckDto> = unsupported("cancelOrder")
  override suspend fun requestOrderReturn(orderId: String, body: com.maharanitraders.core.network.dto.MobileOrderActionRequestDto): ApiEnvelope<com.maharanitraders.core.network.dto.MobileReturnRequestResponseDto> = unsupported("requestOrderReturn")

  private fun unsupported(endpoint: String): Nothing =
    throw UnsupportedOperationException("$endpoint is not used by the session layer")
}
