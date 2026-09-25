/**
 * Firebase configuration — Phase 1 foundation (configuration only).
 *
 * This module is intentionally isomorphic and side-effect free:
 *
 *  - it never reads `process.env` itself — callers pass the environment they
 *    are allowed to read (see `lib/firebase/client.ts` for the browser-side
 *    public variables and `lib/firebase/admin.ts` for the server-only ones);
 *  - it never imports a Firebase SDK, so importing it costs nothing and can
 *    never pull `firebase-admin` into a browser bundle;
 *  - it never returns, logs or serialises a credential except through
 *    `readFirebaseAdminConfig()`, whose result is only ever consumed by the
 *    server-only Admin initialisation in `lib/firebase/admin.ts`.
 *
 * Firebase is a *future* backend. Supabase remains the primary backend for
 * authentication, RLS and all business data in Phase 1 (see ARCHITECTURE.md).
 */

/**
 * Public (browser) Firebase variables — inlined into client bundles by
 * Next.js, so these values are public by definition and must never hold a
 * secret. Values are configured in .env.local / the hosting environment.
 */
export const FIREBASE_CLIENT_ENV_VARS = [
  'NEXT_PUBLIC_FIREBASE_API_KEY',
  'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN',
  'NEXT_PUBLIC_FIREBASE_PROJECT_ID',
  'NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET',
  'NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
  'NEXT_PUBLIC_FIREBASE_APP_ID',
] as const;

export type FirebaseClientEnvVar = (typeof FIREBASE_CLIENT_ENV_VARS)[number];

/**
 * Server-only Firebase variables. These must only ever be read by
 * `lib/firebase/admin.ts` / `lib/firebase/auth-admin.ts` (`import 'server-only'`)
 * and must never be prefixed with `NEXT_PUBLIC_` or referenced by client code.
 */
export const FIREBASE_SERVER_ENV_VARS = [
  'FIREBASE_PROJECT_ID',
  'FIREBASE_CLIENT_EMAIL',
  'FIREBASE_PRIVATE_KEY',
] as const;

export type FirebaseServerEnvVar = (typeof FIREBASE_SERVER_ENV_VARS)[number];

/** Any env-like record (client configuration or server credentials). */
export type FirebaseEnvSource = Partial<Record<string, string | undefined>>;

/** Binary, non-sensitive configuration state — safe for health/status output. */
export type FirebaseConfigStatus = 'configured' | 'missing';

/** Public browser configuration required by the Firebase modular client SDK. */
export interface FirebaseClientConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
}

/** Server-only Admin SDK credentials (service account). Never serialise. */
export interface FirebaseAdminConfig {
  projectId: string;
  clientEmail: string;
  /** PEM private key with real newlines (see `normalizeFirebasePrivateKey`). */
  privateKey: string;
}

/**
 * Named app identifiers keep the two SDKs apart inside a single Next.js
 * process (a route handler and a browser tab both exist at runtime) and make
 * duplicate initialisation impossible.
 */
export const FIREBASE_CLIENT_APP_NAME = 'maharani-client';
export const FIREBASE_ADMIN_APP_NAME = 'maharani-admin';

function normalizeValue(value: string | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Normalises a `FIREBASE_PRIVATE_KEY` value into a PEM key with real
 * newlines.
 *
 * Hosting dashboards (.env files, Vercel, CI secret stores) have no concept of
 * a multi-line value, so the key is usually stored as a single line with
 * literal `\n` escapes. Depending on who pasted it the value may also arrive
 * as:
 *
 *  - a single line with `\n` escapes (the common case);
 *  - a single line with `\r\n` escapes;
 *  - a real multi-line value (Vercel, `vercel env pull`, docker);
 *  - a Windows-formatted value with real CRLF newlines;
 *  - any of the above wrapped in single or double quotes.
 *
 * Only the *shape* of the value is adjusted here. The result is never logged
 * and never thrown — invalid keys surface as "not configured" instead.
 */
export function normalizeFirebasePrivateKey(raw: string): string {
  let value = raw.trim();

  const isQuoted =
    value.length > 1 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")));

  if (isQuoted) value = value.slice(1, -1).trim();

  return value
    .replace(/\\r\\n/g, '\n') // literal "\r\n" written by an env dashboard
    .replace(/\\n/g, '\n') // literal "\n" written by an env dashboard / .env
    .replace(/\\r/g, '\n') // literal "\r" on its own
    .replace(/\r\n?/g, '\n') // real CRLF / CR from a Windows editor
    .trim();
}

/**
 * Cheap structural check that the value is a PEM private key. This keeps an
 * obviously broken value (an API key pasted into the wrong field, a truncated
 * paste) from being treated as "configured".
 */
export function isPemPrivateKey(value: string): boolean {
  return (
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(value) &&
    /-----END [A-Z ]*PRIVATE KEY-----/.test(value)
  );
}

/**
 * Validates the public browser configuration. Returns the validated config,
 * or `null` when any required value is absent — never throws, so a build or
 * request is never blocked by an intentionally unconfigured Firebase project.
 */
export function readFirebaseClientConfig(
  values: Partial<Record<FirebaseClientEnvVar, string | undefined>>
): FirebaseClientConfig | null {
  const apiKey = normalizeValue(values.NEXT_PUBLIC_FIREBASE_API_KEY);
  const authDomain = normalizeValue(values.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN);
  const projectId = normalizeValue(values.NEXT_PUBLIC_FIREBASE_PROJECT_ID);
  const storageBucket = normalizeValue(values.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET);
  const messagingSenderId = normalizeValue(values.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID);
  const appId = normalizeValue(values.NEXT_PUBLIC_FIREBASE_APP_ID);

  if (!apiKey || !authDomain || !projectId || !storageBucket || !messagingSenderId || !appId) {
    return null;
  }

  return { apiKey, authDomain, projectId, storageBucket, messagingSenderId, appId };
}

/**
 * Validates the server-only Admin credentials. Returns `null` when any value
 * is absent or when the private key is not a usable PEM key (after newline
 * normalisation) — callers therefore fail *closed* instead of initialising the
 * Admin SDK with garbage.
 *
 * The returned object contains the private key: only pass it straight into
 * `initializeApp({ credential: cert(...) })` on the server.
 */
export function readFirebaseAdminConfig(
  values: Partial<Record<FirebaseServerEnvVar, string | undefined>>
): FirebaseAdminConfig | null {
  const projectId = normalizeValue(values.FIREBASE_PROJECT_ID);
  const clientEmail = normalizeValue(values.FIREBASE_CLIENT_EMAIL);
  const rawPrivateKey = normalizeValue(values.FIREBASE_PRIVATE_KEY);

  if (!projectId || !clientEmail || !rawPrivateKey) return null;

  const privateKey = normalizeFirebasePrivateKey(rawPrivateKey);
  if (!isPemPrivateKey(privateKey)) return null;

  return { projectId, clientEmail, privateKey };
}

/** Names (never values) of the public variables that are still missing. */
export function missingFirebaseClientEnvVars(env: FirebaseEnvSource): FirebaseClientEnvVar[] {
  return FIREBASE_CLIENT_ENV_VARS.filter((name) => normalizeValue(env[name]) === null);
}

/** Names (never values) of the server variables that are still missing. */
export function missingFirebaseServerEnvVars(env: FirebaseEnvSource): FirebaseServerEnvVar[] {
  return FIREBASE_SERVER_ENV_VARS.filter((name) => normalizeValue(env[name]) === null);
}

/**
 * Status of the public browser configuration: `'configured' | 'missing'`.
 * Safe to expose (for example in /api/health) — no value is returned.
 */
export function firebaseClientConfigStatus(env: FirebaseEnvSource): FirebaseConfigStatus {
  return missingFirebaseClientEnvVars(env).length === 0 ? 'configured' : 'missing';
}

/**
 * Status of the server-only Admin configuration: `'configured' | 'missing'`.
 * Safe to expose (for example in /api/health) — no value, and in particular no
 * service-account email or private key, is returned.
 */
export function firebaseAdminConfigStatus(env: FirebaseEnvSource): FirebaseConfigStatus {
  const projectId = normalizeValue(env.FIREBASE_PROJECT_ID);
  const clientEmail = normalizeValue(env.FIREBASE_CLIENT_EMAIL);
  const rawPrivateKey = normalizeValue(env.FIREBASE_PRIVATE_KEY);

  if (!projectId || !clientEmail || !rawPrivateKey) return 'missing';

  return isPemPrivateKey(normalizeFirebasePrivateKey(rawPrivateKey)) ? 'configured' : 'missing';
}

/**
 * Combined, non-sensitive configuration summary used by /api/health. Deliberate
 * design constraints: this reads *presence* only, initialises no SDK, and makes
 * no network call to Firebase (so a health check never depends on Firebase
 * being reachable).
 */
export function firebaseConfigStatus(env: FirebaseEnvSource): {
  client: FirebaseConfigStatus;
  admin: FirebaseConfigStatus;
} {
  return {
    client: firebaseClientConfigStatus(env),
    admin: firebaseAdminConfigStatus(env),
  };
}
