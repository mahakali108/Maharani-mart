import 'server-only';

import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getStorage, type Storage } from 'firebase-admin/storage';
import { FIREBASE_NOT_CONFIGURED, readFirebaseAdminConfig } from '@/lib/storage/firebase/env';

let storageSingleton: Storage | null = null;

export function getFirebaseAdminStorage(): Storage {
  const config = readFirebaseAdminConfig();
  if (!config) {
    throw new Error(FIREBASE_NOT_CONFIGURED);
  }

  if (!getApps().length) {
    initializeApp({
      credential: cert({
        projectId: config.projectId,
        clientEmail: config.clientEmail,
        privateKey: config.privateKey,
      }),
      storageBucket: config.storageBucket,
    });
  }

  if (!storageSingleton) {
    storageSingleton = getStorage();
  }
  return storageSingleton;
}

export function getFirebaseBucket() {
  const config = readFirebaseAdminConfig();
  if (!config) {
    throw new Error(FIREBASE_NOT_CONFIGURED);
  }
  return getFirebaseAdminStorage().bucket(config.storageBucket);
}

export function firebaseAdminBucketName(): string {
  const config = readFirebaseAdminConfig();
  if (!config) {
    throw new Error(FIREBASE_NOT_CONFIGURED);
  }
  return config.storageBucket;
}
