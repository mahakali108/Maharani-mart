package com.maharanitraders.feature.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.maharanitraders.core.auth.SessionController
import com.maharanitraders.core.auth.SessionState
import com.maharanitraders.core.auth.SignOutReason
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * Everything the sign-in screen renders, as one explicit state.
 *
 * There is no separate `isLoading` flag to forget to clear, and no way to be
 * "loading" and "errored" at once.
 */
data class LoginUiState(
  val identifier: String = "",
  val password: String = "",
  /** Field errors, keyed by field name (`identifier`, `password`). */
  val fieldErrors: Map<String, String> = emptyMap(),
  /** A message about the submission as a whole (bad credentials, offline, …). */
  val formError: String? = null,
  val submitting: Boolean = false,
  /** Set once the credentials were accepted; the shell reacts and navigates. */
  val signedIn: Boolean = false,
) {
  val canSubmit: Boolean get() = !submitting && identifier.isNotBlank() && password.isNotEmpty()
}

/**
 * Sign-in.
 *
 * What this ViewModel deliberately does NOT do:
 *  - it never stores the password anywhere but this state, and clears it as soon
 *    as the attempt finishes;
 *  - it never retries automatically — a wrong password must not be replayed, and
 *    a timeout is reported rather than retried (the server is the only thing
 *    that may accept credentials);
 *  - it never decides the destination. It reports [LoginUiState.signedIn] and
 *    lets the shell route from the server-verified session.
 */
@HiltViewModel
class LoginViewModel @Inject constructor(
  private val session: SessionController,
) : ViewModel() {

  private val _state = MutableStateFlow(LoginUiState())
  val state: StateFlow<LoginUiState> = _state.asStateFlow()

  fun onIdentifierChange(value: String) {
    _state.update { it.copy(identifier = value, fieldErrors = it.fieldErrors - FIELD_IDENTIFIER, formError = null) }
  }

  fun onPasswordChange(value: String) {
    _state.update { it.copy(password = value, fieldErrors = it.fieldErrors - FIELD_PASSWORD, formError = null) }
  }

  fun submit() {
    // Guards against a double tap producing two sign-in attempts: the second
    // call is dropped while the first is in flight.
    if (_state.value.submitting) return

    val current = _state.value
    val identifierError = AuthValidation.validateIdentifier(current.identifier)
    val passwordError = AuthValidation.validatePassword(current.password)
    val fieldErrors = buildMap {
      identifierError?.let { put(FIELD_IDENTIFIER, it) }
      passwordError?.let { put(FIELD_PASSWORD, it) }
    }
    if (fieldErrors.isNotEmpty()) {
      _state.update { it.copy(fieldErrors = fieldErrors) }
      return
    }

    _state.update { it.copy(submitting = true, formError = null, fieldErrors = emptyMap()) }

    viewModelScope.launch {
      val result = session.signIn(
        identifier = current.identifier.trim(),
        password = current.password,
      )

      when (result) {
        is SessionState.Authenticated ->
          // Drop the password from this state as soon as it is no longer
          // needed: there is no reason to keep it in memory once the server
          // has accepted it.
          _state.update { it.copy(submitting = false, signedIn = true, password = "") }

        is SessionState.SignedOut -> _state.update {
          it.copy(
            submitting = false,
            formError = messageForGate(result.reason),
          )
        }

        is SessionState.Unavailable -> _state.update {
          it.copy(submitting = false, formError = result.message)
        }

        SessionState.Restoring -> _state.update { it.copy(submitting = false) }
      }
    }
  }

  /**
   * A gate reached during sign-in is shown as form-level copy rather than a
   * generic error: "your shop is awaiting approval" is information, not a
   * failure, and must not read as "try again".
   */
  private fun messageForGate(reason: SignOutReason): String = when (reason) {
    SignOutReason.PENDING_APPROVAL -> "Your sign-in worked — the shop is awaiting approval."
    SignOutReason.ACCESS_EXPIRED -> "Your access period has ended. Contact Maharani Traders to renew it."
    SignOutReason.ACCOUNT_SUSPENDED -> "This account is suspended. Please contact Maharani Traders."
    SignOutReason.ACCOUNT_INACTIVE -> "This account is not active. Please contact Maharani Traders."
    SignOutReason.UNSUPPORTED_ACCOUNT -> "This app version cannot open your account. Please update the app."
    SignOutReason.SESSION_EXPIRED -> "Your session expired. Please sign in again."
    SignOutReason.NEVER_SIGNED_IN, SignOutReason.SIGNED_OUT -> "Please sign in again."
  }

  companion object {
    const val FIELD_IDENTIFIER = "identifier"
    const val FIELD_PASSWORD = "password"
  }
}
