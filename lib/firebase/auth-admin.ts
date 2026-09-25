/**
 * Server-only Firebase Admin *Auth* helpers — Phase 1 foundation for Phase 2.
 *
 * Scope discipline (deliberate):
 *  - these helpers only wrap `firebase-admin/auth`; they do not decide any
 *    session architecture. Nothing here reads or writes cookies, nothing
 *    touches `next/headers`, `middleware.ts`, Supabase Auth, the existing
 *    Supabase session cookies or RLS;
 *  - nothing here writes to Firestore. ID tokens and session cookies are
 *    verified against Google's public signing keys, so verifying does not
 *    require Firestore (Phase 2 decides where any user profile lives);
 *  - no user record is created, imported or deleted in Phase 1.
 *
 * Phase 2 still has to decide: cookie name/attributes, where the cookie is set
 * and cleared, refresh strategy, and how (if at all) Firebase identities map to
 * the existing Supabase `profiles`/roles model.
 */
import 'server-only';

import { getAuth, type Auth, type DecodedIdToken } from 'firebase-admin/auth';

import { getFirebaseAdminApp } from './admin';

/** Firebase's documented minimum session-cookie lifetime (5 minutes). */
export const FIREBASE_SESSION_COOKIE_MIN_MS = 5 * 60 * 1000;

/** Firebase's documented maximum session-cookie lifetime (14 days). */
export const FIREBASE_SESSION_COOKIE_MAX_MS = 14 * 24 * 60 * 60 * 1000;

/** Default lifetime used by the official sample flow (5 days). */
export const FIREBASE_SESSION_COOKIE_DEFAULT_MS = 5 * 24 * 60 * 60 * 1000;

/**
 * The singleton Admin Auth instance, bound to the app created in
 * `lib/firebase/admin.ts` (so the Admin app is initialised exactly once).
 *
 * Throws `FirebaseAdminNotConfiguredError` when the server credentials are
 * absent — see `lib/firebase/admin.ts`.
 */
export function getFirebaseAdminAuth(): Auth {
  return getAuth(getFirebaseAdminApp());
}

/**
 * Verifies a Firebase ID token (the short-lived token a client obtains after
 * signing in) and returns its decoded claims.
 *
 * `checkRevoked: true` adds a backend lookup; leave it `false` for the common
 * per-request path.
 */
export async function verifyFirebaseIdToken(
  idToken: string,
  checkRevoked = false
): Promise<DecodedIdToken> {
  if (!idToken) throw new TypeError('verifyFirebaseIdToken requires a non-empty ID token.');
  return getFirebaseAdminAuth().verifyIdToken(idToken, checkRevoked);
}

/**
 * Exchanges a freshly issued ID token for a Firebase session cookie *value*.
 *
 * The cookie is only returned, never stored: setting it belongs to Phase 2's
 * session design, together with the cookie name/attributes and CSRF handling.
 * The lifetime is clamped to Firebase's documented 5-minute..14-day window so a
 * malformed argument cannot produce a cookie that can never be verified.
 */
export async function createFirebaseSessionCookie(
  idToken: string,
  expiresInMs: number = FIREBASE_SESSION_COOKIE_DEFAULT_MS
): Promise<string> {
  if (!idToken) throw new TypeError('createFirebaseSessionCookie requires a non-empty ID token.');
  if (
    !Number.isFinite(expiresInMs) ||
    expiresInMs < FIREBASE_SESSION_COOKIE_MIN_MS ||
    expiresInMs > FIREBASE_SESSION_COOKIE_MAX_MS
  ) {
    throw new RangeError(
      `Firebase session cookies must expire between ${FIREBASE_SESSION_COOKIE_MIN_MS} ms and ` +
        `${FIREBASE_SESSION_COOKIE_MAX_MS} ms.`
    );
  }

  return getFirebaseAdminAuth().createSessionCookie(idToken, { expiresIn: expiresInMs });
}

/**
 * Verifies a Firebase session cookie and returns its decoded claims.
 *
 * Phase 2 decides how the result is mapped onto the existing Supabase
 * role/profile model — this function must not be wired into middleware before
 * that decision, because the current middleware still relies on Supabase
 * session cookies and must keep doing so during the migration.
 */
export async function verifyFirebaseSessionCookie(
  sessionCookie: string,
  checkRevoked = false
): Promise<DecodedIdToken> {
  if (!sessionCookie) {
    throw new TypeError('verifyFirebaseSessionCookie requires a non-empty session cookie.');
  }
  return getFirebaseAdminAuth().verifySessionCookie(sessionCookie, checkRevoked);
}
