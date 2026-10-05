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
class WalletViewModelTest {

  private val testDispatcher = StandardTestDispatcher()
  private lateinit var fakeRepository: FakeEngagementRepository
  private lateinit var viewModel: WalletViewModel

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
  fun `load shows wallet summary and ledger`() = runTest(testDispatcher) {
    val summary = WalletSummary(
      coinsFundedPaise = 100_000_00,
      coinsSpentPaise = 25_000_00,
      hasConfiguredLimit = true,
      isOverLimit = false,
      allowOverdue = false,
    )
    val entries = listOf(
      WalletLedgerEntry("e1", "ORDER_DEBIT", 5000_00, "debit", "Order #123", null, "order", "o1", false, "2026-01-01"),
      WalletLedgerEntry("e2", "PAYMENT_CREDIT", 10000_00, "credit", "Payment received", null, "payment", "p1", false, "2025-12-31"),
    )

    fakeRepository.walletSummaryResult = AppResult.Success(summary)
    fakeRepository.walletLedgerResult = AppResult.Success(
      WalletLedgerPage(entries = entries, nextCursor = null, hasMore = false, total = 2),
    )

    viewModel = WalletViewModel(fakeRepository)
    testDispatcher.scheduler.advanceUntilIdle()

    viewModel.state.test {
      val state = awaitItem()
      assertThat(state.summaryLoading).isFalse()
      assertThat(state.summary).isNotNull()
      assertThat(state.summary!!.coinBalancePaise).isEqualTo(75_000_00)
      assertThat(state.entries).hasSize(2)
      assertThat(state.ledgerTotal).isEqualTo(2)
    }
  }

  @Test
  fun `load shows error on failure`() = runTest(testDispatcher) {
    fakeRepository.walletSummaryResult = AppResult.Failure(
      AppError.Network(message = "No connection"),
    )

    viewModel = WalletViewModel(fakeRepository)
    testDispatcher.scheduler.advanceUntilIdle()

    viewModel.state.test {
      val state = awaitItem()
      assertThat(state.summaryLoading).isFalse()
      assertThat(state.summary).isNull()
      assertThat(state.errorMessage).isNotNull()
      assertThat(state.offline).isTrue()
    }
  }

  @Test
  fun `loadMore appends ledger entries`() = runTest(testDispatcher) {
    val firstBatch = listOf(
      WalletLedgerEntry("e1", "ORDER_DEBIT", 5000_00, "debit", "Order #1", null, null, null, false, "2026-01-01"),
    )
    val secondBatch = listOf(
      WalletLedgerEntry("e2", "ORDER_DEBIT", 3000_00, "debit", "Order #2", null, null, null, false, "2025-12-31"),
    )

    fakeRepository.walletSummaryResult = AppResult.Success(
      WalletSummary(0, 0, 0, false, false, false),
    )
    fakeRepository.walletLedgerResult = AppResult.Success(
      WalletLedgerPage(entries = firstBatch, nextCursor = "cursor1", hasMore = true, total = 2),
    )
    viewModel = WalletViewModel(fakeRepository)
    testDispatcher.scheduler.advanceUntilIdle()

    fakeRepository.walletLedgerResult = AppResult.Success(
      WalletLedgerPage(entries = secondBatch, nextCursor = null, hasMore = false, total = 2),
    )
    viewModel.loadMore()
    testDispatcher.scheduler.advanceUntilIdle()

    viewModel.state.test {
      val state = awaitItem()
      assertThat(state.entries).hasSize(2)
      // `WalletUiState` namespaces the ledger paging flags, because the screen
      // also pages a summary: the field is `ledgerHasMore`, not `hasMore`.
      assertThat(state.ledgerHasMore).isFalse()
    }
  }

  @Test
  fun `a shop that overspent has zero coins, never a negative balance`() {
    // The server reports `availablePaise` as funded minus spent WITHOUT a
    // clamp, so an overspent account arrives as a negative number. Showing it
    // would tell a shopkeeper they hold minus five thousand coins.
    val overspent = WalletSummary(
      coinsFundedPaise = 10_000_00,
      coinsSpentPaise = 15_000_00,
      hasConfiguredLimit = true,
      isOverLimit = true,
      allowOverdue = false,
    )

    assertThat(overspent.coinBalancePaise).isEqualTo(0)
  }

  @Test
  fun `the coin balance is funded minus spent`() {
    // Same arithmetic as `coinBalancePaise()` in lib/coins/math.ts, which is
    // what the server uses when it debits an order. If these ever disagree,
    // checkout shows one number and charges another.
    val summary = WalletSummary(
      coinsFundedPaise = 100_000_00,
      coinsSpentPaise = 25_000_00,
      hasConfiguredLimit = true,
      isOverLimit = false,
      allowOverdue = false,
    )

    assertThat(summary.coinBalancePaise).isEqualTo(75_000_00)
  }

  @Test
  fun `ledger rows are described in coins, matching the web labels`() {
    assertThat(CoinVocabulary.typeLabel("ORDER_DEBIT")).isEqualTo("Coins spent")
    assertThat(CoinVocabulary.typeLabel("PAYMENT_CREDIT")).isEqualTo("Coins added")
    assertThat(CoinVocabulary.typeLabel("ORDER_REVERSAL")).isEqualTo("Coins refunded")
    assertThat(CoinVocabulary.typeLabel("CREDIT_LIMIT_CHANGE")).isEqualTo("Coins funded")
    // An unknown type is shown as-is rather than hidden or guessed at.
    assertThat(CoinVocabulary.typeLabel("SOME_NEW_TYPE")).isEqualTo("SOME NEW TYPE")

    assertThat(CoinVocabulary.addsCoins("credit")).isTrue()
    assertThat(CoinVocabulary.addsCoins("debit")).isFalse()
  }
}
