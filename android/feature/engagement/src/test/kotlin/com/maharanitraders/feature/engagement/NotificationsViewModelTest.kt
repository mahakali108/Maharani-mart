package com.maharanitraders.feature.engagement

import app.cash.turbine.test
import com.google.common.truth.Truth.assertThat
import com.maharanitraders.core.common.AppError
import com.maharanitraders.core.common.AppResult
import com.maharanitraders.core.model.ApiErrorCode
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class NotificationsViewModelTest {

  private val testDispatcher = StandardTestDispatcher()
  private lateinit var fakeRepository: FakeEngagementRepository
  private lateinit var viewModel: NotificationsViewModel

  @Before
  fun setUp() {
    Dispatchers.setMain(testDispatcher)
    fakeRepository = FakeEngagementRepository()
  }

  @After
  fun tearDown() {
    Dispatchers.resetMain()
  }

  @Test
  fun `load shows notifications on success`() = runTest(testDispatcher) {
    val notifications = listOf(
      AppNotification("n1", "Order confirmed", "Your order was placed", null, false, "2026-01-01T00:00:00Z"),
      AppNotification("n2", "Coins credited", "You earned coins", null, true, "2025-12-31T00:00:00Z"),
    )
    fakeRepository.notificationsResult = AppResult.Success(
      NotificationPage(items = notifications, nextCursor = null, hasMore = false),
    )

    viewModel = NotificationsViewModel(fakeRepository, UnreadStore(fakeRepository))
    testDispatcher.scheduler.advanceUntilIdle()

    viewModel.state.test {
      val state = awaitItem()
      assertThat(state.loading).isFalse()
      assertThat(state.items).hasSize(2)
      assertThat(state.items[0].title).isEqualTo("Order confirmed")
      assertThat(state.hasMore).isFalse()
    }
  }

  @Test
  fun `load shows error on failure`() = runTest(testDispatcher) {
    fakeRepository.notificationsResult = AppResult.Failure(
      AppError.Api(code = ApiErrorCode.DATABASE_UNAVAILABLE, message = "Try again."),
    )

    viewModel = NotificationsViewModel(fakeRepository, UnreadStore(fakeRepository))
    testDispatcher.scheduler.advanceUntilIdle()

    viewModel.state.test {
      val state = awaitItem()
      assertThat(state.loading).isFalse()
      assertThat(state.items).isEmpty()
      assertThat(state.errorMessage).isEqualTo("Try again.")
    }
  }

  @Test
  fun `loadMore appends to existing items`() = runTest(testDispatcher) {
    val firstBatch = listOf(
      AppNotification("n1", "First", "Body", null, false, "2026-01-01"),
    )
    val secondBatch = listOf(
      AppNotification("n2", "Second", "Body", null, false, "2025-12-31"),
    )

    fakeRepository.notificationsResult = AppResult.Success(
      NotificationPage(items = firstBatch, nextCursor = "cursor1", hasMore = true),
    )
    viewModel = NotificationsViewModel(fakeRepository, UnreadStore(fakeRepository))
    testDispatcher.scheduler.advanceUntilIdle()

    fakeRepository.notificationsResult = AppResult.Success(
      NotificationPage(items = secondBatch, nextCursor = null, hasMore = false),
    )
    viewModel.loadMore()
    testDispatcher.scheduler.advanceUntilIdle()

    viewModel.state.test {
      val state = awaitItem()
      assertThat(state.items).hasSize(2)
      assertThat(state.hasMore).isFalse()
      assertThat(state.loadingMore).isFalse()
    }
  }

  @Test
  fun `markAllRead sends only the unread ids and marks them read`() = runTest(testDispatcher) {
    val notifications = listOf(
      AppNotification("n1", "Unread", "Body", null, false, "2026-01-01"),
      AppNotification("n2", "Already read", "Body", null, true, "2025-12-31"),
    )
    fakeRepository.notificationsResult = AppResult.Success(
      NotificationPage(items = notifications, nextCursor = null, hasMore = false),
    )
    fakeRepository.markReadResult = AppResult.Success(1)

    viewModel = NotificationsViewModel(fakeRepository, UnreadStore(fakeRepository))
    testDispatcher.scheduler.advanceUntilIdle()

    viewModel.markAllRead()
    testDispatcher.scheduler.advanceUntilIdle()

    // Already-read notifications are not re-sent.
    assertThat(fakeRepository.markReadRequests).containsExactly(listOf("n1"))

    viewModel.state.test {
      val state = awaitItem()
      assertThat(state.items.all { it.isRead }).isTrue()
      assertThat(state.unreadLoaded).isEqualTo(0)
      assertThat(state.markingRead).isFalse()
      assertThat(state.actionMessage).isNull()
    }
  }

  @Test
  fun `a failed markAllRead is reported, not swallowed`() = runTest(testDispatcher) {
    val notifications = listOf(
      AppNotification("n1", "Unread", "Body", null, false, "2026-01-01"),
    )
    fakeRepository.notificationsResult = AppResult.Success(
      NotificationPage(items = notifications, nextCursor = null, hasMore = false),
    )
    fakeRepository.markReadResult = AppResult.Failure(
      AppError.Api(code = ApiErrorCode.DATABASE_UNAVAILABLE, message = "Could not update your updates."),
    )

    viewModel = NotificationsViewModel(fakeRepository, UnreadStore(fakeRepository))
    testDispatcher.scheduler.advanceUntilIdle()

    viewModel.markAllRead()
    testDispatcher.scheduler.advanceUntilIdle()

    viewModel.state.test {
      val state = awaitItem()
      // Nothing was marked on the server, so nothing may look marked here.
      assertThat(state.items.single().isRead).isFalse()
      assertThat(state.unreadLoaded).isEqualTo(1)
      assertThat(state.markingRead).isFalse()
      assertThat(state.actionMessage).isEqualTo("Could not update your updates.")
    }

    viewModel.consumeActionMessage()
    assertThat(viewModel.state.value.actionMessage).isNull()
  }

  @Test
  fun `a partial mark re-reads the feed instead of guessing`() = runTest(testDispatcher) {
    val notifications = listOf(
      AppNotification("n1", "Unread", "Body", null, false, "2026-01-01"),
      AppNotification("n2", "Also unread", "Body", null, false, "2025-12-31"),
    )
    fakeRepository.notificationsResult = AppResult.Success(
      NotificationPage(items = notifications, nextCursor = null, hasMore = false),
    )
    // Two were sent, the server marked one. Which one is the server's business.
    fakeRepository.markReadResult = AppResult.Success(1)

    viewModel = NotificationsViewModel(fakeRepository, UnreadStore(fakeRepository))
    testDispatcher.scheduler.advanceUntilIdle()

    fakeRepository.notificationsResult = AppResult.Success(
      NotificationPage(
        items = listOf(
          AppNotification("n1", "Unread", "Body", null, true, "2026-01-01"),
          AppNotification("n2", "Also unread", "Body", null, false, "2025-12-31"),
        ),
        nextCursor = null,
        hasMore = false,
      ),
    )
    viewModel.markAllRead()
    testDispatcher.scheduler.advanceUntilIdle()

    viewModel.state.test {
      val state = awaitItem()
      assertThat(state.items.map { it.isRead }).containsExactly(true, false).inOrder()
      assertThat(state.unreadLoaded).isEqualTo(1)
    }
  }

  @Test
  fun `the server's exact unread total feeds the shared badge source`() = runTest(testDispatcher) {
    fakeRepository.notificationsResult = AppResult.Success(
      NotificationPage(
        items = listOf(AppNotification("n1", "Unread", "Body", null, false, "2026-01-01")),
        nextCursor = "cursor1",
        hasMore = true,
        unreadCount = 7,
      ),
    )

    val unread = UnreadStore(fakeRepository)
    viewModel = NotificationsViewModel(fakeRepository, unread)
    testDispatcher.scheduler.advanceUntilIdle()

    // The first page carries the server's exact total for the whole feed, not
    // a count of what happens to be loaded; the loaded-page floor is only a
    // fallback for the moment before that total arrives.
    assertThat(unread.unreadCount.value).isEqualTo(7)
    assertThat(viewModel.state.value.unreadLoaded).isEqualTo(1)

    // Marking notifications read subtracts the server-confirmed number.
    fakeRepository.markReadResult = AppResult.Success(1)
    viewModel.markAllRead()
    testDispatcher.scheduler.advanceUntilIdle()

    assertThat(unread.unreadCount.value).isEqualTo(6)
  }

  @Test
  fun `a page without a total leaves the badge source untouched`() = runTest(testDispatcher) {
    val unread = UnreadStore(fakeRepository)
    viewModel = NotificationsViewModel(fakeRepository, unread)
    testDispatcher.scheduler.advanceUntilIdle()

    // No `unreadCount` on the envelope means exactly that: unknown. The badge
    // must stay hidden rather than claim zero unread notifications.
    assertThat(unread.unreadCount.value).isNull()
    assertThat(viewModel.state.value.unreadLoaded).isEqualTo(0)
  }
}