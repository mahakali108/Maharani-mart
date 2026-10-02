package com.maharanitraders.core.auth

import com.maharanitraders.core.common.AppError

/**
 * A retailer registration submission.
 *
 * There is deliberately NO `role` field: the server's `handle_new_user()`
 * trigger always creates a pending RETAILER for a public sign-up and ignores any
 * metadata role (migration 0052). A client that could ask for a role would be
 * asking for something the database refuses — so the field does not exist here
 * either, which makes self-elevation unrepresentable rather than merely blocked.
 */
data class RegistrationRequest(
  val fullName: String,
  val shopName: String,
  val phone: String,
  val email: String,
  val areaId: String,
  val address: String,
  val password: String,
)

/**
 * Outcome of a registration attempt.
 *
 * [Registered] is not a sign-in: the shop exists but is awaiting approval, so the
 * app moves to the pending-approval screen. [requiresEmailConfirmation] means the
 * Supabase project has "Confirm email" enabled and the user must click the link
 * before their first sign-in — the account row already exists either way, so the
 * app must not imply the registration was lost.
 */
sealed interface RegistrationResult {

  data class Registered(val requiresEmailConfirmation: Boolean) : RegistrationResult

  data class Failed(val error: AppError) : RegistrationResult
}
