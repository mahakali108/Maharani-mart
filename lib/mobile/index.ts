/**
 * Barrel for the mobile API foundation (`/api/mobile/v1`).
 *
 * Route handlers import from here so the conventions live in one place:
 * `docs/NATIVE_ANDROID_API_CONTRACT.md` §1 and §3.
 */
export {
  MOBILE_API_VERSION,
  MAX_BODY_BYTES,
  REQUEST_ID_HEADER,
  newRequestId,
  jsonOk,
  jsonError,
  logServerError,
  parseJsonBody,
  methodNotAllowed,
} from '@/lib/mobile/http';
export type { MobileErrorCode, MobileErrorBody, MobileErrorDetails, ParsedBody } from '@/lib/mobile/http';

export {
  MOBILE_ROLES,
  isKnownRole,
  bearerToken,
  tokenExpirySeconds,
  classifyTokenFailure,
  isAccessPeriodValid,
  failure,
  mobileFailureResponse,
  requireMobileRole,
  requireMobilePermission,
  requireMobileSession,
} from '@/lib/mobile/auth';
export type {
  MobileAuthFailure,
  MobileAuthFailureCode,
  MobileSession,
  MobileSessionResult,
  MobileRetailerContext,
  MobileAccessContext,
} from '@/lib/mobile/auth';

export {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  CATALOG_PAGE_SIZE,
  CATALOG_MAX_ROWS,
  parsePageParams,
  encodeCursor,
  decodeCursor,
  pageEnvelope,
} from '@/lib/mobile/pagination';
export type { PageParams, PageEnvelope } from '@/lib/mobile/pagination';

export {
  RATE_LIMITS,
  consumeRateLimit,
  resetRateLimits,
  clientKey,
  rateLimitResponse,
  enforceRateLimit,
} from '@/lib/mobile/rate-limit';
export type { RateLimitGroup, RateLimitResult, RateLimitRule } from '@/lib/mobile/rate-limit';
