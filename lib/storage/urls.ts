import { FIREBASE_PATH_PREFIXES } from '@/lib/storage/types';

export function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

export function isFirebaseObjectPath(value: string): boolean {
  const trimmed = value.trim().replace(/^\/+/, '');
  return FIREBASE_PATH_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
}

export function publicFirebaseBucket(): string | null {
  return process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET?.trim() || null;
}

/**
 * Builds a durable download URL for a public Firebase object.
 * Temporary tokenized download URLs are intentionally not stored.
 */
export function firebasePublicUrl(objectPath: string, bucket = publicFirebaseBucket()): string | null {
  if (!bucket) return null;
  const normalized = objectPath.replace(/^\/+/, '');
  return `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(normalized)}?alt=media`;
}

/**
 * Turns a DB-stored image reference into something `<Image>` can render.
 *
 * - Existing full http(s) URLs (legacy Supabase public URLs) pass through.
 * - `gs://bucket/path` and Firebase object paths become public download URLs.
 * - Returns null when a path cannot be resolved (missing public bucket config).
 */
export function resolveMediaUrl(stored: string | null | undefined): string | null {
  if (!stored) return null;
  const value = stored.trim();
  if (!value) return null;
  if (isHttpUrl(value)) return value;

  if (value.startsWith('gs://')) {
    const withoutScheme = value.slice(5);
    const slash = withoutScheme.indexOf('/');
    if (slash === -1) return null;
    const bucket = withoutScheme.slice(0, slash);
    const path = withoutScheme.slice(slash + 1);
    return firebasePublicUrl(path, bucket);
  }

  if (isFirebaseObjectPath(value) || !value.includes('://')) {
    return firebasePublicUrl(value.replace(/^\/+/, ''));
  }

  return null;
}

export function looksLikeStoredRef(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes('..') || trimmed.includes('\\')) return false;
  return isHttpUrl(trimmed) || isFirebaseObjectPath(trimmed) || /^[a-z0-9][a-z0-9/_.-]+$/i.test(trimmed);
}
