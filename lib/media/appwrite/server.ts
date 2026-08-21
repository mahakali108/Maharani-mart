import 'server-only';

/**
 * Appwrite admin client — SERVER ONLY.
 *
 * The `server-only` import above makes it a build-time error for any Client
 * Component to pull this module (and therefore `APPWRITE_API_KEY`) into the
 * browser bundle. Appwrite is used exclusively for file storage; no Appwrite
 * Database, Auth or Function API is touched anywhere in this codebase.
 */

import { Client, Storage } from 'node-appwrite';

export interface AppwriteConfig {
  endpoint: string;
  projectId: string;
  apiKey: string;
  /** Bucket for public media (product images, banners, brand/category, avatars). */
  publicBucketId: string;
  /** Bucket for private media (retailer KYC documents). */
  privateBucketId: string;
}

let cachedClient: Client | null = null;
let cachedStorage: Storage | null = null;

function readEnv(name: string): string | null {
  const value = process.env[name];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/**
 * Resolve Appwrite configuration, or `null` when the deployment has not been
 * configured yet. Callers must handle `null` — a missing Appwrite config is a
 * clean "uploads unavailable" error, never a crash, and never affects reads of
 * media that already lives in Supabase Storage.
 */
export function getAppwriteConfig(): AppwriteConfig | null {
  const endpoint = readEnv('APPWRITE_ENDPOINT') ?? readEnv('NEXT_PUBLIC_APPWRITE_ENDPOINT');
  const projectId = readEnv('APPWRITE_PROJECT_ID') ?? readEnv('NEXT_PUBLIC_APPWRITE_PROJECT_ID');
  const apiKey = readEnv('APPWRITE_API_KEY');
  // Canonical name is APPWRITE_STORAGE_BUCKET_ID; APPWRITE_BUCKET_ID is the
  // legacy alias kept so existing deployments keep working. Set exactly ONE.
  const publicBucketId = readEnv('APPWRITE_STORAGE_BUCKET_ID') ?? readEnv('APPWRITE_BUCKET_ID');

  if (!endpoint || !projectId || !apiKey || !publicBucketId) return null;

  return {
    endpoint: endpoint.replace(/\/+$/, ''),
    projectId,
    apiKey,
    publicBucketId,
    // Falls back to the public bucket only if no private bucket is configured;
    // `isAppwriteFullyConfigured()` reports that as a deployment warning.
    privateBucketId: readEnv('APPWRITE_PRIVATE_BUCKET_ID') ?? publicBucketId,
  };
}

export function isAppwriteConfigured(): boolean {
  return getAppwriteConfig() !== null;
}

/**
 * True only when a *separate* private bucket exists for KYC documents.
 * Surfaced in docs/deploy checks so nobody accidentally ships confidential
 * paperwork into a publicly readable bucket.
 */
export function hasDedicatedPrivateBucket(): boolean {
  const config = getAppwriteConfig();
  if (!config) return false;
  return config.privateBucketId !== config.publicBucketId;
}

export function getAppwriteClient(): Client | null {
  const config = getAppwriteConfig();
  if (!config) return null;

  if (!cachedClient) {
    cachedClient = new Client()
      .setEndpoint(config.endpoint)
      .setProject(config.projectId)
      .setKey(config.apiKey);
  }
  return cachedClient;
}

export function getAppwriteStorage(): Storage | null {
  if (cachedStorage) return cachedStorage;
  const client = getAppwriteClient();
  if (!client) return null;
  cachedStorage = new Storage(client);
  return cachedStorage;
}

/** Bucket to use for a given media kind. Never caller-supplied. */
export function bucketFor(isPrivate: boolean): string | null {
  const config = getAppwriteConfig();
  if (!config) return null;
  return isPrivate ? config.privateBucketId : config.publicBucketId;
}

export const APPWRITE_NOT_CONFIGURED_ERROR =
  'File storage is not configured on this deployment. Set APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY and APPWRITE_STORAGE_BUCKET_ID.';

export interface AppwriteDiagnostics {
  /** True only when every required server variable is present. */
  configured: boolean;
  endpointConfigured: boolean;
  projectConfigured: boolean;
  apiKeyConfigured: boolean;
  bucketConfigured: boolean;
}

/**
 * Presence-only diagnostics for deploy debugging. Reports ONLY booleans —
 * never a value, never a prefix, never a length. Safe to expose through
 * `/api/media/diagnostics`.
 */
export function getAppwriteDiagnostics(): AppwriteDiagnostics {
  const endpointConfigured =
    readEnv('APPWRITE_ENDPOINT') !== null || readEnv('NEXT_PUBLIC_APPWRITE_ENDPOINT') !== null;
  const projectConfigured =
    readEnv('APPWRITE_PROJECT_ID') !== null || readEnv('NEXT_PUBLIC_APPWRITE_PROJECT_ID') !== null;
  const apiKeyConfigured = readEnv('APPWRITE_API_KEY') !== null;
  const bucketConfigured =
    readEnv('APPWRITE_STORAGE_BUCKET_ID') !== null || readEnv('APPWRITE_BUCKET_ID') !== null;

  return {
    configured: endpointConfigured && projectConfigured && apiKeyConfigured && bucketConfigured,
    endpointConfigured,
    projectConfigured,
    apiKeyConfigured,
    bucketConfigured,
  };
}
