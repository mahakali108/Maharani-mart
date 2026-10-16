/**
 * Financial proof retention hold (0059): no proof or catalog bucket is
 * eligible for automated cleanup while owner/CA retention is unapproved.
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
const OLD = '2026-01-01T00:00:00Z'; // ~9 months before NOW, still protected

describe('storage bucket classification', () => {
  it('classifies product images and catalog media as permanent', () => {
    for (const bucket of ['product-images', 'brand-logos', 'category-images', 'banners', 'avatars', 'retailer-documents']) {
      expect(classifyStorageBucket(bucket), bucket).toBe('permanent');
    }
  });

  it('places both proof buckets on permanent hold; the sweeper has no targets', () => {
    expect(classifyStorageBucket('delivery-proofs')).toBe('permanent');
    expect(classifyStorageBucket('payment-proofs')).toBe('permanent');
    expect(storageBucketPolicy('delivery-proofs')?.retentionDays).toBeUndefined();
    expect(storageBucketPolicy('payment-proofs')?.retentionDays).toBeUndefined();
    expect(temporaryStorageBuckets()).toEqual([]);
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

  it('never qualifies financial evidence by age, even when nine months old', () => {
    expect(isEligibleTemporaryStorageObject('delivery-proofs', OLD, NOW)).toBe(false);
    expect(isEligibleTemporaryStorageObject('payment-proofs', OLD, NOW)).toBe(false);
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

  it('refuses an aged delivery proof without scanning or deleting it', async () => {
    const storage = fakeStorage({
      'delivery-proofs:': [{ name: 'old.jpg', id: 'f1', created_at: OLD }],
    });
    const result = await sweepTemporaryStorageBucket(storage, 'delivery-proofs', { now: NOW });
    expect(result.error).toMatch(/not classified temporary/i);
    expect(result.scanned).toBe(0);
    expect(result.deleted).toBe(0);
    expect(storage.removed).toEqual([]);
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

  it('refuses payment-proof deletion even with an explicit sweep request', async () => {
    const storage = fakeStorage({
      'payment-proofs:': Array.from({ length: 10 }, (_, i) => ({
        name: `old-${i}.jpg`, id: `f${i}`, created_at: OLD,
      })),
    });
    const result = await sweepTemporaryStorageBucket(storage, 'payment-proofs', { now: NOW, maxDeletesPerBucket: 3 });
    expect(result.error).toMatch(/not classified temporary/i);
    expect(result.deleted).toBe(0);
    expect(storage.removed).toEqual([]);
  });
});
