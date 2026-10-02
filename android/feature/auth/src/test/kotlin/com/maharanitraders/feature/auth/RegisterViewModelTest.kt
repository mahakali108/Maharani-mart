package com.maharanitraders.feature.auth

import com.google.common.truth.Truth.assertThat
import com.maharanitraders.core.auth.RegistrationRequest
import com.maharanitraders.core.auth.RegistrationResult
import com.maharanitraders.core.auth.SessionController
import com.maharanitraders.core.auth.SessionState
import com.maharanitraders.core.auth.SignOutReason
import com.maharanitraders.core.common.AppError
import com.maharanitraders.core.model.ApiErrorCode
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Before
import org.junit.Test

/**
 * Registration ViewModel behaviour.
 *
 * The two properties that matter most:
 *  1. the area list comes from the server, and the form refuses to submit
 *     without it — a made-up area creates an account the database rejects;
 *  2. success is "awaiting approval", never "you can order".
 */
@OptIn(ExperimentalCoroutinesApi::class)
class RegisterViewModelTest {

  private val dispatcher = StandardTestDispatcher()
  private val area = AreaOption(id = "11111111-1111-4111-8111-111111111111", name = "Khagaria Town", district = "Khagaria")

  @Before
  fun setUp() = Dispatchers.setMain(dispatcher)

  @After
  fun tearDown() = Dispatchers.resetMain()

  private fun fillValidForm(viewModel: RegisterViewModel) {
    viewModel.onFullNameChange("Ramesh Kumar")
    viewModel.onShopNameChange("Kumar Kirana")
    viewModel.onPhoneChange("+91 98765 43210")
    viewModel.onEmailChange("Kumar@Example.com")
    viewModel.onAddressChange("Main Road, Khagaria")
    viewModel.onPasswordChange("a-good-password")
    viewModel.onConfirmPasswordChange("a-good-password")
    viewModel.onAreaChange(area.id)
  }

  @Test
  fun `loads the area list from the directory`() = runTest(dispatcher) {
    val session = FakeSession()
    val viewModel = RegisterViewModel(session, FakeAreaDirectory(AreaDirectoryResult.Loaded(listOf(area))))
    advanceUntilIdle()

    assertThat(viewModel.state.value.areas).hasSize(1)
    assertThat(viewModel.state.value.areasError).isNull()
  }

  @Test
  fun `an unavailable area list is reported and blocks submission`() = runTest(dispatcher) {
    val session = FakeSession()
    val viewModel = RegisterViewModel(
      session,
      FakeAreaDirectory(AreaDirectoryResult.Failed("You appear to be offline.")),
    )
    advanceUntilIdle()

    assertThat(viewModel.state.value.areasError).contains("offline")

    fillValidForm(viewModel)
    viewModel.submit()
    advanceUntilIdle()

    // No area id was ever chosen, so nothing may be sent.
    assertThat(session.registerCalls).isEmpty()
  }

  @Test
  fun `submits a normalized payload and reports pending approval`() = runTest(dispatcher) {
    val session = FakeSession(result = RegistrationResult.Registered(requiresEmailConfirmation = true))
    val viewModel = RegisterViewModel(session, FakeAreaDirectory(AreaDirectoryResult.Loaded(listOf(area))))
    advanceUntilIdle()

    fillValidForm(viewModel)
    viewModel.submit()
    advanceUntilIdle()

    assertThat(session.registerCalls).hasSize(1)
    val sent = session.registerCalls.single()
    // Canonical phone + lowercased email are what the server stores.
    assertThat(sent.phone).isEqualTo("9876543210")
    assertThat(sent.email).isEqualTo("kumar@example.com")

    assertThat(viewModel.state.value.registered).isTrue()
    assertThat(viewModel.state.value.requiresEmailConfirmation).isTrue()
    // Credentials are not kept after a successful submission.
    assertThat(viewModel.state.value.password).isEmpty()
    assertThat(viewModel.state.value.confirmPassword).isEmpty()
  }

  @Test
  fun `server field errors are attached to their inputs`() = runTest(dispatcher) {
    val session = FakeSession(
      result = RegistrationResult.Failed(
        AppError.Api(
          code = ApiErrorCode.CONFLICT,
          message = "Please check the highlighted fields.",
          fieldErrors = mapOf(RegisterViewModel.FIELD_PHONE to "This phone number is already registered."),
        )
      )
    )
    val viewModel = RegisterViewModel(session, FakeAreaDirectory(AreaDirectoryResult.Loaded(listOf(area))))
    advanceUntilIdle()

    fillValidForm(viewModel)
    viewModel.submit()
    advanceUntilIdle()

    assertThat(viewModel.state.value.fieldErrors[RegisterViewModel.FIELD_PHONE]).isNotNull()
    // When a field carries the message, it is not duplicated as a form error.
    assertThat(viewModel.state.value.formError).isNull()
    assertThat(viewModel.state.value.registered).isFalse()
  }

  @Test
  fun `a non-field failure is shown as a form error`() = runTest(dispatcher) {
    val session = FakeSession(
      result = RegistrationResult.Failed(AppError.Network())
    )
    val viewModel = RegisterViewModel(session, FakeAreaDirectory(AreaDirectoryResult.Loaded(listOf(area))))
    advanceUntilIdle()

    fillValidForm(viewModel)
    viewModel.submit()
    advanceUntilIdle()

    assertThat(viewModel.state.value.formError).isNotNull()
    assertThat(viewModel.state.value.fieldErrors).isEmpty()
  }

  @Test
  fun `invalid input never reaches the network`() = runTest(dispatcher) {
    val session = FakeSession()
    val viewModel = RegisterViewModel(session, FakeAreaDirectory(AreaDirectoryResult.Loaded(listOf(area))))
    advanceUntilIdle()

    viewModel.onFullNameChange("R")
    viewModel.onPhoneChange("12345")
    viewModel.onPasswordChange("short")
    viewModel.onConfirmPasswordChange("different")
    viewModel.submit()
    advanceUntilIdle()

    assertThat(session.registerCalls).isEmpty()
    assertThat(viewModel.state.value.fieldErrors).isNotEmpty()
  }

  private class FakeAreaDirectory(private val result: AreaDirectoryResult) : AreaDirectory {
    override suspend fun load(): AreaDirectoryResult = result
  }

  private class FakeSession(
    private val result: RegistrationResult = RegistrationResult.Registered(requiresEmailConfirmation = false),
  ) : SessionController {

    val registerCalls = mutableListOf<RegistrationRequest>()

    override val state: StateFlow<SessionState> =
      MutableStateFlow<SessionState>(SessionState.SignedOut(SignOutReason.NEVER_SIGNED_IN))

    override fun accessToken(): String? = null
    override suspend fun restore(): SessionState = state.value

    override suspend fun signIn(identifier: String, password: String): SessionState =
      SessionState.SignedOut(SignOutReason.NEVER_SIGNED_IN)

    override suspend fun registerRetailer(request: RegistrationRequest): RegistrationResult {
      registerCalls += request
      return result
    }

    override suspend fun signOut() = Unit
  }
}
