/**
 * Storage retention — Supabase Storage bucket classification and a bounded,
 * allow-listed sweep of TEMPORARY objects.
 *
 * Classification rule (spec §24): every bucket is permanent unless it is
 * EXPLICITLY classified temporary below. An unknown bucket is treated as
 * permanent — the sweep can never reach it.
 *
 *   PERMANENT (never auto-deleted, regardless of object age):
 *     product-images, brand-logos, category-images, banners, banner-drafts,
 *     avatars, retailer-documents (KYC paperwork is customer master data)
 *
 *   `banner-drafts` is permanent by owner decision: unpublished artwork must
 *   survive a rollback, so it is never swept. See the storage-growth trade-off
 *   in docs/BANNER_DRAFT_ARTWORK_IMPLEMENTATION.md.
 *
 *   TEMPORARY (per-record proof artifacts; their DB rows are deleted by the
 *   120-day business cleanup, so the objects go with them after 120 days):
 *     delivery-proofs, payment-proofs
 *
 * Product images in particular must NEVER be deleted merely because their
 * created_at is old — this module physically cannot touch that bucket.
 */

export type StorageRetentionClass = 'permanent' | 'temporary';

export interface BucketRetentionPolicy {
  bucket: string;
  classification: StorageRetentionClass;
  /** Temporary buckets only: objects strictly older than this are eligible. */
  retentionDays?: number;
  /** Why this classification was chosen (kept in the audit doc too). */
  reason: string;
}

const POLICIES: BucketRetentionPolicy[] = [
  {
    bucket: 'product-images',
    classification: 'permanent',
    reason: 'Product master data — spec: product images must NEVER be auto-deleted.',
  },
  {
    bucket: 'brand-logos',
    classification: 'permanent',
    reason: 'Brand master data — permanent catalog content.',
  },
  {
    bucket: 'category-images',
    classification: 'permanent',
    reason: 'Category master data — permanent catalog content.',
  },
  {
    bucket: 'banners',
    classification: 'permanent',
    reason: 'Managed marketing content — admin manages banner lifecycle explicitly.',
  },
  {
    bucket: 'banner-drafts',
    classification: 'permanent',
    reason:
      'Unpublished banner artwork. Owner decision: draft images are preserved and never auto-deleted, including across a rollback. Growth is reclaimed only by a separately approved manual cleanup.',
  },
  {
    bucket: 'avatars',
    classification: 'permanent',
    reason: 'Profile photos belong to user master records.',
  },
  {
    bucket: 'retailer-documents',
    classification: 'permanent',
    reason: 'KYC/registration documents belong to active customer master records.',
  },
  {
    bucket: 'delivery-proofs',
    classification: 'temporary',
    retentionDays: 120,
    reason: 'Per-delivery proof artifacts; order_deliveries rows are deleted with the 120-day order cleanup.',
  },
  {
    bucket: 'payment-proofs',
    classification: 'temporary',
    retentionDays: 120,
    reason: 'Per-payment proof artifacts; payment_collections rows are deleted by the 120-day payment cleanup.',
  },
];

export const STORAGE_BUCKET_POLICIES: readonly BucketRetentionPolicy[] = POLICIES;

const POLICY_BY_BUCKET = new Map(POLICIES.map((p) => [p.bucket, p]));

/**
 * Classify a bucket. Anything not explicitly temporary is PERMANENT —
 * cleanup never guesses.
 */
export function classifyStorageBucket(bucket: string): StorageRetentionClass {
  return POLICY_BY_BUCKET.get(bucket)?.classification ?? 'permanent';
}

/** The explicit policy row for a bucket (`null` for unknown buckets). */
export function storageBucketPolicy(bucket: string): BucketRetentionPolicy | null {
  return POLICY_BY_BUCKET.get(bucket) ?? null;
}

/** Buckets the sweep is allowed to delete objects from. */
export function temporaryStorageBuckets(): BucketRetentionPolicy[] {
  return POLICIES.filter((p) => p.classification === 'temporary');
}

/**
 * Is one storage object eligible for deletion?
 *
 * Only objects in an explicitly TEMPORARY bucket, strictly older than that
 * bucket's retention window. Unknown buckets and permanent buckets always
 * return false — an old product image can never qualify.
 */
export function isEligibleTemporaryStorageObject(
  bucket: string,
  objectCreatedAt: string | Date,
  now: Date = new Date()
): boolean {
  const policy = POLICY_BY_BUCKET.get(bucket);
  if (!policy || policy.classification !== 'temporary' || !policy.retentionDays) return false;
  const created = typeof objectCreatedAt === 'string' ? new Date(objectCreatedAt) : objectCreatedAt;
  if (Number.isNaN(created.getTime())) return false;
  const cutoff = now.getTime() - policy.retentionDays * 24 * 60 * 60 * 1000;
  return created.getTime() < cutoff;
}

export interface StorageSweepResult {
  bucket: string;
  scanned: number;
  deleted: number;
  /** Objects skipped because they are younger than the retention window. */
  kept: number;
  error?: string;
}

/** Minimal Storage API surface the sweep needs (SupabaseStorageClient). */
export interface StorageListFile {
  name: string;
  created_at?: string | null;
  id?: string | null;
}
export interface StorageBucketApi {
  list(
    path: string,
    options?: { limit?: number; offset?: number }
  ): Promise<{ data: StorageListFile[] | null; error: { message: string } | null }>;
  remove(paths: string[]): Promise<{ data: unknown; error: { message: string } | null }>;
}
export interface StorageApi {
  from(bucket: string): StorageBucketApi;
}

export interface StorageSweepOptions {
  now?: Date;
  /** Hard cap on objects deleted per bucket per sweep (bounded processing). */
  maxDeletesPerBucket?: number;
  /** Hard cap on entries scanned per bucket per sweep. */
  maxScanPerBucket?: number;
}

/**
 * Bounded sweep of ONE temporary bucket: walks the two-level object layout
 * used by the proof buckets (folder/file), deleting only objects that pass
 * `isEligibleTemporaryStorageObject`. Every batch is capped; a sweep can never
 * be an unbounded bulk delete. Errors are captured per bucket, never thrown.
 */
export async function sweepTemporaryStorageBucket(
  storage: StorageApi,
  bucket: string,
  options: StorageSweepOptions = {}
): Promise<StorageSweepResult> {
  const policy = POLICY_BY_BUCKET.get(bucket);
  const result: StorageSweepResult = { bucket, scanned: 0, deleted: 0, kept: 0 };
  if (!policy || policy.classification !== 'temporary') {
    return { ...result, error: 'Bucket is not classified temporary — refusing to delete anything.' };
  }

  const now = options.now ?? new Date();
  const maxDeletes = options.maxDeletesPerBucket ?? 500;
  const maxScan = options.maxScanPerBucket ?? 2000;
  const api = storage.from(bucket);

  try {
    const pending: string[] = ['']; // '' = bucket root
    while (pending.length > 0 && result.scanned < maxScan && result.deleted < maxDeletes) {
      const prefix = pending.shift() ?? '';
      const { data, error } = await api.list(prefix, { limit: 200 });
      if (error) return { ...result, error: error.message };
      for (const entry of data ?? []) {
        if (result.scanned >= maxScan || result.deleted >= maxDeletes) break;
        result.scanned += 1;
        const path = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.id === null || entry.id === undefined) {
          // A "folder" — recurse one level deeper.
          pending.push(path);
          continue;
        }
        if (entry.created_at && isEligibleTemporaryStorageObject(bucket, entry.created_at, now)) {
          const { error: removeError } = await api.remove([path]);
          if (removeError) return { ...result, error: removeError.message };
          result.deleted += 1;
        } else {
          result.kept += 1;
        }
      }
    }
    return result;
  } catch (error) {
    return { ...result, error: (error as Error).message };
  }
}

/** Sweep every temporary bucket (permanent buckets are never visited). */
export async function sweepTemporaryStorage(
  storage: StorageApi,
  options: StorageSweepOptions = {}
): Promise<StorageSweepResult[]> {
  const results: StorageSweepResult[] = [];
  for (const policy of temporaryStorageBuckets()) {
    results.push(await sweepTemporaryStorageBucket(storage, policy.bucket, options));
  }
  return results;
}
