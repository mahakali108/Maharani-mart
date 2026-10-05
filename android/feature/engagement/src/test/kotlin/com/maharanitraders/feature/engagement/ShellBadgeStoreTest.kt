package com.maharanitraders.feature.engagement

import com.google.common.truth.Truth.assertThat
import com.maharanitraders.core.common.AppError
import com.maharanitraders.core.common.AppResult
import com.maharanitraders.core.model.ApiErrorCode
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Before
import org.junit.Test

/**
 * The shell's badge store: publish what the server said, and never more than one
 * read at a time.
 *
 * A badge is the one piece of state the app shows without being asked for, so the
 * failure behaviour matters as much as the success path: an error must not be
 * drawn as an empty cart, and two triggers must not become two requests.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ShellBadgeStoreTest {

  private val dispatcher = StandardTestDispatcher()

  @Before
  fun setUp() = Dispatchers.setMain(dispatcher)

  @After
  fun tearDown() = Dispatchers.resetMain()

  private class FakeSource : ShellBadgeSource {
    var next: AppResult<BadgeCounts> = AppResult.Success(BadgeCounts(cartCount = 0, unreadNotificationCount = 0))

    /** When set, a read waits here until the test releases it. */
    var gate: CompletableDeferred<Unit>? = null

    var calls: Int = 0
      private set

    override suspend fun fetch(): AppResult<BadgeCounts> {
      calls += 1
      gate?.await()
      return next
    }
  }

  private fun failure() = AppResult.Failure(
    AppError.Api(code = ApiErrorCode.DATABASE_UNAVAILABLE, message = "Nope."),
  )

  @Test
  fun `publishes the counts the server reported`() = runTest(dispatcher) {
    val source = FakeSource()
    source.next = AppResult.Success(BadgeCounts(cartCount = 3, unreadNotificationCount = 2))
    val store = ShellBadgeStore(source)

    store.refresh()

    assertThat(store.state.value.cartCount).isEqualTo(3)
    assertThat(store.state.value.unreadNotifications).isEqualTo(2)
    assertThat(store.state.value.loading).isFalse()
    assertThat(store.state.value.loaded).isTrue()
  }

  @Test
  fun `a failed read keeps the last known counts`() = runTest(dispatcher) {
    val source = FakeSource()
    source.next = AppResult.Success(BadgeCounts(cartCount = 5, unreadNotificationCount = 1))
    val store = ShellBadgeStore(source)
    store.refresh()

    source.next = failure()
    store.refresh()

    // Blinking to zero would tell the shopper their cart is empty. It is not.
    assertThat(store.state.value.cartCount).isEqualTo(5)
    assertThat(store.state.value.unreadNotifications).isEqualTo(1)
    assertThat(store.state.value.loading).isFalse()
  }

  @Test
  fun `a first read that fails is still not a badge`() = runTest(dispatcher) {
    val source = FakeSource()
    source.next = failure()
    val store = ShellBadgeStore(source)

    store.refresh()

    // Nothing was ever proven, so nothing is claimed: zeros with `loaded` false.
    assertThat(store.state.value).isEqualTo(ShellBadges())
    assertThat(store.state.value.loaded).isFalse()
  }

  @Test
  fun `a negative count is drawn as none`() = runTest(dispatcher) {
    val source = FakeSource()
    source.next = AppResult.Success(BadgeCounts(cartCount = -4, unreadNotificationCount = -1))
    val store = ShellBadgeStore(source)

    store.refresh()

    assertThat(store.state.value.cartCount).isEqualTo(0)
    assertThat(store.state.value.unreadNotifications).isEqualTo(0)
  }

  @Test
  fun `loading is reported only while a read is in flight`() = runTest(dispatcher) {
    val source = FakeSource()
    source.gate = CompletableDeferred()
    val store = ShellBadgeStore(source)

    val job = launch { store.refresh() }
    advanceUntilIdle()
    assertThat(store.state.value.loading).isTrue()

    source.gate?.complete(Unit)
    job.join()
    advanceUntilIdle()
    assertThat(store.state.value.loading).isFalse()
  }

  @Test
  fun `concurrent triggers collapse into one read`() = runTest(dispatcher) {
    val source = FakeSource()
    source.gate = CompletableDeferred()
    source.next = AppResult.Success(BadgeCounts(cartCount = 7, unreadNotificationCount = 0))
    val store = ShellBadgeStore(source)

    val first = launch { store.refresh() }
    advanceUntilIdle()
    // The shell can fire on resume and on a route change in the same frame.
    val second = launch { store.refresh() }
    advanceUntilIdle()
    assertThat(source.calls).isEqualTo(1)
    assertThat(second.isCompleted).isTrue()

    source.gate?.complete(Unit)
    first.join()
    advanceUntilIdle()

    assertThat(store.state.value.cartCount).isEqualTo(7)
    assertThat(source.calls).isEqualTo(1)
  }

  @Test
  fun `clearing the store leaves no badge for the next account`() = runTest(dispatcher) {
    val source = FakeSource()
    source.next = AppResult.Success(BadgeCounts(cartCount = 2, unreadNotificationCount = 9))
    val store = ShellBadgeStore(source)
    store.refresh()

    store.clear()

    assertThat(store.state.value).isEqualTo(ShellBadges())
  }
}
