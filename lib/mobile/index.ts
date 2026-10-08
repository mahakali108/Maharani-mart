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
  jsonOkPage,
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

// Phase D — catalogue. `catalog.ts` is isomorphic and secret-free (query
// parsing + wire shaping); `catalog-service.ts` is server-only and is the only
// part that touches the database.
export {
  MOBILE_AVAILABILITY,
  DEFAULT_MOBILE_CATALOG_FILTERS,
  isUuidLike,
  parseCatalogQuery,
  toMobileCatalogProduct,
  toMobileCatalogProducts,
  toMobileCategories,
  toMobileBrands,
  toMobileBanners,
  toMobileHomeSchemes,
} from '@/lib/mobile/catalog';
export type {
  MobileAvailability,
  MobileCatalogFilters,
  MobileCatalogProduct,
  MobileCatalogPack,
  MobileCatalogCategory,
  MobileCatalogBrand,
  MobileBanner,
  MobileHomeScheme,
  MobileSchemeRow,
  MobilePriceTier,
  ParsedCatalogQuery,
} from '@/lib/mobile/catalog';

// Cross-entity search suggestions (products, pack barcodes, brands, categories).
// `search-service.ts` is server-only: it reads through the caller's RLS client.
export {
  MOBILE_SEARCH_MIN_TERM,
  MOBILE_SEARCH_PRODUCT_LIMIT,
  MOBILE_SEARCH_BRAND_LIMIT,
  MOBILE_SEARCH_CATEGORY_LIMIT,
} from '@/lib/mobile/search-service';
export type {
  MobileSearchMatchKind,
  MobileSearchProduct,
  MobileSearchBrand,
  MobileSearchCategory,
  MobileSearchSuggestions,
} from '@/lib/mobile/search-service';

// Phase C — authentication. The GoTrue-facing clients live in
// `clients.ts` rather than in `supabase.ts`, which stays strictly
// user-scoped (see that module's doc comment).
export {
  createMobileAnonClient,
  createMobileServiceRoleClient,
  gotrueFetch,
} from '@/lib/mobile/clients';
export {
  loginSchema,
  refreshSchema,
  passwordResetSchema,
  passwordUpdateSchema,
  registerRetailerSchema,
  evaluateAccountState,
  resolveIdentifier,
  isEmailIdentifier,
  toSessionTokens,
} from '@/lib/mobile/auth-api';
export type {
  MobileAccountUser,
  MobileLoginPayload,
  MobileNextStep,
  MobileRetailerSummary,
  MobileSessionTokens,
} from '@/lib/mobile/auth-api';
