/**
 * Media reference parsing + URL resolution.
 *
 * IMPORTANT: this module is deliberately isomorphic and secret-free so that
 * `components/media/stored-image.tsx` can use it in the browser. It only ever
 * touches `NEXT_PUBLIC_*` values, which are non-sensitive by definition
 * (an Appwrite endpoint + project id are already visible in any public URL).
 */

import type { AppwriteMediaRef, LegacyMediaRef, MediaRef } from './types';

export const APPWRITE_REF_PREFIX = 'appwrite://';

/**
 * Parse a stored column value.
 *
 * - `appwrite://<bucketId>/<fileId>` → Appwrite-backed media
 * - anything else (full Supabase public URL, bare storage path, external URL)
 *   → legacy, rendered exactly as before. This is what keeps every image that
 *   already exists in Supabase Storage working with zero data migration.
 */
export function parseMediaRef(value: string | null | undefined): MediaRef | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;

  if (trimmed.startsWith(APPWRITE_REF_PREFIX)) {
    const rest = trimmed.slice(APPWRITE_REF_PREFIX.length);
    const slash = rest.indexOf('/');
    if (slash <= 0) return null;
    const bucketId = rest.slice(0, slash);
    const fileId = rest.slice(slash + 1).split('?')[0] ?? '';
    if (bucketId === '' || fileId === '') return null;
    return { provider: 'appwrite', bucketId, fileId };
  }

  return { provider: 'legacy', value: trimmed };
}

export function buildAppwriteRef(bucketId: string, fileId: string): string {
  return `${APPWRITE_REF_PREFIX}${bucketId}/${fileId}`;
}

export function isAppwriteRef(value: string | null | undefined): boolean {
  return parseMediaRef(value)?.provider === 'appwrite';
}

/**
 * Endpoint + project id are NOT secrets — they are visible in every public
 * file URL Appwrite serves. The `NEXT_PUBLIC_*` mirrors exist so Client
 * Components can build URLs; the bare names are the server-side source and
 * simply resolve to `undefined` in the browser bundle.
 *
 * `APPWRITE_API_KEY` is deliberately never referenced in this file.
 */
function publicEndpoint(): string | null {
  const endpoint = process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT ?? process.env.APPWRITE_ENDPOINT;
  return endpoint && endpoint.trim() !== '' ? endpoint.trim().replace(/\/+$/, '') : null;
}

function publicProjectId(): string | null {
  const project = process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID ?? process.env.APPWRITE_PROJECT_ID;
  return project && project.trim() !== '' ? project.trim() : null;
}

export interface AppwriteViewOptions {
  /** Request a resized/re-encoded render from Appwrite's image preview endpoint. */
  width?: number;
  height?: number;
  /** 0-100. Ignored unless a width/height is supplied. */
  quality?: number;
}

/**
 * Public (unauthenticated) delivery URL for a file in a *public* Appwrite bucket.
 * Returns `null` when Appwrite is not configured, so callers can fall back.
 */
export function appwritePublicUrl(
  ref: AppwriteMediaRef,
  options: AppwriteViewOptions = {},
): string | null {
  const endpoint = publicEndpoint();
  const project = publicProjectId();
  if (!endpoint || !project) return null;

  const base = `${endpoint}/storage/buckets/${encodeURIComponent(ref.bucketId)}/files/${encodeURIComponent(ref.fileId)}`;
  const params = new URLSearchParams({ project });

  const wantsPreview =
    typeof options.width === 'number' || typeof options.height === 'number';

  if (!wantsPreview) return `${base}/view?${params.toString()}`;

  if (typeof options.width === 'number') params.set('width', String(Math.round(options.width)));
  if (typeof options.height === 'number') params.set('height', String(Math.round(options.height)));
  params.set('quality', String(options.quality ?? 80));
  params.set('output', 'webp');
  return `${base}/preview?${params.toString()}`;
}

/**
 * Authorised streaming URL for private media (retailer documents). The route
 * handler re-checks the Supabase session and role before returning bytes.
 */
export function privateMediaUrl(refValue: string): string {
  return `/api/media/private?ref=${encodeURIComponent(refValue)}`;
}

/**
 * Resolve any stored column value to something an `<img>` can use.
 *
 * `null` means "not resolvable here" — e.g. a legacy private object path that
 * needs a server-side signed URL, or Appwrite env vars missing.
 */
export function resolveMediaUrl(
  value: string | null | undefined,
  options: AppwriteViewOptions = {},
): string | null {
  const ref = parseMediaRef(value);
  if (!ref) return null;
  if (ref.provider === 'appwrite') return appwritePublicUrl(ref, options);

  // Legacy Supabase public URLs (and any absolute URL) render as-is.
  if (/^https?:\/\//i.test(ref.value)) return ref.value;
  if (ref.value.startsWith('/')) return ref.value;

  // Bare object path — private, needs a signed URL from the server.
  return null;
}

/** Legacy private Supabase object paths look like `<retailerId>/<timestamp>-<name>`. */
export function isLegacyObjectPath(value: string | null | undefined): boolean {
  const ref = parseMediaRef(value);
  if (!ref || ref.provider !== 'legacy') return false;
  return !/^https?:\/\//i.test(ref.value) && !ref.value.startsWith('/');
}

export type { AppwriteMediaRef, LegacyMediaRef, MediaRef };
