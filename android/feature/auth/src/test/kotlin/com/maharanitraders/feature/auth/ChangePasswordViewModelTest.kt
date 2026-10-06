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
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.After
import org.junit.Before
import org.junit.Test
import retrofit2.HttpException
import retrofit2.Response

/**
 * Change-password ViewModel behaviour.
 *
 * The properties that matter:
 *  1. a valid pair reaches the authenticated endpoint and success is only
 *     claimed after the server answered — then the fields are cleared so the
 *     new password is not kept in memory;
 *  2. client-side validation (length, confirmation match) rejects without a
 *     round trip;
 *  3. the server's own per-field messages (GoTrue's password policy) are
 *     placed under the fields;
 *  4. other failures are reported and never rendered as "updated";
 *  5. a double tap cannot produce two password changes.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ChangePasswordViewModelTest {

  private val dispatcher = StandardTestDispatcher()

  @Before
  fun setUp() = Dispatchers.setMain(dispatcher)

  @After
  fun tearDown() = Dispatchers.resetMain()

  private fun viewModel(api: FakeAuthApi): ChangePasswordViewModel {
    val executor = ApiCallExecutor(ApiErrorMapper(Json { ignoreUnknownKeys = true }), dispatcher)
    val repository = AuthRepository(api = api, executor = executor, timeSource = TimeSource { 1_000_000L })
    return ChangePasswordViewModel(repository)
  }

  /** Forges the endpoint's `validation_failed` answer with a field message. */
  private fun weakPasswordError(): HttpException = HttpException(
    Response.error<Any>(
      400,
      """
      {"error":{
        "code":"validation_failed",
        "message":"Please check the highlighted fields.",
        "details":{"fields":{"password":"Choose a stronger password (at least 8 characters)."}}
      }}
      """.trimIndent().toResponseBody("application/json".toMediaType()),
    ),
  )

  @Test
  fun `updates the password through the authenticated endpoint`() = runTest(dispatcher) {
    val api = FakeAuthApi()
    val viewModel = viewModel(api)

    viewModel.onPasswordChange("a-stronger-password")
    viewModel.onConfirmPasswordChange("a-stronger-password")
    viewModel.submit()
    advanceUntilIdle()

    val request = api.passwordUpdateRequests.single()
    assertThat(request.password).isEqualTo("a-stronger-password")
    assertThat(request.confirmPassword).isEqualTo("a-stronger-password")

    val state = viewModel.state.value
    assertThat(state.updated).isTrue()
    assertThat(state.submitting).isFalse()
    // The new password is dropped from memory the moment the server accepts.
    assertThat(state.password).isEmpty()
    assertThat(state.confirmPassword).isEmpty()
  }

  @Test
  fun `acknowledging the success clears the confirmation surface`() = runTest(dispatcher) {
    val viewModel = viewModel(FakeAuthApi())

    viewModel.onPasswordChange("a-stronger-password")
    viewModel.onConfirmPasswordChange("a-stronger-password")
    viewModel.submit()
    advanceUntilIdle()
    assertThat(viewModel.state.value.updated).isTrue()

    viewModel.acknowledgeUpdated()
    assertThat(viewModel.state.value.updated).isFalse()
  }

  @Test
  fun `rejects a short password without calling the server`() = runTest(dispatcher) {
    val api = FakeAuthApi()
    val viewModel = viewModel(api)

    viewModel.onPasswordChange("short")
    viewModel.onConfirmPasswordChange("short")
    viewModel.submit()
    advanceUntilIdle()

    assertThat(api.passwordUpdateRequests).isEmpty()
    val state = viewModel.state.value
    assertThat(state.fieldErrors[ChangePasswordViewModel.FIELD_PASSWORD]).isNotNull()
    assertThat(state.updated).isFalse()
  }

  @Test
  fun `rejects a mismatched confirmation without calling the server`() = runTest(dispatcher) {
    val api = FakeAuthApi()
    val viewModel = viewModel(api)

    viewModel.onPasswordChange("a-stronger-password")
    viewModel.onConfirmPasswordChange("a-different-password")
    viewModel.submit()
    advanceUntilIdle()

    assertThat(api.passwordUpdateRequests).isEmpty()
    assertThat(viewModel.state.value.fieldErrors[ChangePasswordViewModel.FIELD_CONFIRM]).isNotNull()
  }

  @Test
  fun `typing clears the field error for that field`() = runTest(dispatcher) {
    val viewModel = viewModel(FakeAuthApi())

    viewModel.onPasswordChange("short")
    viewModel.submit()
    assertThat(viewModel.state.value.fieldErrors).isNotEmpty()

    viewModel.onPasswordChange("a-stronger-password-now")
    assertThat(viewModel.state.value.fieldErrors)
      .doesNotContainKey(ChangePasswordViewModel.FIELD_PASSWORD)
  }

  @Test
  fun `places the server's field message under the password field`() = runTest(dispatcher) {
    val api = FakeAuthApi().apply { nextUpdateResult = { throw weakPasswordError() } }
    val viewModel = viewModel(api)

    viewModel.onPasswordChange("a-stronger-password")
    viewModel.onConfirmPasswordChange("a-stronger-password")
    viewModel.submit()
    advanceUntilIdle()

    val state = viewModel.state.value
    assertThat(state.updated).isFalse()
    assertThat(state.formError).isNull()
    assertThat(state.fieldErrors[ChangePasswordViewModel.FIELD_PASSWORD])
      .isEqualTo("Choose a stronger password (at least 8 characters).")
  }

  @Test
  fun `reports a network failure without claiming the change`() = runTest(dispatcher) {
    val api = FakeAuthApi().apply { nextUpdateResult = { throw IOException("network down") } }
    val viewModel = viewModel(api)

    viewModel.onPasswordChange("a-stronger-password")
    viewModel.onConfirmPasswordChange("a-stronger-password")
    viewModel.submit()
    advanceUntilIdle()

    val state = viewModel.state.value
    assertThat(state.updated).isFalse()
    assertThat(state.submitting).isFalse()
    assertThat(state.formError).isNotNull()
    // The typed password stays for a retryable failure — the shopper should
    // not have to retype after a dropped connection.
    assertThat(state.password).isEqualTo("a-stronger-password")
  }

  @Test
  fun `a second submit while one is in flight is dropped`() = runTest(dispatcher) {
    val api = FakeAuthApi()
    val gate = CompletableDeferred<ApiEnvelope<AckDto>>()
    api.updateGate = gate
    val viewModel = viewModel(api)

    viewModel.onPasswordChange("a-stronger-password")
    viewModel.onConfirmPasswordChange("a-stronger-password")
    viewModel.submit()
    viewModel.submit()
    advanceUntilIdle()

    assertThat(api.passwordUpdateRequests).hasSize(1)
    assertThat(viewModel.state.value.submitting).isTrue()

    gate.complete(ApiEnvelope(AckDto(ok = true)))
    advanceUntilIdle()

    assertThat(viewModel.state.value.updated).isTrue()
    assertThat(api.passwordUpdateRequests).hasSize(1)
  }
}
