package com.maharanitraders.core.common

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The offline rules are a product invariant, not a preference: money, stock and
 * order state always need the server, and nothing is replayed automatically.
 */
class OfflinePolicyTest {

  @Test
  fun `read-only cached views are allowed offline`() {
    assertTrue(OfflinePolicy.isAllowedOffline(AppAction.VIEW_CACHED_CATALOG))
    assertTrue(OfflinePolicy.isAllowedOffline(AppAction.VIEW_CACHED_ORDERS))
  }

  @Test
  fun `cart edits stay local until checkout re-validates them`() {
    assertTrue(OfflinePolicy.isAllowedOffline(AppAction.EDIT_LOCAL_CART))
  }

  @Test
  fun `money, stock and order actions require the server`() {
    val serverSide = listOf(
      AppAction.PLACE_ORDER,
      AppAction.CANCEL_ORDER,
      AppAction.APPLY_COUPON,
      AppAction.REQUEST_RETURN,
      AppAction.ADJUST_STOCK,
      AppAction.RECORD_COLLECTION,
      AppAction.MANAGE_CATALOG,
      AppAction.MANAGE_RETAILERS,
      AppAction.RUN_RETENTION,
    )
    for (action in serverSide) {
      assertFalse(action.name, OfflinePolicy.isAllowedOffline(action))
      assertTrue(action.name, OfflinePolicy.requiresFreshServerCheck(action))
    }
  }

  @Test
  fun `no action is ever replayed automatically after reconnect`() {
    for (action in AppAction.entries) {
      assertFalse(action.name, OfflinePolicy.mayReplayAutomatically(action))
    }
  }

  @Test
  fun `every action declares whether the server must verify it`() {
    // Guards against a new action being added without a conscious decision.
    assertEquals(AppAction.entries.size, AppAction.entries.map { it.requiresServerVerification }.size)
    assertTrue(AppAction.entries.any { it.requiresServerVerification })
    assertTrue(AppAction.entries.any { !it.requiresServerVerification })
  }
}

class AppResultTest {

  @Test
  fun `map transforms success and passes failures through untouched`() {
    val success: AppResult<Int> = AppResult.Success(2)
    assertEquals(AppResult.Success(4), success.map { it * 2 })

    val failure: AppResult<Int> = AppResult.Failure(AppError.Network())
    val mapped = failure.map { it * 2 }
    assertTrue(mapped is AppResult.Failure)
    assertEquals(AppError.Network(), (mapped as AppResult.Failure).error)
  }

  @Test
  fun `helpers expose value or error without throwing`() {
    assertEquals(1, AppResult.Success(1).getOrNull())
    assertEquals(null, AppResult.Failure(AppError.Unexpected()).getOrNull())
    assertEquals(null, AppResult.Success(1).errorOrNull())
    assertTrue(AppResult.Failure(AppError.Network()).errorOrNull() is AppError.Network)
  }

  @Test
  fun `api errors carry the server message and retry semantics`() {
    val error = AppError.Api(
      code = com.maharanitraders.core.model.ApiErrorCode.DATABASE_UNAVAILABLE,
      message = "The service is temporarily unavailable. Please try again.",
    )
    assertTrue(error.retryable)
    assertEquals("The service is temporarily unavailable. Please try again.", error.message)
    assertEquals(null, error.gate)
  }

  @Test
  fun `gate errors expose the account screen the app must show`() {
    val pending = AppError.Api(
      code = com.maharanitraders.core.model.ApiErrorCode.RETAILER_PENDING_APPROVAL,
      message = "Your shop is still awaiting approval.",
    )
    assertEquals(com.maharanitraders.core.model.AccountGate.PENDING_APPROVAL, pending.gate)
    assertFalse(pending.retryable)
  }
}
