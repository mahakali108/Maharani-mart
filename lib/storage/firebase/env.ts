/**
 * Browser-safe Firebase values. These are designed to be public
 * (equivalent to a Firebase web app config). Never put the Admin
 * private key or a service-account JSON blob in NEXT_PUBLIC_* vars.
 */
export interface FirebasePublicConfig {
  apiKey: string | null;
  authDomain: string | null;
  projectId: string | null;
  storageBucket: string | null;
  messagingSenderId: string | null;
  appId: string | null;
}

export function getFirebasePublicConfig(): FirebasePublicConfig {
  return {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY?.trim() || null,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN?.trim() || null,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim() || null,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET?.trim() || null,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID?.trim() || null,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID?.trim() || null,
  };
}

export function isFirebasePublicConfigured(): boolean {
  return Boolean(getFirebasePublicConfig().storageBucket);
}

export interface FirebaseAdminConfig {
  projectId: string;
  clientEmail: string;
  privateKey: string;
  storageBucket: string;
}

export function readFirebaseAdminConfig(): FirebaseAdminConfig | null {
  const projectId =
    process.env.FIREBASE_ADMIN_PROJECT_ID?.trim() || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim() || '';
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL?.trim() || '';
  const rawKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY || '';
  const storageBucket =
    process.env.FIREBASE_ADMIN_STORAGE_BUCKET?.trim() || process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET?.trim() || '';

  if (!projectId || !clientEmail || !rawKey.trim() || !storageBucket) {
    return null;
  }

  return {
    projectId,
    clientEmail,
    privateKey: rawKey.replace(/\\n/g, '\n'),
    storageBucket,
  };
}

export function isFirebaseAdminConfigured(): boolean {
  return readFirebaseAdminConfig() !== null;
}

export const FIREBASE_NOT_CONFIGURED =
  'File storage is not configured. Set the Firebase Admin environment variables on the server.';
