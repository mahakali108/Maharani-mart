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
 * True when a value is directly renderable in an `<img>` (Supabase public URL
 * or an absolute/root-relative URL). Used by the admin form validators to
 * accept only values the upload flow actually produces.
 */
export function isRenderableMediaRef(value: string | null | undefined): boolean {
  const ref = parseMediaRef(value);
  return ref?.provider === 'supabase-url' || ref?.provider === 'external-url';
}
