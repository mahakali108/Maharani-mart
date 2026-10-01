package com.maharanitraders.core.model

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Contract tests for the shared domain model.
 *
 * The wire values here are asserted against the SERVER's values
 * (`lib/auth/roles.ts`, `types/database.types.ts`, the API contract): a typo
 * would silently break role routing, so it must fail the build instead.
 */
class UserRoleTest {

  @Test
  fun `wire values match the server role strings`() {
    assertEquals("super_admin", UserRole.SUPER_ADMIN.wireValue)
    assertEquals("admin", UserRole.ADMIN.wireValue)
    assertEquals("staff", UserRole.STAFF.wireValue)
    assertEquals("salesman", UserRole.SALESMAN.wireValue)
    assertEquals("retailer", UserRole.RETAILER.wireValue)
  }

  @Test
  fun `parses known roles and tolerates case and whitespace`() {
    assertEquals(UserRole.RETAILER, UserRole.fromWire("retailer"))
    assertEquals(UserRole.RETAILER, UserRole.fromWire("  RETAILER "))
    assertEquals(UserRole.SUPER_ADMIN, UserRole.fromWire("super_admin"))
  }

  @Test
  fun `unknown or missing roles resolve to null - never to a privileged role`() {
    assertNull(UserRole.fromWire("owner"))
    assertNull(UserRole.fromWire(""))
    assertNull(UserRole.fromWire(null))
    // A server that adds a role must not be silently treated as admin.
    assertFalse(UserRole.fromWire("regional_manager") == UserRole.ADMIN)
  }
}

class RetailerStatusTest {

  @Test
  fun `wire values match the database enum`() {
    assertEquals("pending_approval", RetailerStatus.PENDING_APPROVAL.wireValue)
    assertEquals("active", RetailerStatus.ACTIVE.wireValue)
    assertEquals("suspended", RetailerStatus.SUSPENDED.wireValue)
  }

  @Test
  fun `unrecognised status is unknown, never active`() {
    assertEquals(RetailerStatus.ACTIVE, RetailerStatus.fromWire("active"))
    assertEquals(RetailerStatus.UNKNOWN, RetailerStatus.fromWire("approved"))
    assertEquals(RetailerStatus.UNKNOWN, RetailerStatus.fromWire(null))
  }
}

class WorkspaceTest {

  @Test
  fun `workspace ids match the server route prefixes`() {
    assertEquals("admin", Workspace.ADMIN.id)
    assertEquals("staff", Workspace.STAFF.id)
    assertEquals("salesman", Workspace.SALESMAN.id)
    assertEquals("retailer", Workspace.RETAILER.id)
    assertNull(Workspace.fromId("warehouse"))
  }
}

class NavigationPolicyTest {

  private val policy = NavigationPolicy(
    homeRoute = "/retailer/home",
    workspaces = listOf(Workspace.RETAILER),
    permissions = setOf("orders.create", "orders.view.own"),
  )

  @Test
  fun `permissions are exactly what the server sent`() {
    assertTrue(policy.can("orders.create"))
    assertFalse(policy.can("coins.manage"))
    assertFalse(policy.can("cleanup.view"))
  }

  @Test
  fun `workspace access follows the server list`() {
    assertTrue(policy.canEnter(Workspace.RETAILER))
    assertFalse(policy.canEnter(Workspace.ADMIN))
  }

  @Test
  fun `a policy without a home route is unusable instead of guessed`() {
    assertTrue(policy.isUsable)
    assertFalse(NavigationPolicy.EMPTY.isUsable)
    assertFalse(NavigationPolicy(homeRoute = "   ", workspaces = emptyList(), permissions = emptySet()).isUsable)
  }
}

class ApiErrorCodeTest {

  @Test
  fun `wire values match the API contract`() {
    assertEquals("insufficient_stock", ApiErrorCode.INSUFFICIENT_STOCK.wireValue)
    assertEquals("retailer_pending_approval", ApiErrorCode.RETAILER_PENDING_APPROVAL.wireValue)
    assertEquals("database_unavailable", ApiErrorCode.DATABASE_UNAVAILABLE.wireValue)
  }

  @Test
  fun `token failures require sign-in and never retry blindly`() {
    assertTrue(ApiErrorCode.EXPIRED_TOKEN.requiresSignIn)
    assertTrue(ApiErrorCode.INVALID_TOKEN.requiresSignIn)
    assertTrue(ApiErrorCode.MISSING_TOKEN.requiresSignIn)
    assertFalse(ApiErrorCode.EXPIRED_TOKEN.retryable)
  }

  @Test
  fun `account gates are exposed as screens, not generic errors`() {
    assertEquals(AccountGate.PENDING_APPROVAL, ApiErrorCode.RETAILER_PENDING_APPROVAL.gate)
    assertEquals(AccountGate.SUSPENDED, ApiErrorCode.ACCOUNT_SUSPENDED.gate)
    assertEquals(AccountGate.ACCESS_EXPIRED, ApiErrorCode.ACCESS_EXPIRED.gate)
    assertEquals(AccountGate.INACTIVE, ApiErrorCode.ACCOUNT_INACTIVE.gate)
    assertNull(ApiErrorCode.FORBIDDEN.gate)
    assertNull(ApiErrorCode.INSUFFICIENT_STOCK.gate)
  }

  @Test
  fun `unknown codes stay retryable and never become success`() {
    val unknown = ApiErrorCode.fromWire("brand_new_code")
    assertEquals(ApiErrorCode.UNKNOWN, unknown)
    assertTrue(unknown.retryable)
    assertEquals(ApiErrorCode.UNKNOWN, ApiErrorCode.fromWire(null))
  }

  @Test
  fun `transient server and rate-limit failures are retryable`() {
    assertTrue(ApiErrorCode.DATABASE_UNAVAILABLE.retryable)
    assertTrue(ApiErrorCode.INTERNAL_ERROR.retryable)
    assertTrue(ApiErrorCode.RATE_LIMITED.retryable)
    assertFalse(ApiErrorCode.VALIDATION_FAILED.retryable)
    assertFalse(ApiErrorCode.INSUFFICIENT_STOCK.retryable)
  }
}

class SessionTokensTest {

  @Test
  fun `tokens are treated as expired inside the refresh skew`() {
    val tokens = SessionTokens(
      accessToken = "a",
      refreshToken = "r",
      expiresAtEpochSeconds = 10_000,
    )
    assertFalse(tokens.isExpiredAt(nowEpochSeconds = 9_000))
    assertTrue(tokens.isExpiredAt(nowEpochSeconds = 9_900)) // 100s left < 120s skew
    assertTrue(tokens.isExpiredAt(nowEpochSeconds = 10_001))
  }

  @Test
  fun `skew is configurable for tests and future phases`() {
    val tokens = SessionTokens("a", "r", expiresAtEpochSeconds = 1_000)
    assertFalse(tokens.isExpiredAt(nowEpochSeconds = 999, skewSeconds = 0))
    assertTrue(tokens.isExpiredAt(nowEpochSeconds = 1_000, skewSeconds = 0))
  }
}
