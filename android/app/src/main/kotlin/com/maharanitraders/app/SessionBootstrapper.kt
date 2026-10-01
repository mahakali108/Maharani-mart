package com.maharanitraders.app

import com.maharanitraders.core.auth.SessionController
import com.maharanitraders.core.common.di.ApplicationScope
import java.util.concurrent.atomic.AtomicBoolean
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

/**
 * Starts session restore exactly once per process, on the application scope.
 *
 * Restoring in [com.maharanitraders.app.MaharaniApplication] rather than in the
 * Activity means the network round-trip is not cancelled and restarted by an
 * orientation change, and the navigation shell only ever observes
 * [SessionController.state]. It is a plain class (no Android types) so the
 * bootstrap behaviour is covered by a JVM unit test.
 */
@Singleton
class SessionBootstrapper @Inject constructor(
  private val session: SessionController,
  @ApplicationScope private val applicationScope: CoroutineScope,
) {

  private val started = AtomicBoolean(false)

  /**
   * Idempotent: no matter how many components call it, the process performs
   * exactly one session verification.
   */
  fun start() {
    if (!started.compareAndSet(false, true)) return
    applicationScope.launch { session.restore() }
  }
}
