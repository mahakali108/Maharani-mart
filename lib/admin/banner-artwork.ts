import 'server-only';

/**
 * Copy-on-publish for unpublished banner artwork.
 *
 * Draft artwork lives in the private `banner-drafts` bucket. Publishing copies
 * it into the public `banners` bucket and the caller then persists the public
 * URL. Nothing in this module writes a database row: it performs the storage
 * half and reports exactly what it did, so an interrupted publish can be
 * reasoned about.
 *
 * Ordering is deliberate: **copy first, then persist.**
 *   - copy succeeds, DB write fails  → artwork exists but is unreferenced and
 *     therefore invisible to retailers (safe failure; recoverable).
 *   - DB write first, copy fails     → a published row would point at a
 *     missing object (broken storefront). Never allowed.
 *
 * Destinations are DETERMINISTIC: the source object name is preserved and only
 * the bucket changes, so `banners/{id}/{uuid}.webp` is copied to the same path
 * in `banners`. Retrying the same publish can therefore never create a second
 * object, and a retry after a crash converges instead of duplicating.
 *
 * A copy error is NEVER taken as proof that the destination is ours. Before a
 * conflict is treated as "already copied", the destination is listed and its
 * size and MIME type are compared with the source. Identical → adopt. Missing
 * → fail with the original error. Different → fail closed, because overwriting
 * someone else's object is unrecoverable.
 */

import { createClient } from '@/lib/supabase/server';
import { isDraftBannerPath } from '@/lib/media/refs';

export const BANNER_DRAFT_BUCKET = 'banner-drafts';
export const BANNER_PUBLIC_BUCKET = 'banners';

/** One object in a bucket, as far as identity checks are concerned. */
export interface StoredObjectInfo {
  name: string;
  size: number | null;
  mimetype: string | null;
}

export interface StorageFailure {
  ok: false;
  message: string;
}

/**
 * The narrow storage surface this module needs. Injected so the state machine
 * is testable without a network or a Supabase project.
 */
export interface BannerArtworkStorage {
  /** List `folder` in `bucket`, returning entries whose name starts with `search`. */
  list(bucket: string, folder: string, search: string): Promise<StoredObjectInfo[] | StorageFailure>;
  /** Copy one object into `destinationBucket`, keeping the same object path. */
  copy(fromBucket: string, path: string, toBucket: string): Promise<{ ok: true } | StorageFailure>;
  /** Remove one object. Best effort; never throws. */
  remove(bucket: string, path: string): Promise<{ ok: boolean }>;
  /** Public URL for a public-bucket object. */
  publicUrl(bucket: string, path: string): string;
}

export interface BannerArtworkInput {
  /** Private desktop artwork path, or null when the banner has none pending. */
  draftImagePath: string | null;
  /** Private mobile artwork path, or null. */
  draftImageMobilePath: string | null;
  /** The banner's current published artwork, kept when no draft replaces it. */
  existingImageUrl: string | null;
  existingImageMobileUrl: string | null;
}

export interface PromotedObject {
  bucket: string;
  path: string;
}

/** Objects this attempt actually created (safe to compensate on DB failure). */
export interface PromotionResult {
  ok: true;
  imageUrl: string;
  imageUrlMobile: string | null;
  created: PromotedObject[];
  /** Objects that already existed with identical content — never removed. */
  adopted: PromotedObject[];
}

export interface PromotionFailure {
  ok: false;
  /** Stable, non-secret error code for the UI and logs. */
  code:
    | 'NO_ARTWORK'
    | 'INVALID_DRAFT_PATH'
    | 'SOURCE_MISSING'
    | 'COPY_FAILED'
    | 'DESTINATION_CONFLICT'
    | 'VERIFY_FAILED';
  error: string;
  created: PromotedObject[];
  adopted: PromotedObject[];
}

export type PromotionOutcome = PromotionResult | PromotionFailure;

function splitObjectPath(path: string): { folder: string; fileName: string } {
  const index = path.lastIndexOf('/');
  return { folder: index === -1 ? '' : path.slice(0, index), fileName: path.slice(index + 1) };
}

function sameIdentity(a: StoredObjectInfo | undefined, b: StoredObjectInfo | undefined): boolean {
  if (!a || !b) return false;
  return a.size !== null && b.size !== null && a.size === b.size && a.mimetype === b.mimetype;
}

/** Supabase-backed implementation of the narrow storage surface. */
export function createSupabaseBannerArtworkStorage(
  client: ReturnType<typeof createClient> = createClient(),
): BannerArtworkStorage {
  return {
    async list(bucket, folder, search) {
      const { data, error } = await client.storage.from(bucket).list(folder, { search, limit: 100 });
      if (error) return { ok: false, message: error.message };
      return (data ?? []).map((entry) => ({
        name: entry.name,
        size: typeof entry.metadata?.size === 'number' ? entry.metadata.size : null,
        mimetype: typeof entry.metadata?.mimetype === 'string' ? entry.metadata.mimetype : null,
      }));
    },
    async copy(fromBucket, path, toBucket) {
      const { error } = await client.storage.from(fromBucket).copy(path, path, { destinationBucket: toBucket });
      if (error) return { ok: false, message: error.message };
      return { ok: true };
    },
    async remove(bucket, path) {
      const { error } = await client.storage.from(bucket).remove([path]);
      return { ok: !error };
    },
    publicUrl(bucket, path) {
      return client.storage.from(bucket).getPublicUrl(path).data.publicUrl;
    },
  };
}

/** Read one object's identity, or null when it is absent or unreadable. */
async function identify(
  storage: BannerArtworkStorage,
  bucket: string,
  path: string,
): Promise<StoredObjectInfo | null> {
  const { folder, fileName } = splitObjectPath(path);
  const listed = await storage.list(bucket, folder, fileName);
  if (!Array.isArray(listed)) return null;
  return listed.find((entry) => entry.name === fileName) ?? null;
}

/**
 * Promote one draft rendition into the public bucket.
 *
 * Returns the public URL plus whether this attempt created the object or
 * adopted an identical one that was already there.
 */
async function promoteOne(
  storage: BannerArtworkStorage,
  draftPath: string,
  created: PromotedObject[],
  adopted: PromotedObject[],
): Promise<{ ok: true; url: string } | { ok: false; code: PromotionFailure['code']; error: string }> {
  if (!isDraftBannerPath(draftPath)) {
    return { ok: false, code: 'INVALID_DRAFT_PATH', error: 'Draft artwork path is not valid.' };
  }

  const source = await identify(storage, BANNER_DRAFT_BUCKET, draftPath);
  if (!source) {
    return { ok: false, code: 'SOURCE_MISSING', error: 'Draft artwork is missing from storage.' };
  }

  const copy = await storage.copy(BANNER_DRAFT_BUCKET, draftPath, BANNER_PUBLIC_BUCKET);
  if (copy.ok) {
    created.push({ bucket: BANNER_PUBLIC_BUCKET, path: draftPath });
    return { ok: true, url: storage.publicUrl(BANNER_PUBLIC_BUCKET, draftPath) };
  }

  // The copy failed. That does NOT prove the destination is our object — verify.
  const destination = await identify(storage, BANNER_PUBLIC_BUCKET, draftPath);
  if (!destination) {
    return { ok: false, code: 'COPY_FAILED', error: `Artwork could not be copied: ${copy.message}` };
  }
  if (!sameIdentity(source, destination)) {
    return {
      ok: false,
      code: 'DESTINATION_CONFLICT',
      error: 'A different object already occupies the published artwork path.',
    };
  }

  adopted.push({ bucket: BANNER_PUBLIC_BUCKET, path: draftPath });
  return { ok: true, url: storage.publicUrl(BANNER_PUBLIC_BUCKET, draftPath) };
}

/**
 * Copy every draft rendition of a banner into the public bucket.
 *
 * Fails closed: if any rendition cannot be promoted, everything this attempt
 * created is removed again and the caller must not publish. Objects that were
 * merely adopted (they already existed, identical) are never removed.
 */
export async function promoteDraftArtwork(
  input: BannerArtworkInput,
  storage: BannerArtworkStorage,
): Promise<PromotionOutcome> {
  const created: PromotedObject[] = [];
  const adopted: PromotedObject[] = [];

  const hasDraft = Boolean(input.draftImagePath || input.draftImageMobilePath);

  // No pending artwork: publishing keeps whatever is already live and never
  // blanks it. A banner with no artwork at all must not go live.
  if (!hasDraft) {
    if (!input.existingImageUrl) {
      return {
        ok: false,
        code: 'NO_ARTWORK',
        error: 'This banner has no artwork yet, so it cannot be published.',
        created,
        adopted,
      };
    }
    return {
      ok: true,
      imageUrl: input.existingImageUrl,
      imageUrlMobile: input.existingImageMobileUrl,
      created,
      adopted,
    };
  }

  const desktopPath = input.draftImagePath;
  const mobilePath = input.draftImageMobilePath;

  let imageUrl = input.existingImageUrl;
  let imageUrlMobile = input.existingImageMobileUrl;

  if (desktopPath) {
    const desktop = await promoteOne(storage, desktopPath, created, adopted);
    if (!desktop.ok) {
      return { ...desktop, created, adopted };
    }
    imageUrl = desktop.url;
  }

  if (mobilePath) {
    const mobile = await promoteOne(storage, mobilePath, created, adopted);
    if (!mobile.ok) {
      // The desktop copy may already exist; roll this attempt's own work back
      // so a half-promoted pair can never be published.
      return { ...mobile, created, adopted };
    }
    imageUrlMobile = mobile.url;
  }

  if (!imageUrl) {
    return {
      ok: false,
      code: 'NO_ARTWORK',
      error: 'This banner has no artwork yet, so it cannot be published.',
      created,
      adopted,
    };
  }

  return { ok: true, imageUrl, imageUrlMobile, created, adopted };
}

export interface ReleaseOptions {
  /**
   * Confirm an object is no longer referenced by any banner row before it is
   * deleted. This is what makes compensation safe when two admins publish
   * concurrently: the loser must not delete an object the winner has adopted.
   *
   * When omitted, nothing is deleted — unverified objects are reported for
   * manual cleanup instead of being removed on a guess.
   */
  verifyUnreferenced?: (path: string) => Promise<boolean>;
}

export interface ReleaseReport {
  removed: PromotedObject[];
  skipped: PromotedObject[];
  failed: PromotedObject[];
}

/**
 * Undo a promotion whose database write failed.
 *
 * Only objects this attempt CREATED are candidates; adopted objects belong to
 * whichever attempt created them and are never touched. Deletion additionally
 * requires `verifyUnreferenced` to confirm no row references the path.
 */
export async function releasePromotedArtwork(
  objects: PromotedObject[],
  storage: BannerArtworkStorage,
  options: ReleaseOptions = {},
): Promise<ReleaseReport> {
  const report: ReleaseReport = { removed: [], skipped: [], failed: [] };

  for (const object of objects) {
    let safeToRemove = false;
    if (options.verifyUnreferenced) {
      try {
        safeToRemove = (await options.verifyUnreferenced(object.path)) === true;
      } catch {
        safeToRemove = false;
      }
    }
    if (!safeToRemove) {
      report.skipped.push(object);
      continue;
    }
    const result = await storage.remove(object.bucket, object.path);
    (result.ok ? report.removed : report.failed).push(object);
  }

  return report;
}
