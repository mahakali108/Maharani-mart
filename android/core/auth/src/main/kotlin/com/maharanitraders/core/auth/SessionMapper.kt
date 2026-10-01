package com.maharanitraders.core.auth

import com.maharanitraders.core.model.AccessContext
import com.maharanitraders.core.model.NavigationPolicy
import com.maharanitraders.core.model.RetailerContext
import com.maharanitraders.core.model.RetailerStatus
import com.maharanitraders.core.model.SessionSnapshot
import com.maharanitraders.core.model.SessionUser
import com.maharanitraders.core.model.UserRole
import com.maharanitraders.core.model.Workspace
import com.maharanitraders.core.network.dto.SessionDto
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Maps the verified session response onto domain models.
 *
 * Returns `null` — never a partially-filled object — when the payload cannot be
 * used safely:
 *  - a role this build does not know,
 *  - a missing/blank home route.
 *
 * The caller then shows an explicit "this build cannot open your account"
 * screen instead of guessing a destination. Workspaces the build does not know
 * are dropped from the navigation policy rather than mapped to something else;
 * permissions are kept verbatim, because the app must never invent or upgrade a
 * permission.
 */
@Singleton
class SessionMapper @Inject constructor() {

  fun toSnapshot(dto: SessionDto): SessionSnapshot? {
    val role = UserRole.fromWire(dto.user.role) ?: return null
    if (dto.user.id.isBlank()) return null

    val navigation = NavigationPolicy(
      homeRoute = dto.navigation.homeRoute,
      workspaces = dto.navigation.workspaces.mapNotNull { Workspace.fromId(it) }.distinct(),
      permissions = dto.navigation.permissions
        .map { it.trim() }
        .filter { it.isNotEmpty() }
        .toSet(),
    )
    if (!navigation.isUsable) return null

    return SessionSnapshot(
      user = SessionUser(
        id = dto.user.id,
        email = dto.user.email,
        role = role,
        fullName = dto.user.fullName,
        phone = dto.user.phone,
        isActive = dto.user.isActive,
      ),
      retailer = dto.retailer?.let { retailer ->
        RetailerContext(
          status = RetailerStatus.fromWire(retailer.status),
          shopName = retailer.shopName,
        )
      },
      access = dto.access?.let { access ->
        AccessContext(status = access.status ?: "unknown", expiresAtIso = access.expiresAt)
      },
      navigation = navigation,
    )
  }
}
