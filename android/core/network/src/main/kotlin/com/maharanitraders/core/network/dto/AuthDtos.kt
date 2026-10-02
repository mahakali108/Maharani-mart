package com.maharanitraders.core.network.dto

import kotlinx.serialization.Serializable

/**
 * Wire models for `/api/mobile/v1/auth/…` and `/api/mobile/v1/retailers/register`
 * (contract §2.2).
 *
 * Same rules as [SessionDto]: transport shapes only, every optional field
 * defaulted, unknown keys ignored by the shared `Json`, and nothing here decides
 * what the app may do — the server does.
 */

@Serializable
data class LoginRequestDto(
  /** A 10-digit Indian mobile number (any common format) or an email address. */
  val identifier: String,
  val password: String,
)

@Serializable
data class RefreshRequestDto(
  val refreshToken: String,
)

/**
 * `POST /auth/login` and the session half of `POST /auth/refresh`.
 *
 * [nextStep] is `app`, `pending_approval` or `access_expired`. The two
 * non-`app` values still carry tokens — they let the app render the correct
 * state screen, and they unlock nothing: every business endpoint re-checks the
 * account server-side.
 */
@Serializable
data class AuthSessionDto(
  val accessToken: String,
  val refreshToken: String,
  /** Unix seconds from GoTrue; absent on the odd provider response. */
  val expiresAt: Long? = null,
  val tokenType: String = "bearer",
  val nextStep: String = NEXT_STEP_APP,
  val user: SessionUserDto? = null,
  val retailer: RetailerDto? = null,
) {
  companion object {
    const val NEXT_STEP_APP = "app"
    const val NEXT_STEP_PENDING_APPROVAL = "pending_approval"
    const val NEXT_STEP_ACCESS_EXPIRED = "access_expired"
  }
}

/** `POST /auth/refresh` returns tokens ONLY — never entitlement. */
@Serializable
data class RefreshSessionDto(
  val accessToken: String,
  val refreshToken: String,
  val expiresAt: Long? = null,
  val tokenType: String = "bearer",
)

@Serializable
data class RegisterRetailerRequestDto(
  val fullName: String,
  val shopName: String,
  val phone: String,
  val email: String,
  val areaId: String,
  val address: String,
  val password: String,
)

/**
 * `POST /retailers/register`.
 *
 * No `role` field exists, by design: the database trigger always creates a
 * pending RETAILER for a public sign-up and ignores any metadata role, so the
 * client has nothing to claim.
 */
@Serializable
data class RegisterRetailerResponseDto(
  val ok: Boolean = false,
  val requiresEmailConfirmation: Boolean = false,
  val nextStep: String = AuthSessionDto.NEXT_STEP_PENDING_APPROVAL,
  val session: RefreshSessionDto? = null,
)

@Serializable
data class PasswordResetRequestDto(
  val email: String,
)

@Serializable
data class PasswordUpdateRequestDto(
  val password: String,
  val confirmPassword: String,
)

/** Generic `{ ok, message? }` acknowledgement. */
@Serializable
data class AckDto(
  val ok: Boolean = false,
  val message: String? = null,
)

/** `GET /api/mobile/v1/areas` — active service areas for the address/registration picker. */
@Serializable
data class AreasDto(
  val areas: List<AreaDto> = emptyList(),
)

@Serializable
data class AreaDto(
  val id: String,
  val name: String,
  val district: String? = null,
)
