import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import type { z } from 'zod';

/**
 * HTTP conventions for the versioned mobile API (`/api/mobile/v1`).
 *
 * Every response — success or failure — carries a request id, and every
 * failure uses ONE envelope shape so the Android client has a single error
 * path to implement:
 *
 *   { "error": { "code": "...", "message": "...", "details": { ... } }, "requestId": "..." }
 *
 * `message` is end-user safe: this module is the only place that turns a
 * server-side cause into client-visible text, and it never forwards SQL,
 * driver messages, hostnames or Supabase internals. Real causes are logged
 * server-side against the request id.
 *
 * Contract: docs/NATIVE_ANDROID_API_CONTRACT.md (§1.2–§1.4).
 */

export const MOBILE_API_VERSION = 'v1';

/** Bodies above this size are rejected before parsing (contract §1.2). */
export const MAX_BODY_BYTES = 32 * 1024;

export const REQUEST_ID_HEADER = 'X-Request-Id';

export type MobileErrorCode =
  // 400
  | 'invalid_json'
  | 'invalid_request'
  | 'validation_failed'
  // 401
  | 'missing_token'
  | 'invalid_token'
  | 'expired_token'
  | 'invalid_credentials'
  | 'email_not_confirmed'
  // 403
  | 'forbidden'
  | 'account_inactive'
  | 'account_suspended'
  | 'retailer_pending_approval'
  | 'access_expired'
  // 404 / 405 / 409 / 413 / 422
  | 'not_found'
  | 'method_not_allowed'
  | 'idempotency_conflict'
  | 'conflict'
  | 'payload_too_large'
  | 'insufficient_stock'
  | 'warehouse_configuration_error'
  | 'coupon_invalid'
  | 'minimum_order_quantity'
  // 429 / 5xx
  | 'rate_limited'
  | 'internal_error'
  | 'database_unavailable';

export type MobileErrorDetails = Record<string, unknown>;

export interface MobileErrorBody {
  error: { code: MobileErrorCode; message: string; details?: MobileErrorDetails };
  requestId: string;
}

/** Fresh correlation id for one request. */
export function newRequestId(): string {
  return randomUUID();
}

function withRequestId(response: NextResponse, requestId: string): NextResponse {
  response.headers.set(REQUEST_ID_HEADER, requestId);
  return response;
}

/** `200`-style success envelope: `{ data, requestId }`. */
export function jsonOk<T>(data: T, init?: { status?: number; requestId?: string }): NextResponse {
  const requestId = init?.requestId ?? newRequestId();
  const response = NextResponse.json(
    { data, requestId },
    { status: init?.status ?? 200 }
  );
  return withRequestId(response, requestId);
}

/**
 * Collection success envelope (contract §1.3):
 *
 *   { "data": [ … ], "page": { nextCursor, hasMore, limit }, "requestId": "…" }
 *
 * `page` sits beside `data`, not inside it, so a client can read pagination
 * without unwrapping the payload — and so a single-object and a collection
 * response stay distinguishable by shape alone.
 *
 * `meta` carries optional, additive list facts (an exact result count, whether
 * a bounded working set capped the list). It is never required to render.
 */
export function jsonOkPage<T>(
  data: T[],
  page: { nextCursor: string | null; hasMore: boolean; limit: number },
  init?: { requestId?: string; meta?: Record<string, unknown> }
): NextResponse {
  const requestId = init?.requestId ?? newRequestId();
  const body: Record<string, unknown> = { data, page, requestId };
  if (init?.meta) body.meta = init.meta;
  return withRequestId(NextResponse.json(body, { status: 200 }), requestId);
}

/** Failure envelope. `message` must already be end-user safe. */
export function jsonError(
  code: MobileErrorCode,
  message: string,
  init: { status: number; details?: MobileErrorDetails; requestId?: string }
): NextResponse {
  const requestId = init.requestId ?? newRequestId();
  const body: MobileErrorBody = { error: { code, message }, requestId };
  if (init.details) body.error.details = init.details;
  return withRequestId(NextResponse.json(body, { status: init.status }), requestId);
}

/**
 * Sanitized server-side logging: full cause server-side, request id only
 * client-side. Never log tokens or request bodies here.
 */
export function logServerError(scope: string, requestId: string, cause: unknown): void {
  const detail = cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause);
  console.error(`[mobile-api:${scope}] requestId=${requestId} ${detail}`);
}

export type ParsedBody<T> = { ok: true; data: T } | { ok: false; response: NextResponse };

/**
 * Parse + validate a JSON body against a zod schema.
 *
 * Order matters: size → JSON syntax → schema, so a hostile payload is rejected
 * before it can be interpreted, and field errors are returned in a shape the
 * app can attach to inputs (`details.fields`).
 */
export async function parseJsonBody<T>(
  request: Request,
  schema: z.ZodType<T>,
  requestId: string = newRequestId()
): Promise<ParsedBody<T>> {
  const raw = await request.text();

  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) {
    return {
      ok: false,
      response: jsonError('payload_too_large', 'This request is too large.', {
        status: 413,
        requestId,
      }),
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw || '{}');
  } catch {
    return {
      ok: false,
      response: jsonError('invalid_json', 'The request body is not valid JSON.', {
        status: 400,
        requestId,
      }),
    };
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    const fields: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const key = issue.path.length > 0 ? issue.path.join('.') : 'body';
      if (!fields[key]) fields[key] = issue.message;
    }
    return {
      ok: false,
      response: jsonError('validation_failed', 'Please check the highlighted fields.', {
        status: 400,
        details: { fields },
        requestId,
      }),
    };
  }

  return { ok: true, data: result.data };
}

/** Standard 405 for a method a route does not implement. */
export function methodNotAllowed(allowed: string[], requestId?: string): NextResponse {
  const response = jsonError('method_not_allowed', 'This method is not supported here.', {
    status: 405,
    requestId,
  });
  response.headers.set('Allow', allowed.join(', '));
  return response;
}
