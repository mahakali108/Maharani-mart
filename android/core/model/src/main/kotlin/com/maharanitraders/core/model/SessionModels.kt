package com.maharanitraders.core.model

/**
 * Retailer approval state — the database enum's three values
 * (`types/database.types.ts`: `RetailerStatusEnum`). Any other wire value is
 * [UNKNOWN] rather than silently treated as active.
 */
enum class RetailerStatus(val wireValue: String) {
  PENDING_APPROVAL("pending_approval"),
  ACTIVE("active"),
  SUSPENDED("suspended"),
  UNKNOWN("unknown");

  companion object {
    fun fromWire(value: String?): RetailerStatus {
      val wire = value?.trim()?.lowercase() ?: return UNKNOWN
      return entries.firstOrNull { it.wireValue == wire } ?: UNKNOWN
    }
  }
}

/** Shop context for a retailer account (null for other roles). */
data class RetailerContext(
  val status: RetailerStatus,
  val shopName: String?,
)

/** Access-period state (`user_access_periods`); super admins have none. */
data class AccessContext(
  val status: String,
  val expiresAtIso: String?,
)

/** The authenticated user as the server describes them. */
data class SessionUser(
  val id: String,
  val email: String?,
  val role: UserRole,
  val fullName: String?,
  val phone: String?,
  val isActive: Boolean,
)

/**
 * A workspace the user may enter, mirroring the server's route prefixes
 * (`ROLE_ROUTE_PREFIXES`). Labels are UI copy and live in the design system.
 */
enum class Workspace(val id: String) {
  ADMIN("admin"),
  STAFF("staff"),
  SALESMAN("salesman"),
  RETAILER("retailer");

  companion object {
    fun fromId(value: String?): Workspace? = entries.firstOrNull { it.id == value?.trim() }
  }
}

/**
 * What the app is allowed to show, as REPORTED BY THE SERVER
 * (`GET /api/mobile/v1/session`). UX only — not a security boundary.
 */
data class NavigationPolicy(
  val homeRoute: String,
  val workspaces: List<Workspace>,
  val permissions: Set<String>,
) {
  fun can(permission: String): Boolean = permission in permissions

  fun canEnter(workspace: Workspace): Boolean = workspace in workspaces

  /**
   * A policy without a home route cannot be used for routing; the app must show
   * an error state instead of guessing a destination.
   */
  val isUsable: Boolean get() = homeRoute.isNotBlank()

  companion object {
    val EMPTY = NavigationPolicy(homeRoute = "", workspaces = emptyList(), permissions = emptySet())
  }
}

/** Everything the app needs about the signed-in user. */
data class SessionSnapshot(
  val user: SessionUser,
  val retailer: RetailerContext?,
  val access: AccessContext?,
  val navigation: NavigationPolicy,
) {
  val role: UserRole get() = user.role
}

/** Session tokens. Stored only in Keystore-backed encrypted storage. */
data class SessionTokens(
  val accessToken: String,
  val refreshToken: String,
  val expiresAtEpochSeconds: Long,
) {
  /**
   * Proactive-refresh window: treat the token as expired slightly early so a
   * request is not sent with a token that dies in flight.
   */
  fun isExpiredAt(nowEpochSeconds: Long, skewSeconds: Long = EXPIRY_SKEW_SECONDS): Boolean =
    expiresAtEpochSeconds - skewSeconds <= nowEpochSeconds

  companion object {
    const val EXPIRY_SKEW_SECONDS: Long = 120
  }
}
