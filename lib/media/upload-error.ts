/**
 * Pure, dependency-free error formatting for Supabase Storage write failures.
 *
 * Lives in its own module (no `server-only`, no SDK import) so it is unit
 * testable and reusable. The upload flow uses this to turn the raw
 * `StorageError` from `supabase.storage.from(bucket).upload()` into a message
 * that actually tells an operator what to do — in particular the
 * "Bucket not found" case, which means the configured Supabase project is
 * missing the bucket row that `supabase/migrations` defines (migrations are
 * NOT applied automatically; see docs/deployment_guide.md).
 *
 * It never echoes secrets and never suggests creating a second bucket.
 */

/** True when `error` is Supabase's "bucket does not exist" rejection. */
export function isMissingBucketError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const e = error as { message?: unknown; statusCode?: unknown };
  const message = typeof e.message === 'string' ? e.message : '';
  if (/bucket not found/i.test(message) || /bucket\s*("?[\w-]+"?\s*)?does not exist/i.test(message)) {
    return true;
  }
  // The Storage API answers an upload to an unknown bucket with 404 and/or
  // `InvalidBucketName`; either is treated as "bucket missing".
  const status = e.statusCode == null ? '' : String(e.statusCode);
  return status === '404';
}

/**
 * Human-readable, actionable message for a failed upload.
 *
 * The generic shape `Upload failed: <reason>` is preserved for every other
 * Storage error so existing UI (which renders this string directly) keeps
 * working unchanged.
 */
export function describeStorageUploadError(bucket: string, error: unknown): string {
  if (isMissingBucketError(error)) {
    return (
      `Upload failed: the "${bucket}" storage bucket does not exist in the configured ` +
      'Supabase project. Ask an administrator to apply supabase/migrations to that ' +
      'project (category images: 0021_ensure_category_images_bucket.sql, which also ' +
      'converges a project where 0016 was skipped) and retry. ' +
      'Do NOT create the bucket manually under a different name — the app reads and ' +
      'writes this canonical bucket only.'
    );
  }
  const message =
    error instanceof Error && error.message
      ? error.message
      : typeof error === 'object' &&
          error !== null &&
          'message' in error &&
          typeof (error as { message: unknown }).message === 'string'
        ? (error as { message: string }).message
        : 'Storage rejected the upload.';
  return `Upload failed: ${message}`;
}
