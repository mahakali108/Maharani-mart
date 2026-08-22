import 'server-only';

/**
 * Best-effort Supabase Storage usage report (monitoring only — never deletes
 * or migrates anything).
 *
 * LIMITATIONS (documented honestly, not invented):
 *  - Supabase does not expose total bucket capacity/quota through the Storage
 *    API, so "percent used" and the warning level are derived against a quota
 *    value (an optional `SUPABASE_STORAGE_QUOTA_BYTES` env var, defaulting to
 *    1 GiB). The actual quota should be confirmed on the Supabase dashboard.
 *  - Object counts/sizes are computed by walking the bucket listing, which is
 *    capped per bucket (MAX_FILES_PER_BUCKET) to bound cost; a `truncated`
 *    flag marks buckets where the walk hit the cap. Totals are therefore
 *    approximate.
 */

import { createServiceRoleClient } from '@/lib/supabase/server';

type ServiceRoleClient = ReturnType<typeof createServiceRoleClient>;

export type WarningLevel = 'NORMAL' | 'WARNING' | 'CRITICAL' | 'MIGRATION_READY';

export interface StorageFileEntry {
  name: string;
  size: number;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface StorageBucketUsage {
  bucket: string;
  fileCount: number;
  totalBytes: number;
  largestFiles: StorageFileEntry[];
  recentUploads: StorageFileEntry[];
  truncated: boolean;
}

export interface StorageUsageReport {
  generatedAt: string;
  configured: boolean;
  quotaBytes: number;
  quotaSource: 'env' | 'default';
  buckets: StorageBucketUsage[];
  totalFiles: number;
  totalBytes: number;
  warningLevel: WarningLevel;
  note: string;
}

/** Buckets known to the schema (supabase/migrations/0003, 0006, 0016). */
export const STORAGE_BUCKETS = [
  'product-images',
  'banners',
  'avatars',
  'brand-logos',
  'category-images',
  'retailer-documents',
] as const;

const MAX_FILES_PER_BUCKET = 1000;
const DEFAULT_QUOTA_BYTES = 1 * 1024 * 1024 * 1024; // 1 GiB (Supabase free tier)

function readEnv(name: string): string | null {
  const value = process.env[name];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function warningLevelFor(usedBytes: number, quotaBytes: number): WarningLevel {
  if (quotaBytes <= 0) return 'NORMAL';
  const ratio = usedBytes / quotaBytes;
  if (ratio > 0.95) return 'MIGRATION_READY';
  if (ratio > 0.85) return 'CRITICAL';
  if (ratio > 0.7) return 'WARNING';
  return 'NORMAL';
}

async function walk(
  supabase: ServiceRoleClient,
  bucket: string,
  path: string,
  files: StorageFileEntry[],
  state: { totalBytes: number; truncated: boolean },
): Promise<void> {
  if (files.length >= MAX_FILES_PER_BUCKET) {
    state.truncated = true;
    return;
  }

  const { data, error } = await supabase.storage
    .from(bucket)
    .list(path, { limit: 1000, sortBy: { column: 'name', order: 'asc' } });

  if (error || !data) return;

  for (const entry of data) {
    if (files.length >= MAX_FILES_PER_BUCKET) {
      state.truncated = true;
      return;
    }
    const fullName = path ? `${path}/${entry.name}` : entry.name;
    if (entry.id === null) {
      // Folder — recurse.
      await walk(supabase, bucket, fullName, files, state);
    } else {
      const size = entry.metadata?.size ?? 0;
      files.push({
        name: fullName,
        size,
        createdAt: entry.created_at ?? null,
        updatedAt: entry.updated_at ?? null,
      });
      state.totalBytes += size;
    }
  }
}

/**
 * Compute the report. Returns a `configured: false` report (with an
 * explanatory note) when the service-role key is unavailable, rather than
 * throwing or fabricating numbers.
 */
export async function getStorageUsageReport(): Promise<StorageUsageReport> {
  const generatedAt = new Date().toISOString();

  const quotaEnv = readEnv('SUPABASE_STORAGE_QUOTA_BYTES');
  const quotaBytes = quotaEnv ? Number(quotaEnv) || DEFAULT_QUOTA_BYTES : DEFAULT_QUOTA_BYTES;
  const quotaSource: 'env' | 'default' = quotaEnv ? 'env' : 'default';

  if (!readEnv('NEXT_PUBLIC_SUPABASE_URL') || !readEnv('SUPABASE_SERVICE_ROLE_KEY')) {
    return {
      generatedAt,
      configured: false,
      quotaBytes,
      quotaSource,
      buckets: [],
      totalFiles: 0,
      totalBytes: 0,
      warningLevel: 'NORMAL',
      note:
        'Storage usage is not available: SUPABASE_SERVICE_ROLE_KEY (and/or NEXT_PUBLIC_SUPABASE_URL) is not set on this deployment.',
    };
  }

  const supabase = createServiceRoleClient();
  const buckets: StorageBucketUsage[] = [];
  let totalFiles = 0;
  let totalBytes = 0;

  for (const bucket of STORAGE_BUCKETS) {
    const files: StorageFileEntry[] = [];
    const state = { totalBytes: 0, truncated: false };
    try {
      await walk(supabase, bucket, '', files, state);
    } catch {
      // Bucket missing or listing failed — report what we have.
      state.truncated = true;
    }

    const largestFiles = [...files]
      .sort((a, b) => b.size - a.size)
      .slice(0, 5)
      .map(({ name, size, updatedAt }) => ({ name, size, createdAt: null, updatedAt }));

    const recentUploads = [...files]
      .filter((f) => f.createdAt !== null)
      .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
      .slice(0, 5);

    buckets.push({
      bucket,
      fileCount: files.length,
      totalBytes: state.totalBytes,
      largestFiles,
      recentUploads,
      truncated: state.truncated,
    });

    totalFiles += files.length;
    totalBytes += state.totalBytes;
  }

  return {
    generatedAt,
    configured: true,
    quotaBytes,
    quotaSource,
    buckets,
    totalFiles,
    totalBytes,
    warningLevel: warningLevelFor(totalBytes, quotaBytes),
    note:
      'File counts/sizes are approximate (bucket listing is capped). Total capacity is not exposed by the Supabase Storage API — the warning level is derived from the quota below; confirm the real quota on the Supabase dashboard.',
  };
}
