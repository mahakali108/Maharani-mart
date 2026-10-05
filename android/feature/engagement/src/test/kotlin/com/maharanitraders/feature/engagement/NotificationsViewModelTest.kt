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

    viewModel = NotificationsViewModel(fakeRepository)
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

    viewModel = NotificationsViewModel(fakeRepository)
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
    viewModel = NotificationsViewModel(fakeRepository)
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
  fun `markAllRead updates local state`() = runTest(testDispatcher) {
    val notifications = listOf(
      AppNotification("n1", "Unread", "Body", null, false, "2026-01-01"),
      AppNotification("n2", "Already read", "Body", null, true, "2025-12-31"),
    )
    fakeRepository.notificationsResult = AppResult.Success(
      NotificationPage(items = notifications, nextCursor = null, hasMore = false),
    )
    fakeRepository.markReadResult = AppResult.Success(1)

    viewModel = NotificationsViewModel(fakeRepository)
    testDispatcher.scheduler.advanceUntilIdle()

    viewModel.markAllRead()
    testDispatcher.scheduler.advanceUntilIdle()

    viewModel.state.test {
      val state = awaitItem()
      assertThat(state.items.all { it.isRead }).isTrue()
    }
  }

  @Test
  fun `the unread filter is a server query, not a client-side trim`() = runTest(testDispatcher) {
    fakeRepository.notificationsResult = AppResult.Success(
      NotificationPage(
        items = listOf(AppNotification("n1", "Unread", "Body", null, false, "2026-01-01")),
        nextCursor = null,
        hasMore = false,
      ),
    )
    viewModel = NotificationsViewModel(fakeRepository)
    testDispatcher.scheduler.advanceUntilIdle()

    viewModel.setUnreadOnly(true)
    testDispatcher.scheduler.advanceUntilIdle()

    assertThat(viewModel.state.value.unreadOnly).isTrue()
    // Two reads: the unfiltered start, then the filtered one — each carrying the
    // flag, and never a cursor from the previous filter.
    assertThat(fakeRepository.notificationQueries).containsExactly(null to false, null to true)
  }

  @Test
  fun `switching the filter starts from an empty list`() = runTest(testDispatcher) {
    fakeRepository.notificationsResult = AppResult.Success(
      NotificationPage(
        items = listOf(AppNotification("n1", "One", "Body", null, true, "2026-01-01")),
        nextCursor = "next",
        hasMore = true,
      ),
    )
    viewModel = NotificationsViewModel(fakeRepository)
    testDispatcher.scheduler.advanceUntilIdle()

    viewModel.setUnreadOnly(true)
    testDispatcher.scheduler.advanceUntilIdle()

    // Rows from the other query are gone while the new one is in flight: showing
    // them would imply they matched a filter they were never fetched with.
    assertThat(viewModel.state.value.items).isEmpty()
    assertThat(viewModel.state.value.hasMore).isFalse()
    assertThat(viewModel.state.value.nextCursor).isNull()
  }

  @Test
  fun `tapping one alert marks only that alert read`() = runTest(testDispatcher) {
    fakeRepository.notificationsResult = AppResult.Success(
      NotificationPage(
        items = listOf(
          AppNotification("n1", "Unread", "Body", null, false, "2026-01-01"),
          AppNotification("n2", "Other unread", "Body", null, false, "2026-01-02"),
        ),
        nextCursor = null,
        hasMore = false,
      ),
    )
    fakeRepository.markReadResult = AppResult.Success(1)
    viewModel = NotificationsViewModel(fakeRepository)
    testDispatcher.scheduler.advanceUntilIdle()

    viewModel.markRead("n1")
    testDispatcher.scheduler.advanceUntilIdle()

    assertThat(fakeRepository.readBatches).containsExactly(listOf("n1"))
    assertThat(viewModel.state.value.items.map { it.id to it.isRead })
      .containsExactly("n1" to true, "n2" to false).inOrder()
    assertThat(viewModel.state.value.actionMessage).isNull()
  }

  @Test
  fun `a read alert is not written to again`() = runTest(testDispatcher) {
    fakeRepository.notificationsResult = AppResult.Success(
      NotificationPage(
        items = listOf(AppNotification("n1", "Read", "Body", null, true, "2026-01-01")),
        nextCursor = null,
        hasMore = false,
      ),
    )
    viewModel = NotificationsViewModel(fakeRepository)
    testDispatcher.scheduler.advanceUntilIdle()

    viewModel.markRead("n1")
    viewModel.markRead("does-not-exist")
    testDispatcher.scheduler.advanceUntilIdle()

    assertThat(fakeRepository.readBatches).isEmpty()
  }

  @Test
  fun `a failed read state keeps the feed and says so`() = runTest(testDispatcher) {
    fakeRepository.notificationsResult = AppResult.Success(
      NotificationPage(
        items = listOf(AppNotification("n1", "Unread", "Body", null, false, "2026-01-01")),
        nextCursor = null,
        hasMore = false,
      ),
    )
    fakeRepository.markReadResult = AppResult.Failure(
      AppError.Api(code = ApiErrorCode.DATABASE_UNAVAILABLE, message = "Nope."),
    )
    viewModel = NotificationsViewModel(fakeRepository)
    testDispatcher.scheduler.advanceUntilIdle()

    viewModel.markRead("n1")
    testDispatcher.scheduler.advanceUntilIdle()

    // The alert stays unread (the server never accepted the write) and the feed
    // stays on screen: a failed PATCH is not a reason to lose the list.
    assertThat(viewModel.state.value.items.single().isRead).isFalse()
    assertThat(viewModel.state.value.errorMessage).isNull()
    assertThat(viewModel.state.value.actionMessage).isNotNull()
  }
}
