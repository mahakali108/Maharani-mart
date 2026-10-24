/**
 * Storage retention classification — product images and other permanent
 * buckets are NEVER eligible for cleanup; only explicitly-temporary buckets
 * are, and only past their retention window (spec §18/§24).
 */
import { describe, expect, it } from 'vitest';
import {
  classifyStorageBucket,
  isEligibleTemporaryStorageObject,
  storageBucketPolicy,
  sweepTemporaryStorageBucket,
  temporaryStorageBuckets,
  type StorageApi,
  type StorageListFile,
} from '@/lib/retention/storage-cleanup';

const NOW = new Date('2026-09-30T12:00:00Z');
const OLD = '2026-01-01T00:00:00Z'; // ~9 months before NOW → older than 120 days
const FRESH = '2026-09-25T00:00:00Z'; // 5 days before NOW → kept

describe('storage bucket classification', () => {
  it('classifies product images and catalog media as permanent', () => {
    for (const bucket of [
      'product-images',
      'brand-logos',
      'category-images',
      'banners',
      'banner-drafts',
      'avatars',
      'retailer-documents',
    ]) {
      expect(classifyStorageBucket(bucket), bucket).toBe('permanent');
    }
  });

  it('classifies only the proof buckets as temporary with a 120-day window', () => {
    expect(classifyStorageBucket('delivery-proofs')).toBe('temporary');
    expect(classifyStorageBucket('payment-proofs')).toBe('temporary');
    expect(storageBucketPolicy('delivery-proofs')?.retentionDays).toBe(120);
    expect(storageBucketPolicy('payment-proofs')?.retentionDays).toBe(120);
    expect(temporaryStorageBuckets().map((p) => p.bucket).sort()).toEqual(['delivery-proofs', 'payment-proofs']);
  });

  it('never auto-deletes unpublished banner artwork, even across a rollback (0077)', () => {
    // Owner decision: draft artwork is preserved. Reclaiming it is a separate,
    // manually approved operation — never part of the retention cron.
    expect(classifyStorageBucket('banner-drafts')).toBe('permanent');
  });

  it('treats any unknown bucket as permanent (cleanup never guesses)', () => {
    expect(classifyStorageBucket('some-future-bucket')).toBe('permanent');
    expect(classifyStorageBucket('product-images-old')).toBe('permanent');
    expect(classifyStorageBucket('')).toBe('permanent');
  });
});

describe('object eligibility', () => {
  it('never qualifies objects from permanent buckets — even ancient product images', () => {
    expect(isEligibleTemporaryStorageObject('product-images', '2020-01-01T00:00:00Z', NOW)).toBe(false);
    expect(isEligibleTemporaryStorageObject('brand-logos', '2020-01-01T00:00:00Z', NOW)).toBe(false);
    expect(isEligibleTemporaryStorageObject('unknown-bucket', '2020-01-01T00:00:00Z', NOW)).toBe(false);
  });

  it('qualifies only temporary-bucket objects strictly older than 120 days', () => {
    expect(isEligibleTemporaryStorageObject('delivery-proofs', OLD, NOW)).toBe(true);
    expect(isEligibleTemporaryStorageObject('payment-proofs', OLD, NOW)).toBe(true);
    expect(isEligibleTemporaryStorageObject('delivery-proofs', FRESH, NOW)).toBe(false);
    expect(isEligibleTemporaryStorageObject('delivery-proofs', new Date(NOW.getTime() - 121 * 864e5), NOW)).toBe(true);
    expect(isEligibleTemporaryStorageObject('delivery-proofs', new Date(NOW.getTime() - 119 * 864e5), NOW)).toBe(false);
  });

  it('rejects unparseable timestamps instead of deleting', () => {
    expect(isEligibleTemporaryStorageObject('delivery-proofs', 'not-a-date', NOW)).toBe(false);
    expect(isEligibleTemporaryStorageObject('delivery-proofs', '', NOW)).toBe(false);
  });
});

describe('temporary bucket sweep', () => {
  function fakeStorage(files: Record<string, StorageListFile[]>): StorageApi & { removed: string[] } {
    const removed: string[] = [];
    return {
      removed,
      from(bucket: string) {
        return {
          async list(path: string) {
            return { data: files[`${bucket}:${path}`] ?? [], error: null };
          },
          async remove(paths: string[]) {
            removed.push(...paths.map((p) => `${bucket}:${p}`));
            return { data: null, error: null };
          },
        };
      },
    };
  }

  it('deletes only aged objects in temporary buckets and keeps young ones', async () => {
    const storage = fakeStorage({
      'delivery-proofs:': [{ name: 'deliveries', id: null }], // folder
      'delivery-proofs:deliveries': [{ name: 'o1', id: null }],
      'delivery-proofs:deliveries/o1': [
        { name: 'old.jpg', id: 'f1', created_at: OLD },
        { name: 'new.jpg', id: 'f2', created_at: FRESH },
      ],
    });
    const result = await sweepTemporaryStorageBucket(storage, 'delivery-proofs', { now: NOW });
    expect(result.error).toBeUndefined();
    expect(result.deleted).toBe(1);
    expect(result.kept).toBe(1);
    expect(storage.removed).toEqual(['delivery-proofs:deliveries/o1/old.jpg']);
  });

  it('refuses to sweep a permanent bucket at all', async () => {
    const storage = fakeStorage({
      'product-images:': [{ name: 'p.jpg', id: 'f1', created_at: OLD }],
    });
    const result = await sweepTemporaryStorageBucket(storage, 'product-images', { now: NOW });
    expect(result.deleted).toBe(0);
    expect(result.error).toMatch(/not classified temporary/i);
    expect(storage.removed).toEqual([]);
  });

  it('is bounded by maxDeletesPerBucket', async () => {
    const storage = fakeStorage({
      'payment-proofs:': Array.from({ length: 10 }, (_, i) => ({
        name: `old-${i}.jpg`,
        id: `f${i}`,
        created_at: OLD,
      })),
    });
    const result = await sweepTemporaryStorageBucket(storage, 'payment-proofs', { now: NOW, maxDeletesPerBucket: 3 });
    expect(result.deleted).toBe(3);
    expect(storage.removed).toHaveLength(3);
  });
});
