package com.maharanitraders.core.auth

import com.maharanitraders.core.common.AppResult
import com.maharanitraders.core.common.TimeSource
import com.maharanitraders.core.datastore.AppPreferences
import com.maharanitraders.core.datastore.PreferenceStore
import com.maharanitraders.core.model.SessionTokens
import com.maharanitraders.core.network.ActiveTokenHolder
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

  private fun manager(
    api: FakeMaharaniApi,
    store: FakeTokenStore,
    now: Long = 1_000_000,
    preferences: AppPreferences = AppPreferences(TestPreferenceStore()),
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
      tokenHolder = ActiveTokenHolder(),
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
  fun `restore publishes Restoring first so the shell keeps the splash up`() = runTest(dispatcher) {
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

class FakeMaharaniApi : MaharaniApi {
  var sessionCalls: Int = 0
    private set

  var nextResult: () -> ApiEnvelope<SessionDto> = { throw IOException("not configured") }
  var nextLoginResult: () -> ApiEnvelope<AuthSessionDto> = { unsupported("login") }

  override suspend fun health(): ApiEnvelope<HealthDto> =
    throw UnsupportedOperationException("health is not used by the session layer")

  override suspend fun session(): ApiEnvelope<SessionDto> {
    sessionCalls += 1
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
  override suspend fun login(body: LoginRequestDto): ApiEnvelope<AuthSessionDto> = nextLoginResult()

  override suspend fun refresh(body: RefreshRequestDto): ApiEnvelope<RefreshSessionDto> {
    refreshCalls += 1
    return nextRefreshResult()
  }

  override suspend fun logout(): ApiEnvelope<AckDto> = unsupported("logout")

  override suspend fun requestPasswordReset(body: PasswordResetRequestDto): ApiEnvelope<AckDto> =
    unsupported("requestPasswordReset")

  override suspend fun updatePassword(body: PasswordUpdateRequestDto): ApiEnvelope<AckDto> =
    unsupported("updatePassword")

  override suspend fun areas(): ApiEnvelope<AreasDto> = unsupported("areas")

  override suspend fun registerRetailer(
    body: RegisterRetailerRequestDto,
  ): ApiEnvelope<RegisterRetailerResponseDto> = unsupported("registerRetailer")

  // Phase D added the catalogue endpoints. Same rule as above: the session layer
  // cannot reach them, so they throw instead of returning a fabricated envelope.
  override suspend fun catalogProducts(
    search: String?,
    categoryId: String?,
    brandId: String?,
    sort: String?,
    inStock: String?,
    favoritesOnly: String?,
    cursor: String?,
  ): ApiEnvelope<List<CatalogProductDto>> = unsupported("catalogProducts")

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

  private fun unsupported(endpoint: String): Nothing =
    throw UnsupportedOperationException("$endpoint is not used by the session layer")
}
