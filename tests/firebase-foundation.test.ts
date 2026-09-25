import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { deleteApp, getApps } from 'firebase/app';

import {
  FIREBASE_CLIENT_ENV_VARS,
  FIREBASE_SERVER_ENV_VARS,
  firebaseAdminConfigStatus,
  firebaseClientConfigStatus,
  firebaseConfigStatus,
  normalizeFirebasePrivateKey,
  readFirebaseAdminConfig,
  readFirebaseClientConfig,
} from '@/lib/firebase/config';
import {
  getFirebaseClientApp,
  getFirebaseClientConfig,
  isFirebaseClientConfigured,
} from '@/lib/firebase/client';
import {
  FirebaseAdminNotConfiguredError,
  getFirebaseAdminApp,
  getFirebaseAdminConfigStatus,
  isFirebaseAdminConfigured,
  tryGetFirebaseAdminApp,
} from '@/lib/firebase/admin';
import { getFirebaseAdminAuth } from '@/lib/firebase/auth-admin';

/**
 * In-memory stand-in for the Admin SDK's app registry. `firebase-admin` is
 * mocked because these tests must never contact a Firebase project, never
 * create an app from real credentials and never touch the network — what is
 * being asserted is initialisation behaviour (named, singleton, no duplicates),
 * which is exactly what the registry exposes.
 */
const adminSdk = vi.hoisted(() => {
  const apps: Array<{ name: string; options: unknown }> = [];
  const initializeAppCalls: Array<{ name: string; options: unknown }> = [];
  const certCalls: unknown[] = [];
  return {
    apps,
    initializeAppCalls,
    certCalls,
    reset() {
      apps.length = 0;
      initializeAppCalls.length = 0;
      certCalls.length = 0;
    },
  };
});

vi.mock('firebase-admin/app', () => ({
  initializeApp: (options: { credential?: unknown; projectId?: string }, name = '[DEFAULT]') => {
    const app = { name, options };
    adminSdk.apps.push(app);
    adminSdk.initializeAppCalls.push({ name, options });
    return app;
  },
  getApps: () => adminSdk.apps,
  cert: (serviceAccount: unknown) => {
    adminSdk.certCalls.push(serviceAccount);
    return { __credential: 'service-account', serviceAccount };
  },
}));

vi.mock('firebase-admin/auth', () => ({
  getAuth: (app: { name?: string } | undefined) => ({ __auth: true, app }),
}));

const root = join(__dirname, '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

/**
 * Comments are stripped before the source assertions below: a doc comment that
 * *mentions* a variable name is documentation, not a reference to the value,
 * and keeping them would only test the prose.
 */
function codeOnly(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** Whole-word match, so NEXT_PUBLIC_FIREBASE_PROJECT_ID never matches FIREBASE_PROJECT_ID. */
const word = (name: string) => new RegExp(`\\b${name}\\b`);

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.example', '.md'];
const IGNORED_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  '.next',
  'coverage',
  'android',
  'ios',
  'public',
  'resources',
  'www',
]);

function walk(directory: string): string[] {
  const files: string[] = [];

  for (const entry of readdirSync(join(root, directory))) {
    const file = join(directory, entry);
    if (statSync(join(root, file)).isDirectory()) {
      if (IGNORED_DIRECTORIES.has(entry)) continue;
      files.push(...walk(file));
      continue;
    }
    if (SOURCE_EXTENSIONS.some((extension) => entry.endsWith(extension))) files.push(file);
  }

  return files;
}

const CLIENT_ENV: Record<string, string> = {
  NEXT_PUBLIC_FIREBASE_API_KEY: 'test-api-key',
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: 'maharani-test.firebaseapp.com',
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'maharani-test',
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: 'maharani-test.appspot.com',
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: '1234567890',
  NEXT_PUBLIC_FIREBASE_APP_ID: '1:1234567890:web:abcdef',
};

/**
 * Fixture key material ONLY. A real service-account key body is ~1600 base64
 * characters; this one is 44, and the source scan below fails the suite if a
 * real-looking PEM key is ever committed to the repository.
 */
const FIXTURE_KEY_BODY = 'ZmFrZS1rZXktbWF0ZXJpYWwtbm90LWEtcmVhbC1rZXk=';
const pemFixture = (separator: string) =>
  ['-----BEGIN PRIVATE KEY-----', FIXTURE_KEY_BODY, '-----END PRIVATE KEY-----'].join(separator);

const ADMIN_ENV: Record<string, string> = {
  FIREBASE_PROJECT_ID: 'maharani-test',
  FIREBASE_CLIENT_EMAIL: 'firebase-adminsdk@maharani-test.iam.gserviceaccount.com',
  FIREBASE_PRIVATE_KEY: pemFixture('\\n'),
};

const MANAGED_ENV_VARS = [...FIREBASE_CLIENT_ENV_VARS, ...FIREBASE_SERVER_ENV_VARS];
const originalEnv = new Map<string, string | undefined>();

const CLIENT_APP_CACHE_KEY = '__maharaniFirebaseClientApp';
const ADMIN_APP_CACHE_KEY = '__maharaniFirebaseAdminApp';

const globals = () => globalThis as Record<string, unknown>;

function applyEnv(values: Record<string, string>) {
  for (const name of MANAGED_ENV_VARS) {
    const value = values[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

beforeEach(() => {
  for (const name of MANAGED_ENV_VARS) originalEnv.set(name, process.env[name]);
});

afterEach(() => {
  for (const [name, value] of originalEnv) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  originalEnv.clear();
});

describe('Firebase client configuration (public NEXT_PUBLIC_FIREBASE_* variables)', () => {
  it('reads and validates all six public variables', () => {
    expect(readFirebaseClientConfig(CLIENT_ENV)).toEqual({
      apiKey: 'test-api-key',
      authDomain: 'maharani-test.firebaseapp.com',
      projectId: 'maharani-test',
      storageBucket: 'maharani-test.appspot.com',
      messagingSenderId: '1234567890',
      appId: '1:1234567890:web:abcdef',
    });
  });

  it('is not configured when any single public variable is missing or blank', () => {
    for (const name of FIREBASE_CLIENT_ENV_VARS) {
      expect(readFirebaseClientConfig({ ...CLIENT_ENV, [name]: '   ' }), name).toBeNull();
      expect(firebaseClientConfigStatus({ ...CLIENT_ENV, [name]: '' }), name).toBe('missing');
    }
    expect(readFirebaseClientConfig({})).toBeNull();
  });

  it('client.ts reads every public variable statically (required for Next.js inlining)', () => {
    const source = read('lib/firebase/client.ts');
    for (const name of FIREBASE_CLIENT_ENV_VARS) {
      expect(source, name).toContain(`process.env.${name}`);
    }
    // A dynamic lookup would not be replaced by Next.js in the browser bundle.
    expect(codeOnly(source)).not.toMatch(/process\.env\[/);
  });

  it('reports "missing" (without throwing) until the public variables are set', () => {
    delete globals()[CLIENT_APP_CACHE_KEY];
    applyEnv({});

    expect(isFirebaseClientConfigured()).toBe(false);
    expect(getFirebaseClientConfig()).toBeNull();
    expect(firebaseClientConfigStatus(process.env)).toBe('missing');
    // Whether an app instance already exists depends on earlier tests in this
    // file; the configured-state assertions below are the meaningful part.
    if (getApps().every((app) => app.name !== 'maharani-client')) {
      expect(() => getFirebaseClientApp()).toThrow(/not configured/i);
    }

    applyEnv(CLIENT_ENV);
    expect(isFirebaseClientConfigured()).toBe(true);
    expect(getFirebaseClientConfig()?.projectId).toBe('maharani-test');
    expect(getFirebaseClientApp().options.projectId).toBe('maharani-test');
    delete globals()[CLIENT_APP_CACHE_KEY];
  });

  it('initialises the browser app once and survives hot reload (no duplicate app)', async () => {
    applyEnv(CLIENT_ENV);
    delete globals()[CLIENT_APP_CACHE_KEY];
    const alreadyInitialised = getApps().find((app) => app.name === 'maharani-client');
    if (alreadyInitialised) await deleteApp(alreadyInitialised);

    const first = getFirebaseClientApp();
    expect(first).toBe(getFirebaseClientApp());
    expect(first.name).toBe('maharani-client');
    expect(getApps().filter((app) => app.name === 'maharani-client')).toHaveLength(1);

    // Hot reload re-evaluates the module (cache dropped): the SDK registry must
    // be reused instead of calling initializeApp() a second time.
    delete globals()[CLIENT_APP_CACHE_KEY];
    expect(getFirebaseClientApp()).toBe(first);
    expect(getApps().filter((app) => app.name === 'maharani-client')).toHaveLength(1);

    await deleteApp(first);
    delete globals()[CLIENT_APP_CACHE_KEY];
  });
});

describe('Firebase Admin configuration (server-only variables)', () => {
  it('is behind an explicit server-only boundary', () => {
    for (const file of ['lib/firebase/admin.ts', 'lib/firebase/auth-admin.ts']) {
      expect(read(file), file).toMatch(/^import 'server-only';$/m);
      expect(read(file), file).toContain("firebase-admin/");
    }
  });

  it('reads the server variables and never a public one', () => {
    const source = read('lib/firebase/admin.ts');
    for (const name of FIREBASE_SERVER_ENV_VARS) {
      expect(source, name).toContain(`process.env.${name}`);
    }
    for (const file of ['lib/firebase/admin.ts', 'lib/firebase/auth-admin.ts']) {
      const code = codeOnly(read(file));
      expect(code, file).not.toMatch(/process\.env\.NEXT_PUBLIC_/);
      for (const name of FIREBASE_CLIENT_ENV_VARS) {
        expect(code, `${file} must not read ${name}`).not.toMatch(word(name));
      }
    }
  });

  it('config.ts centralises validation without touching process.env or an SDK', () => {
    const source = codeOnly(read('lib/firebase/config.ts'));
    expect(source).not.toMatch(/process\.env/);
    expect(source).not.toMatch(/from 'firebase/);
    expect(source).not.toMatch(/from 'firebase-admin/);
  });

  it('reports status from the server variables only', () => {
    applyEnv(CLIENT_ENV);
    expect(firebaseAdminConfigStatus(process.env)).toBe('missing');
    expect(isFirebaseAdminConfigured()).toBe(false);

    applyEnv(ADMIN_ENV);
    expect(firebaseAdminConfigStatus(process.env)).toBe('configured');
    expect(isFirebaseAdminConfigured()).toBe(true);
    expect(getFirebaseAdminConfigStatus()).toBe('configured');
    expect(readFirebaseAdminConfig(ADMIN_ENV)?.clientEmail).toBe(ADMIN_ENV.FIREBASE_CLIENT_EMAIL);
  });

  it('initialises one named Admin app and reuses it for Auth', () => {
    applyEnv(ADMIN_ENV);
    delete globals()[ADMIN_APP_CACHE_KEY];
    adminSdk.reset();

    const app = getFirebaseAdminApp();
    expect(app.name).toBe('maharani-admin');
    expect(getFirebaseAdminApp()).toBe(app);
    expect(getFirebaseAdminApp()).toBe(app);
    expect(adminSdk.initializeAppCalls).toHaveLength(1);
    expect(adminSdk.certCalls).toHaveLength(1);

    // The SDK always receives a real multi-line PEM key, never raw "\n" text.
    const credential = adminSdk.certCalls[0] as { privateKey: string; projectId: string };
    expect(credential.privateKey).toBe(pemFixture('\n'));
    expect(credential.projectId).toBe('maharani-test');

    const auth = getFirebaseAdminAuth() as unknown as { app?: { name?: string } };
    expect(auth.app?.name).toBe('maharani-admin');
    expect(adminSdk.initializeAppCalls).toHaveLength(1);
  });

  it('reuses an Admin app that another module instance already initialised', () => {
    applyEnv(ADMIN_ENV);
    adminSdk.reset();
    delete globals()[ADMIN_APP_CACHE_KEY];
    adminSdk.apps.push({ name: 'maharani-admin', options: {} });

    expect(getFirebaseAdminApp().name).toBe('maharani-admin');
    expect(adminSdk.initializeAppCalls).toHaveLength(0);
  });
});

describe('Admin credentials fail safely when unset', () => {
  beforeEach(() => {
    // Configuration is cached per process (and the SDK registry is mocked), so
    // every failure case starts from a genuinely unconfigured state.
    applyEnv({});
    adminSdk.reset();
    delete globals()[ADMIN_APP_CACHE_KEY];
  });

  it('reports "missing" instead of throwing during a frontend-only build/request', () => {
    expect(isFirebaseAdminConfigured()).toBe(false);
    expect(getFirebaseAdminConfigStatus()).toBe('missing');
    expect(firebaseConfigStatus(process.env)).toEqual({ client: 'missing', admin: 'missing' });
    expect(tryGetFirebaseAdminApp()).toBeNull();
  });

  it('throws a typed error naming the variables but leaking no value', () => {
    const secretSentinel = 'super-secret-private-key-value';
    process.env.FIREBASE_PROJECT_ID = 'maharani-test';
    process.env.FIREBASE_CLIENT_EMAIL = 'firebase-adminsdk@maharani-test.iam.gserviceaccount.com';
    process.env.FIREBASE_PRIVATE_KEY = secretSentinel;

    expect(() => getFirebaseAdminApp()).toThrowError(FirebaseAdminNotConfiguredError);
    expect(() => getFirebaseAdminAuth()).toThrowError(FirebaseAdminNotConfiguredError);

    try {
      getFirebaseAdminApp();
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain('FIREBASE_PRIVATE_KEY');
      expect(message).not.toContain(secretSentinel);
      expect(message).not.toContain('maharani-test.iam.gserviceaccount.com');
    }

    // A value that is present but is not a PEM key is treated as unusable, so
    // the SDK is never initialised with garbage.
    expect(firebaseAdminConfigStatus(process.env)).toBe('missing');
    expect(adminSdk.initializeAppCalls).toHaveLength(0);
  });

  it('requires all three server variables', () => {
    for (const name of FIREBASE_SERVER_ENV_VARS) {
      const partial = { ...ADMIN_ENV };
      delete partial[name];
      expect(readFirebaseAdminConfig(partial), name).toBeNull();
      expect(firebaseAdminConfigStatus(partial), name).toBe('missing');
    }
    expect(readFirebaseAdminConfig(ADMIN_ENV)?.privateKey).toBe(pemFixture('\n'));
  });
});

describe('FIREBASE_PRIVATE_KEY newline normalisation', () => {
  it('converts literal \\n escapes into real newlines', () => {
    const normalized = normalizeFirebasePrivateKey(pemFixture('\\n'));
    expect(normalized).toBe(pemFixture('\n'));
    expect(normalized.split('\n')).toHaveLength(3);
  });

  it('handles escaped CRLF, real CRLF, quoted and padded values', () => {
    const expected = pemFixture('\n');
    expect(normalizeFirebasePrivateKey(pemFixture('\\r\\n'))).toBe(expected);
    expect(normalizeFirebasePrivateKey(pemFixture('\r\n'))).toBe(expected);
    expect(normalizeFirebasePrivateKey(`"${pemFixture('\\n')}"`)).toBe(expected);
    expect(normalizeFirebasePrivateKey(`'${pemFixture('\\n')}'`)).toBe(expected);
    expect(normalizeFirebasePrivateKey(`  ${pemFixture('\\n')}  `)).toBe(expected);
    expect(normalizeFirebasePrivateKey(expected)).toBe(expected);
  });

  it('normalises the key as part of Admin config validation', () => {
    const config = readFirebaseAdminConfig({
      ...ADMIN_ENV,
      FIREBASE_PRIVATE_KEY: `"${pemFixture('\\n')}"`,
    });
    expect(config?.privateKey).toBe(pemFixture('\n'));
    expect(config?.privateKey).not.toContain('\\n');
  });
});

describe('Firebase foundation isolation (Phase 1 boundary)', () => {
  it('contains exactly the foundation modules — no repositories, adapters or data', () => {
    expect(readdirSync(join(root, 'lib/firebase')).sort()).toEqual([
      'admin.ts',
      'auth-admin.ts',
      'client.ts',
      'config.ts',
    ]);
  });

  it('creates no Firestore/Storage access and no data', () => {
    for (const file of walk('lib/firebase')) {
      const source = read(file);
      expect(source, file).not.toMatch(
        /firebase\/firestore|firebase-admin\/firestore|firebase\/storage|firebase-admin\/storage|getFirestore|getStorage|setDoc|addDoc|collection\(/
      );
    }
  });

  it('never references a server-only variable from client Firebase code', () => {
    const clientSource = codeOnly(read('lib/firebase/client.ts'));
    for (const name of FIREBASE_SERVER_ENV_VARS) {
      expect(clientSource, name).not.toMatch(word(name));
      expect(clientSource, name).not.toContain(`process.env.${name}`);
    }
    expect(clientSource).not.toMatch(/server-only|firebase-admin|SUPABASE_SERVICE_ROLE_KEY/);
  });

  it('is never imported by client components, browser modules or business code', () => {
    const scanned = [...walk('app'), ...walk('components'), ...walk('lib')].filter(
      (file) => !file.startsWith('lib/firebase')
    );
    expect(scanned.length).toBeGreaterThan(100);

    for (const file of scanned) {
      const source = codeOnly(read(file));
      expect(source, file).not.toMatch(/firebase-admin/);
      expect(source, file).not.toMatch(/@\/lib\/firebase\/(admin|auth-admin)/);
    }
  });

  it('hard-codes no credential material anywhere in the source tree', () => {
    const scanned = [
      ...walk('app'),
      ...walk('components'),
      ...walk('lib'),
      ...walk('tests'),
      ...walk('types'),
      ...walk('scripts'),
      '.env.local.example',
      'package.json',
      '.gitignore',
    ];
    expect(scanned.length).toBeGreaterThan(100);

    // Credential *filenames* are built by this suite on purpose (see the
    // .gitignore test), so that reference is not a committed credential.
    const selfReference = 'tests/firebase-foundation.test.ts';

    for (const file of scanned) {
      const source = read(file);

      if (file !== selfReference) {
        const adminsSdkJson = ['firebase', 'adminsdk', '[a-z0-9]+\\.json'].join('-');
        expect(source, file).not.toMatch(new RegExp(adminsSdkJson));
        expect(source, file).not.toMatch(/"type"\s*:\s*"service_account"/);
        expect(source, file).not.toMatch(/"private_key"\s*:\s*"-----BEGIN/);
      }

      const pemBlocks =
        source.match(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g) ??
        [];
      for (const block of pemBlocks) {
        const body = block.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '');
        // A real 2048-bit key body is ~1600 base64 characters; this suite only
        // contains the 44-character fixture.
        expect(body.length, `${file} contains a real-looking PEM key`).toBeLessThan(200);
      }
    }
  });

  it('reports Firebase status in /api/health without importing the Admin SDK', () => {
    const source = read('app/api/health/route.ts');
    expect(source).toContain('firebaseConfigStatus');
    expect(source).not.toMatch(/firebase-admin/);
    expect(source).not.toMatch(/privateKey|private_key|clientEmail|FIREBASE_PRIVATE_KEY/);
    // The Supabase health check stays authoritative.
    expect(source).toContain("from '@/lib/supabase/server'");
    expect(source).toContain("supabase.from('areas')");
  });

  it('keeps the Supabase auth stack, middleware and session cookies Firebase-free', () => {
    const authSource = read('lib/auth/actions.ts');
    expect(authSource).toContain('signInWithPassword');
    expect(authSource).not.toMatch(/firebase|appwrite|clerk|auth0|next-auth/i);

    for (const file of [
      'lib/supabase/client.ts',
      'lib/supabase/server.ts',
      'lib/supabase/middleware.ts',
      'middleware.ts',
    ]) {
      expect(read(file), file).not.toMatch(/firebase/i);
    }

    // Every non-Firebase module under lib/ is untouched as well.
    for (const file of walk('lib').filter((entry) => !entry.startsWith('lib/firebase'))) {
      expect(read(file), file).not.toMatch(/firebase/i);
    }
  });

  it('leaves the existing anti-Firebase auth guard test in place and unweakened', () => {
    const guard = read('tests/auth-login.test.ts');
    expect(guard).toContain('adds no Firebase / Appwrite / alternate auth provider');
    expect(guard).toContain(
      'expect(authSource).not.toMatch(/firebase|appwrite|clerk|auth0|next-auth/i)'
    );
    expect(guard).toContain('signInWithPassword');
  });

  it('declares the SDKs in package.json and keeps every Supabase dependency', () => {
    const pkg = JSON.parse(read('package.json')) as {
      dependencies: Record<string, string>;
    };
    expect(pkg.dependencies.firebase).toMatch(/^\^11\./);
    expect(pkg.dependencies['firebase-admin']).toMatch(/^\^13\./);
    expect(pkg.dependencies['@supabase/ssr']).toBeDefined();
    expect(pkg.dependencies['@supabase/supabase-js']).toBeDefined();
  });

  it('documents empty Firebase placeholders and keeps the Supabase examples', () => {
    const example = read('.env.local.example');

    for (const name of [
      'NEXT_PUBLIC_SUPABASE_URL=',
      'NEXT_PUBLIC_SUPABASE_ANON_KEY=',
      'SUPABASE_SERVICE_ROLE_KEY=',
      'WEBHOOK_SECRET=',
    ]) {
      expect(example, name).toContain(name);
    }

    for (const name of [
      ...FIREBASE_CLIENT_ENV_VARS,
      ...FIREBASE_SERVER_ENV_VARS,
      'SESSION_SECRET',
      'SUPER_ADMIN_EMAILS',
      'SEED_ADMIN_PASSWORD',
    ]) {
      expect(example, name).toMatch(new RegExp(`^${name}=$`, 'm'));
    }

    expect(example).not.toMatch(/NEXT_PUBLIC_FIREBASE_PRIVATE_KEY/);
  });

  it('keeps credentials out of git', () => {
    const ignore = read('.gitignore');
    expect(ignore).toMatch(/^\.env$/m);
    expect(ignore).toMatch(/^\.env\*\.local$/m);
    expect(ignore).toContain('*.pem');
    expect(ignore).toContain('*.key');
    expect(ignore).toContain('*firebase-adminsdk*.json');
    expect(ignore).toContain('*service-account*.json');
  });

  it('ignores credential files but keeps the env example tracked', () => {
    const ignored = (path: string) => {
      try {
        execFileSync('git', ['check-ignore', '-q', path], { cwd: root });
        return true;
      } catch {
        return false;
      }
    };

    // Filenames are assembled here on purpose: they are inputs to git
    // check-ignore, not committed credential files (see the scan above).
    const adminsSdkJson = ['maharani', 'firebase', 'adminsdk', 'abc123.json'].join('-');
    const serviceAccountJson = ['service', 'account.json'].join('-');

    expect(ignored('.env')).toBe(true);
    expect(ignored('.env.local')).toBe(true);
    expect(ignored('.env.production.local')).toBe(true);
    expect(ignored(adminsSdkJson)).toBe(true);
    expect(ignored(serviceAccountJson)).toBe(true);
    expect(ignored('private.key')).toBe(true);
    expect(ignored('.env.local.example')).toBe(false);
  });
});
