package com.maharanitraders.core.model

/**
 * Machine-readable error codes from the mobile API
 * (`docs/NATIVE_ANDROID_API_CONTRACT.md` §1.4).
 *
 * The mapping is deliberately total: an unknown code becomes [UNKNOWN] with
 * `retryable = true`, so a newer server can add codes without crashing an older
 * app — and the app never turns an unrecognised error into success.
 */
enum class ApiErrorCode(
  val wireValue: String,
  val retryable: Boolean,
) {
  // 400
  INVALID_JSON("invalid_json", false),
  INVALID_REQUEST("invalid_request", false),
  VALIDATION_FAILED("validation_failed", false),
  PAYLOAD_TOO_LARGE("payload_too_large", false),

  // 401
  MISSING_TOKEN("missing_token", false),
  INVALID_TOKEN("invalid_token", false),
  EXPIRED_TOKEN("expired_token", false),
  INVALID_CREDENTIALS("invalid_credentials", false),
  EMAIL_NOT_CONFIRMED("email_not_confirmed", false),

  // 403
  FORBIDDEN("forbidden", false),
  ACCOUNT_INACTIVE("account_inactive", false),
  ACCOUNT_SUSPENDED("account_suspended", false),
  RETAILER_PENDING_APPROVAL("retailer_pending_approval", false),
  ACCESS_EXPIRED("access_expired", false),

  // 404 / 405 / 409
  NOT_FOUND("not_found", false),
  METHOD_NOT_ALLOWED("method_not_allowed", false),
  IDEMPOTENCY_CONFLICT("idempotency_conflict", false),
  CONFLICT("conflict", false),

  // 422
  INSUFFICIENT_STOCK("insufficient_stock", false),
  WAREHOUSE_CONFIGURATION_ERROR("warehouse_configuration_error", true),
  COUPON_INVALID("coupon_invalid", false),
  MINIMUM_ORDER_QUANTITY("minimum_order_quantity", false),

  // 429 / 5xx
  RATE_LIMITED("rate_limited", true),
  INTERNAL_ERROR("internal_error", true),
  DATABASE_UNAVAILABLE("database_unavailable", true),

  UNKNOWN("unknown", true);

  /** The token is gone: clear the session and send the user to sign-in. */
  val requiresSignIn: Boolean
    get() = this == MISSING_TOKEN || this == INVALID_TOKEN || this == EXPIRED_TOKEN

  /** An account-state gate the app must show instead of a generic error screen. */
  val gate: AccountGate?
    get() = when (this) {
      RETAILER_PENDING_APPROVAL -> AccountGate.PENDING_APPROVAL
      ACCOUNT_SUSPENDED -> AccountGate.SUSPENDED
      ACCOUNT_INACTIVE -> AccountGate.INACTIVE
      ACCESS_EXPIRED -> AccountGate.ACCESS_EXPIRED
      else -> null
    }

  companion object {
    fun fromWire(value: String?): ApiErrorCode {
      val wire = value?.trim()?.lowercase() ?: return UNKNOWN
      return entries.firstOrNull { it.wireValue == wire } ?: UNKNOWN
    }
  }
}

/** Account states that block usage and get their own screen. */
enum class AccountGate {
  PENDING_APPROVAL,
  SUSPENDED,
  INACTIVE,
  ACCESS_EXPIRED,
}
