package com.maharanitraders.core.network

import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * The single-flight and no-recursion rules of the runtime refresh.
 *
 * These are the two properties that keep an expired access token from turning
 * into either a refresh storm (one request per in-flight call) or an infinite
 * loop (a refresh that itself answers 401 starting another refresh).
 */
class TokenRefreshCoordinatorTest {

  private val dispatcher = StandardTestDispatcher()

  @Test
  fun `refreshes once for many callers holding the same stale token`() = runTest(dispatcher) {
    val coordinator = TokenRefreshCoordinator()
    var refreshes = 0
    coordinator.install {
      refreshes += 1
      "fresh-token"
    }

    val answers = List(5) {
      async(dispatcher) { coordinator.refresh("stale-token") }
    }.awaitAll()

    assertEquals(listOf("fresh-token", "fresh-token", "fresh-token", "fresh-token", "fresh-token"), answers)
    // One exchange, five callers served — the second refresh would ask the
    // server for a token it has just issued.
    assertEquals(1, refreshes)
  }

  @Test
  fun `refreshes again when the token in hand is the last issued one`() = runTest(dispatcher) {
    val coordinator = TokenRefreshCoordinator()
    var refreshes = 0
    coordinator.install {
      refreshes += 1
      "token-$refreshes"
    }

    assertEquals("token-1", coordinator.refresh("stale-token"))
    // An hour later the token that was fresh is the stale one.
    assertEquals("token-2", coordinator.refresh("token-1"))
    assertEquals(2, refreshes)
  }

  @Test
  fun `a refresh in flight does not start another one`() = runTest(dispatcher) {
    val coordinator = TokenRefreshCoordinator()
    var refreshes = 0
    coordinator.install {
      refreshes += 1
      // A refresh request that answers 401 re-enters here through the executor;
      // it must be told "no", never allowed to loop.
      coordinator.refresh("stale-token")
      null
    }

    assertNull(coordinator.refresh("stale-token"))
    assertEquals(1, refreshes)
  }

  @Test
  fun `a request with no token never refreshes`() = runTest(dispatcher) {
    val coordinator = TokenRefreshCoordinator()
    var refreshes = 0
    coordinator.install { refreshes += 1; "fresh-token" }

    assertNull(coordinator.refresh(null))
    assertEquals(0, refreshes)
  }

  @Test
  fun `reset forgets the cached token so another account cannot receive it`() = runTest(dispatcher) {
    val coordinator = TokenRefreshCoordinator()
    coordinator.install { "account-a-token" }
    assertEquals("account-a-token", coordinator.refresh("stale-a"))

    coordinator.reset()
    coordinator.install { "account-b-token" }

    // Nothing cached from account A survives: the next caller pays for a real
    // exchange and receives account B's token.
    assertEquals("account-b-token", coordinator.refresh("stale-b"))
  }

  @Test
  fun `no refresher installed means no refresh`() = runTest(dispatcher) {
    val coordinator = TokenRefreshCoordinator()
    assertFalse(coordinator.installed)
    assertNull(coordinator.refresh("stale-token"))
  }
}
