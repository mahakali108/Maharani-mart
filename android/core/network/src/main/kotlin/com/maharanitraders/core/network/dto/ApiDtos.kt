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
  /** Present on collection responses only (contract §1.3). */
  val page: PageDto? = null,
  /** Optional, additive list facts. Never required to render a list. */
  val meta: ListMetaDto? = null,
)

/**
 * Pagination block of a collection response.
 *
 * [nextCursor] is OPAQUE: the client stores it and sends it back unchanged, and
 * must not try to read the ordering columns out of it. `null` means the list is
 * complete — which is the only end-of-list signal the app acts on.
 */
@Serializable
data class PageDto(
  val nextCursor: String? = null,
  val hasMore: Boolean = false,
  /** The batch size the SERVER used. Reported, not requested. */
  val limit: Int = 0,
)

@Serializable
data class ListMetaDto(
  /** Exact match count, known on the first batch only. */
  val resultCount: Int? = null,
  /** True when a bounded working set capped the list; the UI must say so. */
  val resultCapped: Boolean = false,
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

/**
 * `/api/mobile/v1/shell/badges` — the shell's two live counters.
 *
 * Counts only, by design: the endpoint exists so a badge is a server fact rather
 * than a number the device accumulates between screens, and so the shell never
 * has to download a cart or a notification feed to paint one digit.
 */
@Serializable
data class ShellBadgesDto(
  /** Saved cart LINES, exactly as the web retailer layout counts them. */
  val cartCount: Int = 0,
  /** Notifications the caller has not read. */
  val unreadNotificationCount: Int = 0,
)
