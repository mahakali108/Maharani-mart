package com.maharanitraders.app

import com.maharanitraders.core.auth.SessionController
import com.maharanitraders.core.auth.SessionState
import com.maharanitraders.core.auth.SignOutReason
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Session bootstrap happens once per process, off the UI thread, on a scope
 * that survives Activity recreation. It must never restore twice (two
 * simultaneous verifications of the same token) and must never block startup.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SessionBootstrapperTest {

  @Test
  fun `start triggers exactly one restore on the application scope`() = runTest {
    val controller = FakeSessionController()
    val scope = CoroutineScope(StandardTestDispatcher(testScheduler) + SupervisorJob())
    val bootstrapper = SessionBootstrapper(controller, scope)

    bootstrapper.start()
    // Nothing has happened yet: the restore is dispatched, not executed inline.
    assertEquals(0, controller.restoreCalls)

    advanceUntilIdle()
    assertEquals(1, controller.restoreCalls)
  }

  @Test
  fun `repeated start calls still restore only once per process`() = runTest {
    val controller = FakeSessionController()
    val scope = CoroutineScope(StandardTestDispatcher(testScheduler) + SupervisorJob())
    val bootstrapper = SessionBootstrapper(controller, scope)

    bootstrapper.start()
    bootstrapper.start()
    advanceUntilIdle()

    assertEquals(1, controller.restoreCalls)
  }
}

internal class FakeSessionController : SessionController {
  private val mutableState = MutableStateFlow<SessionState>(
    SessionState.SignedOut(SignOutReason.NEVER_SIGNED_IN)
  )

  override val state: StateFlow<SessionState> = mutableState

  var restoreCalls: Int = 0
    private set

  override suspend fun restore(): SessionState {
    restoreCalls += 1
    return mutableState.value
  }

  override suspend fun signOut() {
    mutableState.value = SessionState.SignedOut(SignOutReason.SIGNED_OUT)
  }

  override fun accessToken(): String? = null
}
