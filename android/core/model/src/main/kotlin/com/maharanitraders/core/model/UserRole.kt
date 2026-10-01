package com.maharanitraders.core.model

/**
 * User roles as defined by the server (`lib/auth/roles.ts`).
 *
 * The Android app NEVER decides what a role may do — it renders the permissions
 * the server sends (`NavigationPolicy`), and every protected API call is
 * re-checked server-side. This enum exists so the app can route and label
 * screens, not to authorize anything.
 *
 * [fromWire] returns `null` for an unknown value on purpose: a value this build
 * does not understand must never fall back to a privileged role.
 */
enum class UserRole(val wireValue: String) {
  SUPER_ADMIN("super_admin"),
  ADMIN("admin"),
  STAFF("staff"),
  SALESMAN("salesman"),
  RETAILER("retailer");

  companion object {
    fun fromWire(value: String?): UserRole? {
      val wire = value?.trim()?.lowercase() ?: return null
      return entries.firstOrNull { it.wireValue == wire }
    }
  }
}
