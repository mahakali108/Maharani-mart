package com.maharanitraders.feature.auth

/**
 * Client-side form validation.
 *
 * IMPORTANT: this exists for fast feedback only. Every rule here is re-checked
 * server-side (zod schemas in `lib/mobile/auth-api.ts`), and the server's answer
 * always wins — a form that validates locally can still be rejected, and the
 * message shown in that case is the server's own. Nothing in this file grants
 * access or decides what the account may do.
 */
object AuthValidation {

  private val EMAIL = Regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]{2,}$")

  /** Canonical Indian mobile: 10 digits, leading 6–9. */
  private val PHONE = Regex("^[6-9]\\d{9}$")

  /**
   * Normalize a typed phone number to canonical 10 digits, or `null` when it is
   * not a valid Indian mobile. Mirrors `normalizePhone` in the web app
   * (`lib/utils/phone.ts`) — the two must agree, or a number that works on the
   * website would fail in the app.
   *
   * Accepts: 9876543210, 09876543210, +91 98765 43210, 91-98765-43210, 091-…
   */
  fun normalizePhone(input: String): String? {
    val digits = input.filter { it.isDigit() }
    if (digits.isEmpty()) return null

    val normalized = when {
      digits.length == 10 -> digits
      digits.length == 11 && digits.startsWith("0") -> digits.substring(1)
      digits.length == 12 && digits.startsWith("91") -> digits.substring(2)
      digits.length == 13 && digits.startsWith("091") -> digits.substring(3)
      else -> return null
    }

    return if (PHONE.matches(normalized)) normalized else null
  }

  fun isEmail(input: String): Boolean = EMAIL.matches(input.trim())

  /** A sign-in identifier is an email or a phone number — never neither. */
  fun validateIdentifier(input: String): String? {
    val trimmed = input.trim()
    return when {
      trimmed.isEmpty() -> "Enter your mobile number or email."
      trimmed.contains('@') -> if (isEmail(trimmed)) null else "Enter a valid email address."
      normalizePhone(trimmed) != null -> null
      else -> "Enter a valid 10-digit Indian mobile number or email address."
    }
  }

  fun validatePassword(input: String): String? =
    if (input.isEmpty()) "Enter your password." else null

  // -------------------------------------------------------------------------
  // Registration
  // -------------------------------------------------------------------------

  fun validateFullName(input: String): String? =
    if (input.trim().length < 2) "Enter your full name." else null

  fun validateShopName(input: String): String? =
    if (input.trim().length < 2) "Enter your shop / firm name." else null

  fun validatePhone(input: String): String? =
    if (normalizePhone(input) == null) "Enter a valid 10-digit Indian mobile number." else null

  fun validateRegistrationEmail(input: String): String? =
    if (!isEmail(input)) "Enter a valid email address." else null

  fun validateAddress(input: String): String? =
    if (input.trim().length < 5) "Enter your shop address." else null

  fun validateNewPassword(input: String): String? =
    if (input.length < 8) "Password must be at least 8 characters." else null

  fun validateConfirmation(password: String, confirmation: String): String? =
    if (password != confirmation) "Passwords do not match." else null

  /**
   * A UUID is required by the database (`area_id uuid`). Checked here only to
   * avoid a pointless round trip; the server validates it again.
   */
  fun validateAreaId(input: String): String? =
    if (!UUID.matches(input.trim())) "Select your area." else null

  private val UUID =
    Regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
}
