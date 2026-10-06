package com.maharanitraders.feature.auth

import com.google.common.truth.Truth.assertThat
import com.maharanitraders.core.auth.AuthRepository
import com.maharanitraders.core.common.TimeSource
import com.maharanitraders.core.network.ApiCallExecutor
import com.maharanitraders.core.network.ApiErrorMapper
import com.maharanitraders.core.network.dto.AckDto
import com.maharanitraders.core.network.dto.ApiEnvelope
import java.io.IOException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import kotlinx.serialization.json.Json
import org.junit.After
import org.junit.Before
import org.junit.Test

/**
 * Forgot-password ViewModel behaviour.
 *
 * The properties that matter:
 *  1. a valid email reaches the real reset endpoint, trimmed, exactly once —
 *     the endpoint is rate limited, so double submits must be dropped;
 *  2. an invalid email is rejected on the client and never sent;
 *  3. success is only claimed after the server answered;
 *  4. a failure is reported verbatim and never rendered as "sent".
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ForgotPasswordViewModelTest {

  private val dispatcher = StandardTestDispatcher()

  @Before
  fun setUp() = Dispatchers.setMain(dispatcher)

  @After
  fun tearDown() = Dispatchers.resetMain()

  private fun viewModel(api: FakeAuthApi): ForgotPasswordViewModel {
    val executor = ApiCallExecutor(ApiErrorMapper(Json { ignoreUnknownKeys = true }), dispatcher)
    val repository = AuthRepository(api = api, executor = executor, timeSource = TimeSource { 1_000_000L })
    return ForgotPasswordViewModel(repository)
  }

  @Test
  fun `submits a valid email to the reset endpoint`() = runTest(dispatcher) {
    val api = FakeAuthApi()
    val viewModel = viewModel(api)

    viewModel.onEmailChange("shop@example.com")
    viewModel.submit()
    advanceUntilIdle()

    assertThat(api.passwordResetRequests.single().email).isEqualTo("shop@example.com")
    val state = viewModel.state.value
    assertThat(state.sent).isTrue()
    assertThat(state.submitting).isFalse()
    assertThat(state.formError).isNull()
  }

  @Test
  fun `trims the email before sending`() = runTest(dispatcher) {
    val api = FakeAuthApi()
    val viewModel = viewModel(api)

    viewModel.onEmailChange("  shop@example.com  ")
    viewModel.submit()
    advanceUntilIdle()

    assertThat(api.passwordResetRequests.single().email).isEqualTo("shop@example.com")
  }

  @Test
  fun `rejects an invalid email without calling the server`() = runTest(dispatcher) {
    val api = FakeAuthApi()
    val viewModel = viewModel(api)

    viewModel.onEmailChange("not-an-email")
    viewModel.submit()
    advanceUntilIdle()

    assertThat(api.passwordResetRequests).isEmpty()
    val state = viewModel.state.value
    assertThat(state.fieldError).isNotNull()
    assertThat(state.sent).isFalse()
  }

  @Test
  fun `rejects an empty email without calling the server`() = runTest(dispatcher) {
    val api = FakeAuthApi()
    val viewModel = viewModel(api)

    viewModel.submit()
    advanceUntilIdle()

    assertThat(api.passwordResetRequests).isEmpty()
    assertThat(viewModel.state.value.sent).isFalse()
  }

  @Test
  fun `typing clears a previous field error`() = runTest(dispatcher) {
    val viewModel = viewModel(FakeAuthApi())

    viewModel.submit()
    assertThat(viewModel.state.value.fieldError).isNotNull()

    viewModel.onEmailChange("s")
    assertThat(viewModel.state.value.fieldError).isNull()
  }

  @Test
  fun `reports a network failure without claiming the email was sent`() = runTest(dispatcher) {
    val api = FakeAuthApi().apply {
      nextResetResult = { throw IOException("network down") }
    }
    val viewModel = viewModel(api)

    viewModel.onEmailChange("shop@example.com")
    viewModel.submit()
    advanceUntilIdle()

    val state = viewModel.state.value
    assertThat(state.sent).isFalse()
    assertThat(state.submitting).isFalse()
    assertThat(state.formError).isNotNull()
  }

  @Test
  fun `a second submit while one is in flight is dropped`() = runTest(dispatcher) {
    val api = FakeAuthApi()
    val gate = CompletableDeferred<ApiEnvelope<AckDto>>()
    api.resetGate = gate
    val viewModel = viewModel(api)

    viewModel.onEmailChange("shop@example.com")
    viewModel.submit()
    viewModel.submit()
    advanceUntilIdle()

    // Only ONE request reached the endpoint while the first was still in
    // flight — the endpoint's rate limit depends on this.
    assertThat(api.passwordResetRequests).hasSize(1)
    assertThat(viewModel.state.value.submitting).isTrue()

    gate.complete(ApiEnvelope(AckDto(ok = true)))
    advanceUntilIdle()

    assertThat(viewModel.state.value.sent).isTrue()
    assertThat(api.passwordResetRequests).hasSize(1)
  }

  @Test
  fun `primeEmail fills a valid email but never overwrites typed input`() = runTest(dispatcher) {
    val viewModel = viewModel(FakeAuthApi())

    viewModel.primeEmail("typed@example.com")
    assertThat(viewModel.state.value.email).isEqualTo("typed@example.com")

    viewModel.primeEmail("other@example.com")
    assertThat(viewModel.state.value.email).isEqualTo("typed@example.com")
  }

  @Test
  fun `primeEmail ignores values that are not emails`() = runTest(dispatcher) {
    val viewModel = viewModel(FakeAuthApi())

    viewModel.primeEmail("9876543210")
    assertThat(viewModel.state.value.email).isEmpty()
  }

  @Test
  fun `reset blanks the form so the next account inherits nothing`() = runTest(dispatcher) {
    val viewModel = viewModel(FakeAuthApi())

    viewModel.onEmailChange("shop-a@example.com")
    viewModel.submit()
    advanceUntilIdle()
    assertThat(viewModel.state.value.sent).isTrue()

    // The signed-out flow re-enters composition after a sign-out and resets:
    // account B must not see account A's confirmation.
    viewModel.reset()
    val state = viewModel.state.value
    assertThat(state.sent).isFalse()
    assertThat(state.email).isEmpty()
    assertThat(state.formError).isNull()
    assertThat(state.fieldError).isNull()
  }
}
