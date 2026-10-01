package com.maharanitraders.core.network.dto

import kotlinx.serialization.Serializable

/**
 * Wire models for `/api/mobile/v1`.
 *
 * Shapes mirror `docs/NATIVE_ANDROID_API_CONTRACT.md` §1.3 exactly:
 *   success → `{ "data": ..., "requestId": "..." }`
 *   failure → `{ "error": { code, message, details? }, "requestId": "..." }`
 *
 * Every `data class` here is a transport detail: domain models live in
 * `core:model`, and the mapping between them is explicit (never automatic) so a
 * server-side change cannot silently alter app behaviour.
 *
 * Optional fields are defaulted, and the shared `Json` ignores unknown keys, so
 * an additive server change cannot crash an installed app.
 */

@Serializable
data class ApiEnvelope<T>(
  val data: T,
  val requestId: String? = null,
)

@Serializable
data class ApiErrorEnvelope(
  val error: ApiErrorDto,
  val requestId: String? = null,
)

@Serializable
data class ApiErrorDto(
  val code: String,
  val message: String,
  val details: ApiErrorDetailsDto? = null,
)

@Serializable
data class ApiErrorDetailsDto(
  /** Field-level validation messages (`validation_failed`). */
  val fields: Map<String, String>? = null,
  /** Available quantity for `insufficient_stock`. */
  val available: Int? = null,
  /** Required quantity for `minimum_order_quantity`. */
  val minQuantity: Int? = null,
)

@Serializable
data class HealthDto(
  val status: String,
  val database: String,
  val apiVersion: String? = null,
  val serverTime: String? = null,
  val latencyMs: Long? = null,
)

@Serializable
data class SessionDto(
  val user: SessionUserDto,
  val retailer: RetailerDto? = null,
  val access: AccessDto? = null,
  val navigation: NavigationDto = NavigationDto(),
)

@Serializable
data class SessionUserDto(
  val id: String,
  val email: String? = null,
  val role: String,
  val fullName: String? = null,
  val phone: String? = null,
  val isActive: Boolean = false,
)

@Serializable
data class RetailerDto(
  val status: String? = null,
  val shopName: String? = null,
)

@Serializable
data class AccessDto(
  val status: String? = null,
  val expiresAt: String? = null,
)

@Serializable
data class NavigationDto(
  val homeRoute: String = "",
  val workspaces: List<String> = emptyList(),
  val permissions: List<String> = emptyList(),
)
