import 'server-only';

import { FIREBASE_NOT_CONFIGURED, isFirebaseAdminConfigured } from '@/lib/storage/firebase/env';
import { firebaseAdminBucketName, getFirebaseBucket } from '@/lib/storage/firebase/admin';
import { assertPathOwned, buildObjectPath, normalizeObjectPath } from '@/lib/storage/paths';
import { firebasePublicUrl } from '@/lib/storage/urls';
import { validateStoredFile } from '@/lib/storage/validate';
import type { StorageKind, StorageUploadResult } from '@/lib/storage/types';

export type { StorageKind, StorageUploadResult } from '@/lib/storage/types';
export { buildObjectPath, ownerPrefix } from '@/lib/storage/paths';
export { resolveMediaUrl, isFirebaseObjectPath, isHttpUrl } from '@/lib/storage/urls';
export { isFirebaseAdminConfigured } from '@/lib/storage/firebase/env';

const PRIVATE_KINDS: StorageKind[] = ['retailer_document'];

function requireAdmin() {
  if (!isFirebaseAdminConfigured()) {
    throw new Error(FIREBASE_NOT_CONFIGURED);
  }
}

export function isPrivateKind(kind: StorageKind): boolean {
  return PRIVATE_KINDS.includes(kind);
}

export function getObjectPath(
  kind: StorageKind,
  ownerId: string,
  originalName: string,
  mime: string,
  variant: 'main' | 'gallery' = 'main'
): string {
  return buildObjectPath(kind, ownerId, originalName, mime, variant);
}

export function getUrl(stored: string | null | undefined): string | null {
  if (!stored) return null;
  const value = stored.trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  return firebasePublicUrl(value, process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET?.trim() || firebaseAdminBucketName());
}

export interface UploadInput {
  kind: StorageKind;
  ownerId: string;
  bytes: Uint8Array;
  filename: string;
  declaredType?: string;
  variant?: 'main' | 'gallery';
}

export async function upload(input: UploadInput): Promise<StorageUploadResult> {
  requireAdmin();
  const validated = validateStoredFile(input.kind, input.bytes, input.filename, input.declaredType);
  const path = buildObjectPath(input.kind, input.ownerId, input.filename, validated.mime, input.variant ?? 'main');
  const bucket = getFirebaseBucket();
  const file = bucket.file(path);
  const visibility = isPrivateKind(input.kind) ? 'private' : 'public';

  await file.save(Buffer.from(validated.bytes), {
    resumable: false,
    validation: 'md5',
    metadata: {
      contentType: validated.mime,
      cacheControl: visibility === 'public' ? 'public, max-age=31536000, immutable' : 'private, max-age=0',
      metadata: {
        kind: input.kind,
        ownerId: input.ownerId,
      },
    },
  });

  return {
    path,
    url: visibility === 'public' ? getUrl(path) : null,
  };
}

export async function remove(path: string): Promise<void> {
  requireAdmin();
  const normalized = normalizeObjectPath(path);
  const bucket = getFirebaseBucket();
  try {
    await bucket.file(normalized).delete({ ignoreNotFound: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Delete failed.';
    throw new Error(message);
  }
}

export async function replace(input: UploadInput & { previousPath?: string | null }): Promise<StorageUploadResult> {
  const result = await upload(input);
  if (input.previousPath && input.previousPath !== result.path) {
    try {
      if (!/^https?:\/\//i.test(input.previousPath)) {
        assertPathOwned(input.previousPath, input.kind, input.ownerId);
        await remove(input.previousPath);
      }
    } catch {
      // Replacement already succeeded. Leaving an orphan is preferable to
      // rolling back a good upload or corrupting the new path.
    }
  }
  return result;
}

export async function getSignedDownloadUrl(path: string, expiresInSeconds = 3600): Promise<string | null> {
  if (!isFirebaseAdminConfigured()) return null;
  const normalized = normalizeObjectPath(path);
  const bucket = getFirebaseBucket();
  const [url] = await bucket.file(normalized).getSignedUrl({
    action: 'read',
    expires: Date.now() + expiresInSeconds * 1000,
  });
  return url ?? null;
}

export async function objectExists(path: string): Promise<boolean> {
  requireAdmin();
  const [exists] = await getFirebaseBucket().file(normalizeObjectPath(path)).exists();
  return exists;
}
