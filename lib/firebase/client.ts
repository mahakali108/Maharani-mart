/**
 * Browser / client Firebase initialisation — Firebase modular SDK.
 *
 * Phase 1 foundation only: nothing in the app imports this module yet, so no
 * Firebase code is added to any bundle. It exists so Phase 2 can consume a
 * single, duplicate-safe client instance.
 *
 * Hard rules enforced here (audited by tests/firebase-foundation.test.ts):
 *  - reads ONLY the six `NEXT_PUBLIC_FIREBASE_*` variables;
 *  - never imports `firebase-admin` or a server-only module;
 *  - never touches a private/server variable (see lib/firebase/admin.ts for
 *    those, which is guarded by `import 'server-only'`);
 *  - no Firestore/Storage reads or writes — no data is created.
 */
import { getApps, initializeApp, type FirebaseApp, type FirebaseOptions } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';

import {
  FIREBASE_CLIENT_APP_NAME,
  FIREBASE_CLIENT_ENV_VARS,
  readFirebaseClientConfig,
  type FirebaseClientConfig,
} from './config';

/** Thrown when a client Firebase helper is used before configuration exists. */
export class FirebaseClientNotConfiguredError extends Error {
  constructor() {
    super(
      `Firebase client SDK is not configured. Set ${FIREBASE_CLIENT_ENV_VARS.join(', ')} ` +
        '(see .env.local.example). Supabase remains the primary backend until Phase 2.'
    );
    this.name = 'FirebaseClientNotConfiguredError';
  }
}

/**
 * Reads the public browser configuration.
 *
 * The six reads are written out as static `process.env.NEXT_PUBLIC_...`
 * expressions on purpose: Next.js inlines only static references into client
 * bundles. A dynamic lookup (`process.env[name]`) would not be replaced and
 * would silently evaluate to `undefined` in the browser.
 */
function readFirebaseClientEnv() {
  return {
    NEXT_PUBLIC_FIREBASE_API_KEY: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    NEXT_PUBLIC_FIREBASE_APP_ID: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  } as const;
}

/** Validated public configuration, or `null` when Firebase is not configured. */
export function getFirebaseClientConfig(): FirebaseClientConfig | null {
  return readFirebaseClientConfig(readFirebaseClientEnv());
}

/** `true` when all six public Firebase variables are present. */
export function isFirebaseClientConfigured(): boolean {
  return getFirebaseClientConfig() !== null;
}

function toFirebaseOptions(config: FirebaseClientConfig): FirebaseOptions {
  return {
    apiKey: config.apiKey,
    authDomain: config.authDomain,
    projectId: config.projectId,
    storageBucket: config.storageBucket,
    messagingSenderId: config.messagingSenderId,
    appId: config.appId,
  };
}

/**
 * Process-wide client app cache.
 *
 * Next.js dev-mode hot reload and webpack code splitting can evaluate this
 * module more than once, which would otherwise call `initializeApp()` again and
 * throw "Firebase App named 'maharani-client' already exists". Keying the
 * instance off `globalThis` survives module re-evaluation, and the SDK's own
 * `getApps()` registry is used as a second guard.
 */
type FirebaseClientGlobal = typeof globalThis & {
  __maharaniFirebaseClientApp?: FirebaseApp;
};

function clientGlobal(): FirebaseClientGlobal {
  return globalThis as FirebaseClientGlobal;
}

/**
 * The singleton browser Firebase app. Throws
 * `FirebaseClientNotConfiguredError` when the public variables are absent —
 * callers must opt in explicitly, Firebase is never initialised implicitly.
 */
export function getFirebaseClientApp(): FirebaseApp {
  const cached = clientGlobal().__maharaniFirebaseClientApp;
  if (cached) return cached;

  const existing = getApps().find((app) => app.name === FIREBASE_CLIENT_APP_NAME);
  if (existing) {
    clientGlobal().__maharaniFirebaseClientApp = existing;
    return existing;
  }

  const config = getFirebaseClientConfig();
  if (!config) throw new FirebaseClientNotConfiguredError();

  const app = initializeApp(toFirebaseOptions(config), FIREBASE_CLIENT_APP_NAME);
  clientGlobal().__maharaniFirebaseClientApp = app;
  return app;
}

/**
 * The singleton client Firebase Auth instance (lazy — the auth chunk is only
 * loaded when this is actually called).
 *
 * Phase 2 decides how Firebase Auth integrates with the existing Supabase
 * session flow. Supabase Auth, middleware.ts and the existing session cookies
 * are deliberately untouched in Phase 1.
 */
export function getFirebaseClientAuth(): Auth {
  return getAuth(getFirebaseClientApp());
}
