package com.maharanitraders.feature.engagement

import app.cash.turbine.test
import com.google.common.truth.Truth.assertThat
import com.maharanitraders.core.common.AppError
import com.maharanitraders.core.common.AppResult
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
      AppError.Api(code = "database_unavailable", message = "Try again.", status = 503, retryable = true),
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
}