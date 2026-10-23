/**
 * Media reference parsing + URL resolution (Supabase-only).
 *
 * IMPORTANT: this module is deliberately isomorphic and secret-free so that
 * `components/media/stored-image.tsx` can use it in the browser. It reads no
 * environment variables and no secrets — it only inspects the shape of the
 * stored column value.
 */

/** Parsed form of a stored column value. */
export type ParsedMediaRef =
  | { provider: 'supabase-url'; bucket: string; path: string; url: string }
  | { provider: 'object-path'; value: string }
  | { provider: 'external-url'; value: string };

const APPWRITE_REF_PREFIX = 'appwrite://';

/**
 * Extract the bucket + object path from a Supabase public URL such as
 * `https://<ref>.supabase.co/storage/v1/object/public/<bucket>/<path>`.
 * Returns `null` for anything else (including other external hosts).
 */
export function parseSupabasePublicUrl(url: string): { bucket: string; path: string } | null {
  try {
    const parsed = new URL(url);
    const match = parsed.pathname.match(/^\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/);
    if (!match) return null;
    const bucket = decodeURIComponent(match[1] ?? '');
    const path = match[2] ?? '';
    if (!bucket || !path) return null;
    return { bucket, path };
  } catch {
    return null;
  }
}

/**
 * Parse a stored column value.
 *
 * - a Supabase public URL      → `{ provider: 'supabase-url', bucket, path }`
 * - a bare object path         → `{ provider: 'object-path' }` (private documents)
 * - any other absolute/relative URL → `{ provider: 'external-url' }`
 * - an old `appwrite://…` ref  → `null` (Appwrite is no longer in use; the value
 *   renders as a placeholder rather than crashing)
 * - a `blob:` / `data:` URL    → `null` (temporary, never a valid stored reference)
 * - empty / non-string         → `null`
 */
export function parseMediaRef(value: string | null | undefined): ParsedMediaRef | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;

  if (trimmed.startsWith(APPWRITE_REF_PREFIX)) return null;

  // Session-scoped previews must never be treated as stored references: a
  // `blob:` object URL dies on reload and a `data:` URL bloats the column.
  // The upload flow always returns a permanent Supabase reference, so anything
  // shaped like this is bad data — render a placeholder and skip cleanup.
  if (/^(blob|data):/i.test(trimmed)) return null;

  if (/^https?:\/\//i.test(trimmed)) {
    const supabase = parseSupabasePublicUrl(trimmed);
    if (supabase) return { provider: 'supabase-url', ...supabase, url: trimmed };
    return { provider: 'external-url', value: trimmed };
  }

  if (trimmed.startsWith('/')) return { provider: 'external-url', value: trimmed };

  return { provider: 'object-path', value: trimmed };
}

/**
 * Resolve any stored column value to something an `<img>` can use.
 *
 * `null` means "not resolvable here" — e.g. a private object path that needs a
 * server-side signed URL, or an unrecognised `appwrite://` value.
 */
export function resolveMediaUrl(value: string | null | undefined): string | null {
  const ref = parseMediaRef(value);
  if (!ref) return null;
  if (ref.provider === 'supabase-url') return ref.url;
  if (ref.provider === 'external-url') return ref.value;
  return null;
}

/** Legacy private Supabase object paths look like `<retailerId>/<timestamp>-<name>`. */
export function isLegacyObjectPath(value: string | null | undefined): boolean {
  return parseMediaRef(value)?.provider === 'object-path';
}

/**
 * A lower-case UUID exactly as `crypto.randomUUID()` produces it — the only
 * object-name shape `lib/media/paths.newFileId()` ever emits.
 *
 * Deliberately case-sensitive: Postgres object paths are case-sensitive, so a
 * mixed-case path would name a different object than the one that was written.
 */
const LOWER_UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

/**
 * The ONLY shape a private banner-draft object path may take:
 *
 *   banners/{bannerId | _draft}/{uuid}.{jpg|png|webp}
 *
 * It mirrors `MEDIA_KIND_CONFIG['banner-draft'].folder` + `buildMediaPath`
 * exactly, and it is the same expression the `0077` CHECK constraints enforce
 * in Postgres. An absolute URL can never match, which is what stops private
 * artwork from being written into a public column.
 *
 * `_draft` covers the create-then-attach flow: the admin uploads draft artwork
 * before the banner row exists.
 */
export const DRAFT_BANNER_PATH_RE = new RegExp(
  `^banners/(_draft|${LOWER_UUID})/${LOWER_UUID}\.(jpg|png|webp)$`,
);

/** True when `value` is a well-formed private banner-draft object path. */
export function isDraftBannerPath(value: string | null | undefined): boolean {
  return typeof value === 'string' && DRAFT_BANNER_PATH_RE.test(value);
}

/** The banner id (or `_draft`) a draft path belongs to. `null` when unparseable. */
export function draftBannerOwner(path: string | null | undefined): string | null {
  if (!isDraftBannerPath(path)) return null;
  return path!.split('/')[1] ?? null;
}

/**
 * True for a Supabase *signed* object URL, or any URL carrying a `token`
 * query parameter. Signed URLs are bearer credentials: they must be generated
 * per render and never persisted, logged or embedded in cached HTML.
 */
export function isSignedStorageUrl(value: string | null | undefined): boolean {
  if (typeof value !== 'string' || value === '') return false;
  if (/\/storage\/v1\/object\/sign\//i.test(value)) return true;
  return /[?&]token=/i.test(value);
}

/**
 * Reject object paths that could escape their prefix or name something else
 * entirely: absolute paths, traversal, protocol prefixes, empty segments and
 * anything that is really a signed URL.
 *
 * This is the last line of defence before a bucket delete.
 */
export function isSafeObjectPath(value: string | null | undefined): boolean {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (trimmed === '' || trimmed !== value) return false;
  if (trimmed.startsWith('/') || trimmed.startsWith('\\')) return false;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return false;
  if (isSignedStorageUrl(trimmed)) return false;
  if (trimmed.includes('..') || trimmed.includes('//') || trimmed.includes('\\')) return false;
  return true;
}

/**
 * True when a value is directly renderable in an `<img>` (Supabase public URL
 * or an absolute/root-relative URL). Used by the admin form validators to
 * accept only values the upload flow actually produces.
 *
 * Private draft paths are deliberately NOT renderable: they resolve only to a
 * short-lived signed URL minted server-side.
 */
export function isRenderableMediaRef(value: string | null | undefined): boolean {
  const ref = parseMediaRef(value);
  return ref?.provider === 'supabase-url' || ref?.provider === 'external-url';
}
