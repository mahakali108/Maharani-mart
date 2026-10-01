package com.maharanitraders.core.designsystem.labels

import com.maharanitraders.core.model.RetailerStatus
import com.maharanitraders.core.model.UserRole
import com.maharanitraders.core.model.Workspace

/**
 * Display copy for server-provided identifiers.
 *
 * Only *labels* live here — never identifiers, thresholds or business data. If
 * the server sends an unknown value, the label says so instead of guessing.
 */
fun UserRole.label(): String = when (this) {
  UserRole.SUPER_ADMIN -> "Super admin"
  UserRole.ADMIN -> "Administrator"
  UserRole.STAFF -> "Staff"
  UserRole.SALESMAN -> "Salesman"
  UserRole.RETAILER -> "Retailer"
}

fun Workspace.label(): String = when (this) {
  Workspace.ADMIN -> "Administration"
  Workspace.STAFF -> "Warehouse"
  Workspace.SALESMAN -> "Sales desk"
  Workspace.RETAILER -> "Retailer shop"
}

fun RetailerStatus.label(): String = when (this) {
  RetailerStatus.ACTIVE -> "Approved"
  RetailerStatus.PENDING_APPROVAL -> "Awaiting approval"
  RetailerStatus.SUSPENDED -> "Suspended"
  RetailerStatus.UNKNOWN -> "Status not recognised"
}
