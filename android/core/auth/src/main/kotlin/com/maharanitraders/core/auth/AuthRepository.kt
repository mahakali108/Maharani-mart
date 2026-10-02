package com.maharanitraders.core.auth

import com.maharanitraders.core.common.AppError
import com.maharanitraders.core.common.AppResult
import com.maharanitraders.core.common.TimeSource
import com.maharanitraders.core.model.SessionTokens
import com.maharanitraders.core.network.ApiCallExecutor
import com.maharanitraders.core.network.MaharaniApi
import com.maharanitraders.core.network.dto.AuthSessionDto
import com.maharanitraders.core.network.dto.LoginRequestDto
import com.maharanitraders.core.network.dto.PasswordResetRequestDto
import com.maharanitraders.core.network.dto.PasswordUpdateRequestDto
import com.maharanitraders.core.network.dto.RefreshRequestDto
import com.maharanitraders.core.network.dto.RefreshSessionDto
import com.maharanitraders.core.network.dto.RegisterRetailerRequestDto
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Where a successfully authenticated account must go next.
 *
 * Mirrors the server's `nextStep` verbatim. The two non-`APP` values mean "signed
 * in, but this account cannot use the business features yet" — and they are the
 * ONLY reason a session is returned for them.
 */
enum class AuthNextStep {
  APP,
  PENDING_APPROVAL,
  ACCESS_EXPIRED,
  ;

  companion object {
    fun fromWire(value: String?): AuthNextStep = when (value?.trim()?.lowercase()) {
      AuthSessionDto.NEXT_STEP_PENDING_APPROVAL -> PENDING_APPROVAL
      AuthSessionDto.NEXT_STEP_ACCESS_EXPIRED -> ACCESS_EXPIRED
      // Unknown or absent means the ordinary path. This is only a screen
      // choice — the server re-checks entitlement on every call regardless.
      else -> APP
    }
  }
}

/** A successful sign-in: stored tokens plus the screen the app should show. */
data class AuthSession(
  val tokens: SessionTokens,
  val nextStep: AuthNextStep,
)

/** A successful registration. Always pending approval, by database design. */
data class RegistrationOutcome(
  val requiresEmailConfirmation: Boolean,
  val tokens: SessionTokens?,
)

/**
 * The app's only door to the auth endpoints.
 *
 * Responsibilities kept deliberately narrow:
 *  - call the API and translate the wire shapes into domain values;
 *  - turn a missing provider expiry into a documented, safe assumption;
 *  - never decide entitlement — [AuthNextStep] is copied from the server.
 *
 * It does NOT own session state; [SessionManager] does. That keeps exactly one
 * in-memory token holder in the process.
 */
@Singleton
class AuthRepository @Inject constructor(
  private val api: MaharaniApi,
  private val executor: ApiCallExecutor,
  private val timeSource: TimeSource,
) {

  suspend fun login(identifier: String, password: String): AppResult<AuthSession> =
    executor.executeEnvelope { api.login(LoginRequestDto(identifier = identifier, password = password)) }
      .map { dto ->
        AuthSession(
          tokens = tokensOf(dto.accessToken, dto.refreshToken, dto.expiresAt),
          nextStep = AuthNextStep.fromWire(dto.nextStep),
        )
      }

  /**
   * Refresh tokens.
   *
   * A failure here is terminal for the session: the caller signs the user out
   * rather than retrying a token the server has already rejected.
   */
  suspend fun refresh(refreshToken: String): AppResult<SessionTokens> =
    executor.executeEnvelope { api.refresh(RefreshRequestDto(refreshToken = refreshToken)) }
      .map { dto -> tokensOf(dto.accessToken, dto.refreshToken, dto.expiresAt) }

  /**
   * Server-side revocation of the caller's refresh token.
   *
   * The bearer header comes from the interceptor, so this must be called while
   * the session is still active. Its result is advisory: the local session is
   * wiped regardless, because a failed revocation must never trap a user in the
   * app.
   */
  suspend fun revokeSession(): AppResult<Unit> =
    executor.executeEnvelope { api.logout() }.map { Unit }

  suspend fun requestPasswordReset(email: String): AppResult<Unit> =
    executor.executeEnvelope { api.requestPasswordReset(PasswordResetRequestDto(email = email)) }
      .map { Unit }

  suspend fun updatePassword(password: String, confirmPassword: String): AppResult<Unit> =
    executor.executeEnvelope {
      api.updatePassword(PasswordUpdateRequestDto(password = password, confirmPassword = confirmPassword))
    }.map { Unit }

  suspend fun registerRetailer(
    fullName: String,
    shopName: String,
    phone: String,
    email: String,
    areaId: String,
    address: String,
    password: String,
  ): AppResult<RegistrationOutcome> =
    executor.executeEnvelope {
      api.registerRetailer(
        RegisterRetailerRequestDto(
          fullName = fullName,
          shopName = shopName,
          phone = phone,
          email = email,
          areaId = areaId,
          address = address,
          password = password,
        )
      )
    }.map { dto ->
      RegistrationOutcome(
        requiresEmailConfirmation = dto.requiresEmailConfirmation,
        tokens = dto.session?.let { tokensOf(it.accessToken, it.refreshToken, it.expiresAt) },
      )
    }
}

/**
 * Convert a wire session to stored tokens.
 *
 * `expiresAt` is optional on the wire. When GoTrue omits it, the lifetime is
 * assumed to be [ASSUMED_TOKEN_LIFETIME_SECONDS] (GoTrue's own default) so the
 * app still has a refresh schedule. This is an assumption about *timing only*:
 * the server verifies every token on every request, so a wrong guess causes an
 * early refresh (harmless) or a late one the server rejects with
 * `invalid_token` (which signs the user out). It never grants access.
 */
private fun tokensOf(accessToken: String, refreshToken: String, expiresAt: Long?): SessionTokens =
  SessionTokens(
    accessToken = accessToken,
    refreshToken = refreshToken,
    expiresAtEpochSeconds = expiresAt
      ?: (timeSource.nowEpochSeconds() + ASSUMED_TOKEN_LIFETIME_SECONDS),
  )

private const val ASSUMED_TOKEN_LIFETIME_SECONDS = 3600L
