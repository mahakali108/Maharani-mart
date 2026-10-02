package com.maharanitraders.feature.auth

import com.google.common.truth.Truth.assertThat
import com.maharanitraders.core.auth.RegistrationRequest
import com.maharanitraders.core.auth.RegistrationResult
import com.maharanitraders.core.auth.SessionController
import com.maharanitraders.core.auth.SessionState
import com.maharanitraders.core.auth.SignOutReason
import com.maharanitraders.core.model.AccessContext
import com.maharanitraders.core.model.NavigationPolicy
import com.maharanitraders.core.model.SessionSnapshot
import com.maharanitraders.core.model.SessionUser
import com.maharanitraders.core.model.UserRole
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
 * Sign-in ViewModel behaviour.
 *
 * Everything is a plain JVM test: the ViewModel talks to a [SessionController]
 * fake, so no network, no device and no Hilt graph are involved. What is
 * asserted here is exactly what the acceptance criteria call for — loading,
 * success, failure and duplicate-submission protection — plus the promise that a
 * successful sign-in does not leave the password in memory.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class LoginViewModelTest {

  private val dispatcher = StandardTestDispatcher()

  @Before
  fun setUp() = Dispatchers.setMain(dispatcher)

  @After
  fun tearDown() = Dispatchers.resetMain()

  @Test
  fun `does not call the session layer when the form is invalid`() = runTest(dispatcher) {
    val session = FakeSession()
    val viewModel = LoginViewModel(session)

    viewModel.submit()
    advanceUntilIdle()

    assertThat(session.signInCalls).isEmpty()
    assertThat(viewModel.state.value.fieldErrors).containsKey(LoginViewModel.FIELD_IDENTIFIER)
    assertThat(viewModel.state.value.fieldErrors).containsKey(LoginViewModel.FIELD_PASSWORD)
  }

  @Test
  fun `reports a submitting state before the server answers`() = runTest(dispatcher) {
    val session = FakeSession(result = SessionState.SignedOut(SignOutReason.SIGNED_OUT))
    val viewModel = LoginViewModel(session)

    viewModel.onIdentifierChange("shop@example.com")
    viewModel.onPasswordChange("secret123")
    viewModel.submit()

    // Before the coroutine runs: the button is disabled and progress is shown.
    assertThat(viewModel.state.value.submitting).isTrue()
    assertThat(viewModel.state.value.canSubmit).isFalse()

    advanceUntilIdle()
    assertThat(viewModel.state.value.submitting).isFalse()
  }

  @Test
  fun `an authenticated session clears the password and signals success`() = runTest(dispatcher) {
    val session = FakeSession(result = SessionState.Authenticated(snapshot()))
    val viewModel = LoginViewModel(session)

    viewModel.onIdentifierChange("+91 98765 43210")
    viewModel.onPasswordChange("secret123")
    viewModel.submit()
    advanceUntilIdle()

    assertThat(session.signInCalls).containsExactly("+91 98765 43210" to "secret123")
    assertThat(viewModel.state.value.signedIn).isTrue()
    // The password must not survive a successful sign-in.
    assertThat(viewModel.state.value.password).isEmpty()
  }

  @Test
  fun `bad credentials are shown as a form error, not a crash or a gate`() = runTest(dispatcher) {
    val session = FakeSession(
      result = SessionState.Unavailable("Invalid email or password. Please try again.", retryable = false)
    )
    val viewModel = LoginViewModel(session)

    viewModel.onIdentifierChange("shop@example.com")
    viewModel.onPasswordChange("wrong")
    viewModel.submit()
    advanceUntilIdle()

    assertThat(viewModel.state.value.formError).contains("Invalid email or password")
    assertThat(viewModel.state.value.signedIn).isFalse()
  }

  @Test
  fun `a pending-approval account is explained rather than reported as a failure`() = runTest(dispatcher) {
    val session = FakeSession(result = SessionState.SignedOut(SignOutReason.PENDING_APPROVAL))
    val viewModel = LoginViewModel(session)

    viewModel.onIdentifierChange("shop@example.com")
    viewModel.onPasswordChange("secret123")
    viewModel.submit()
    advanceUntilIdle()

    // Information, not an error: the credentials were correct.
    assertThat(viewModel.state.value.formError).contains("awaiting approval")
  }

  @Test
  fun `a double tap produces exactly one sign-in attempt`() = runTest(dispatcher) {
    val session = FakeSession(result = SessionState.Authenticated(snapshot()))
    val viewModel = LoginViewModel(session)

    viewModel.onIdentifierChange("shop@example.com")
    viewModel.onPasswordChange("secret123")
    viewModel.submit()
    viewModel.submit()
    viewModel.submit()
    advanceUntilIdle()

    assertThat(session.signInCalls).hasSize(1)
  }

  @Test
  fun `editing a field clears its error but keeps the other`() = runTest(dispatcher) {
    val viewModel = LoginViewModel(FakeSession())
    viewModel.submit()
    advanceUntilIdle()
    assertThat(viewModel.state.value.fieldErrors).hasSize(2)

    viewModel.onIdentifierChange("shop@example.com")
    assertThat(viewModel.state.value.fieldErrors).doesNotContainKey(LoginViewModel.FIELD_IDENTIFIER)
    assertThat(viewModel.state.value.fieldErrors).containsKey(LoginViewModel.FIELD_PASSWORD)
  }

  private fun snapshot() = SessionSnapshot(
    user = SessionUser(
      id = "user-1",
      email = "shop@example.com",
      role = UserRole.RETAILER,
      fullName = "Ramesh Kumar",
      phone = "9876543210",
      isActive = true,
    ),
    retailer = null,
    access = AccessContext(status = "active", expiresAtIso = null),
    navigation = NavigationPolicy(
      homeRoute = "/retailer/home",
      workspaces = emptyList(),
      permissions = emptySet(),
    ),
  )

  private class FakeSession(
    private val result: SessionState = SessionState.SignedOut(SignOutReason.NEVER_SIGNED_IN),
  ) : SessionController {

    val signInCalls = mutableListOf<Pair<String, String>>()

    private val _state = MutableStateFlow<SessionState>(SessionState.SignedOut(SignOutReason.NEVER_SIGNED_IN))
    override val state: StateFlow<SessionState> = _state

    override fun accessToken(): String? = null

    override suspend fun restore(): SessionState = _state.value

    override suspend fun signIn(identifier: String, password: String): SessionState {
      signInCalls += identifier to password
      _state.value = result
      return result
    }

    override suspend fun registerRetailer(request: RegistrationRequest): RegistrationResult =
      RegistrationResult.Failed(
        com.maharanitraders.core.common.AppError.Unexpected()
      )

    override suspend fun signOut() {
      _state.value = SessionState.SignedOut(SignOutReason.SIGNED_OUT)
    }
  }
}
