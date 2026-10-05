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
class CouponsViewModelTest {

  private val testDispatcher = StandardTestDispatcher()
  private lateinit var fakeRepository: FakeEngagementRepository
  private lateinit var viewModel: CouponsViewModel

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
  fun `load shows coupons on success`() = runTest(testDispatcher) {
    val coupons = listOf(
      CouponItem("c1", "SAVE10", "10% off", "On orders above ₹500", "percentage", 10.0, 500.0, 100.0, null, null, false, "available"),
      CouponItem("c2", "FLAT50", "₹50 off", null, "flat", 50.0, 0.0, null, null, null, false, "available"),
    )
    fakeRepository.couponsResult = AppResult.Success(CouponsState(coupons = coupons))

    viewModel = CouponsViewModel(fakeRepository)
    testDispatcher.scheduler.advanceUntilIdle()

    viewModel.state.test {
      val state = awaitItem()
      assertThat(state.loading).isFalse()
      assertThat(state.coupons).hasSize(2)
      assertThat(state.coupons[0].code).isEqualTo("SAVE10")
    }
  }

  @Test
  fun `load shows empty state when no coupons`() = runTest(testDispatcher) {
    fakeRepository.couponsResult = AppResult.Success(CouponsState(coupons = emptyList()))

    viewModel = CouponsViewModel(fakeRepository)
    testDispatcher.scheduler.advanceUntilIdle()

    viewModel.state.test {
      val state = awaitItem()
      assertThat(state.loading).isFalse()
      assertThat(state.coupons).isEmpty()
    }
  }

  @Test
  fun `load shows error on failure`() = runTest(testDispatcher) {
    fakeRepository.couponsResult = AppResult.Failure(
      AppError.Api(code = "database_unavailable", message = "Try again.", status = 503, retryable = true),
    )

    viewModel = CouponsViewModel(fakeRepository)
    testDispatcher.scheduler.advanceUntilIdle()

    viewModel.state.test {
      val state = awaitItem()
      assertThat(state.loading).isFalse()
      assertThat(state.coupons).isEmpty()
      assertThat(state.errorMessage).isEqualTo("Try again.")
    }
  }
}