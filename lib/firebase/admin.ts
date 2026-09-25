/**
 * Server-only Firebase Admin SDK initialisation.
 *
 * `import 'server-only'` is an explicit boundary: importing this module from a
 * Client Component (or any module that ends up in a browser bundle) fails the
 * build instead of leaking credentials.
 *
 * Hard rules enforced here (audited by tests/firebase-foundation.test.ts):
 *  - reads ONLY `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL` and
 *    `FIREBASE_PRIVATE_KEY` — never a `NEXT_PUBLIC_` variable;
 *  - never logs, returns or serialises the private key or service-account
 *    email to a client/API response (only `'configured' | 'missing'`);
 *  - initialises no Firestore/Storage and writes no data: Phase 1 is a
 *    foundation only, the Firebase backend stays completely empty;
 *  - Supabase remains the primary backend (auth, RLS, business data).
 *
 * Do not import this from a route handler unless the handler genuinely needs
 * the Admin SDK: /api/health deliberately uses the side-effect-free status
 * helpers in ./config instead.
 */
import 'server-only';

import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';

import {
  FIREBASE_ADMIN_APP_NAME,
  FIREBASE_SERVER_ENV_VARS,
  firebaseAdminConfigStatus,
  readFirebaseAdminConfig,
  type FirebaseAdminConfig,
  type FirebaseConfigStatus,
} from './config';

/**
 * Thrown when a server Firebase Admin helper is used before the server
 * variables exist. The message names the *variables* that are missing and
 * never contains a credential value.
 */
export class FirebaseAdminNotConfiguredError extends Error {
  constructor(missingOrInvalid: readonly string[] = FIREBASE_SERVER_ENV_VARS) {
    super(
      'Firebase Admin SDK is not configured. Missing or unusable server variables: ' +
        `${[...missingOrInvalid].join(', ')}. ` +
        'These are server-only (never NEXT_PUBLIC_*). See .env.local.example.'
    );
    this.name = 'FirebaseAdminNotConfiguredError';
  }
}

/**
 * Reads the three server-only variables. Kept inside a function (never at
 * module scope) so that importing this module cannot fail a build when the
 * credentials are intentionally absent, and so no value is captured in a
 * module-level constant that could be inspected or dumped.
 */
function readFirebaseAdminEnv() {
  return {
    FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID,
    FIREBASE_CLIENT_EMAIL: process.env.FIREBASE_CLIENT_EMAIL,
    FIREBASE_PRIVATE_KEY: process.env.FIREBASE_PRIVATE_KEY,
  } as const;
}

/** Validated Admin credentials, or `null` when unset/incomplete/invalid. */
function getAdminConfigOrNull(): FirebaseAdminConfig | null {
  return readFirebaseAdminConfig(readFirebaseAdminEnv());
}

/** `true` when all three server variables are present and usable. */
export function isFirebaseAdminConfigured(): boolean {
  return getAdminConfigOrNull() !== null;
}

/**
 * Non-sensitive status for operational tooling. Returns configuration
 * *presence* only — no credential, no service-account email, no key material.
 */
export function getFirebaseAdminConfigStatus(): FirebaseConfigStatus {
  return firebaseAdminConfigStatus(process.env);
}

/**
 * Process-wide Admin app cache (key: `__maharaniFirebaseAdminApp`).
 *
 * Guards against duplicate initialisation when Next.js dev-mode hot reload
 * re-evaluates this module. The Admin SDK's own `getApps()` registry is a
 * second guard: `initializeApp()` with an existing name would throw.
 */
type FirebaseAdminGlobal = typeof globalThis & {
  __maharaniFirebaseAdminApp?: App;
};

function adminGlobal(): FirebaseAdminGlobal {
  return globalThis as FirebaseAdminGlobal;
}

function findExistingAdminApp(): App | undefined {
  return getApps().find((app) => app.name === FIREBASE_ADMIN_APP_NAME);
}

/**
 * The singleton Admin app, initialised with an explicit service-account
 * credential (no Application Default Credentials / GOOGLE_APPLICATION_CREDENTIALS
 * fallback, so configuration is always explicit and auditable).
 *
 * Throws `FirebaseAdminNotConfiguredError` when the server variables are
 * absent or the private key is unusable — fail closed, never fall back to an
 * ambient credential. No network call is made by initialisation itself.
 */
export function getFirebaseAdminApp(): App {
  const cached = adminGlobal().__maharaniFirebaseAdminApp;
  if (cached) return cached;

  const existing = findExistingAdminApp();
  if (existing) {
    adminGlobal().__maharaniFirebaseAdminApp = existing;
    return existing;
  }

  const config = getAdminConfigOrNull();
  if (!config) {
    const missing = FIREBASE_SERVER_ENV_VARS.filter(
      (name) => !(process.env[name] ?? '').trim()
    );
    throw new FirebaseAdminNotConfiguredError(missing.length > 0 ? missing : FIREBASE_SERVER_ENV_VARS);
  }

  const app = initializeApp(
    {
      credential: cert({
        projectId: config.projectId,
        clientEmail: config.clientEmail,
        // `\\n` escapes are normalised before reaching this point so the SDK
        // always receives a real multi-line PEM key.
        privateKey: config.privateKey,
      }),
      projectId: config.projectId,
    },
    FIREBASE_ADMIN_APP_NAME
  );

  adminGlobal().__maharaniFirebaseAdminApp = app;
  return app;
}

/** Non-throwing variant for optional/passive server-side features. */
export function tryGetFirebaseAdminApp(): App | null {
  try {
    return getFirebaseAdminApp();
  } catch {
    return null;
  }
}
