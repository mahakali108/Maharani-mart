import { describe, expect, it, vi } from 'vitest';
import {
  BANNER_DRAFT_BUCKET,
  BANNER_PUBLIC_BUCKET,
  promoteDraftArtwork,
  releasePromotedArtwork,
  type BannerArtworkStorage,
  type StoredObjectInfo,
} from '@/lib/admin/banner-artwork';

const ID = '8f14e45f-ceea-4a67-9a0f-1e2b3c4d5e6f';
const DESKTOP = `banners/${ID}/${ID}.webp`;
const MOBILE = `banners/${ID}/0b7c1d2e-3f40-4a5b-8c9d-0e1f2a3b4c5d.jpg`;

interface FakeOptions {
  /** Objects that exist at the start, keyed `bucket::path`. */
  objects?: Array<{ bucket: string; path: string; size?: number; mimetype?: string }>;
  /** Force `copy` to fail for these source paths. */
  failCopy?: string[];
  /** Force `list` to fail for these buckets. */
  failList?: string[];
  /** Force `remove` to fail for these paths. */
  failRemove?: string[];
  /** When false, a failed copy leaves no destination behind (the common case). */
  copyLeavesDestination?: boolean;
}

function fakeStorage(options: FakeOptions = {}) {
  const objects = new Map<string, StoredObjectInfo>();
  for (const object of options.objects ?? []) {
    objects.set(`${object.bucket}::${object.path}`, {
      name: object.path.split('/').pop()!,
      size: object.size ?? 1024,
      mimetype: object.mimetype ?? 'image/webp',
    });
  }

  const calls = { list: 0, copy: [] as string[], remove: [] as string[] };

  const storage: BannerArtworkStorage = {
    async list(bucket, folder, search) {
      calls.list += 1;
      if (options.failList?.includes(bucket)) return { ok: false, message: 'list denied' };
      const prefix = folder === '' ? '' : `${folder}/`;
      return [...objects.entries()]
        .filter(([key]) => key.startsWith(`${bucket}::`))
        .map(([key, value]) => ({ path: key.slice(bucket.length + 2), info: value }))
        .filter((entry) => entry.path.startsWith(prefix))
        .filter((entry) => entry.info.name.startsWith(search))
        .map((entry) => entry.info);
    },
    async copy(fromBucket, path, toBucket) {
      calls.copy.push(`${fromBucket}->${toBucket}:${path}`);
      if (options.failCopy?.includes(path)) {
        // A conflicting destination that already exists stays untouched.
        return { ok: false, message: 'The resource already exists' };
      }
      const source = objects.get(`${fromBucket}::${path}`);
      if (!source) return { ok: false, message: 'not found' };
      objects.set(`${toBucket}::${path}`, { ...source });
      return { ok: true };
    },
    async remove(bucket, path) {
      calls.remove.push(`${bucket}:${path}`);
      if (options.failRemove?.includes(path)) return { ok: false };
      objects.delete(`${bucket}::${path}`);
      return { ok: true };
    },
    publicUrl(bucket, path) {
      return `https://proj.supabase.co/storage/v1/object/public/${bucket}/${path}`;
    },
  };

  return {
    storage,
    calls,
    has: (bucket: string, path: string) => objects.has(`${bucket}::${path}`),
    put: (bucket: string, path: string, size = 1024, mimetype = 'image/webp') =>
      objects.set(`${bucket}::${path}`, { name: path.split('/').pop()!, size, mimetype }),
  };
}

const EMPTY_INPUT = {
  draftImagePath: null,
  draftImageMobilePath: null,
  existingImageUrl: null,
  existingImageMobileUrl: null,
};

describe('promoteDraftArtwork — publishing with no pending draft', () => {
  it('keeps the artwork that is already live and copies nothing', async () => {
    const fake = fakeStorage();
    const result = await promoteDraftArtwork(
      { ...EMPTY_INPUT, existingImageUrl: 'https://cdn/banners/old.webp' },
      fake.storage,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.imageUrl).toBe('https://cdn/banners/old.webp');
      expect(result.created).toEqual([]);
    }
    expect(fake.calls.copy).toEqual([]);
  });

  it('refuses to publish a banner that has no artwork at all', async () => {
    const fake = fakeStorage();
    const result = await promoteDraftArtwork(EMPTY_INPUT, fake.storage);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('NO_ARTWORK');
      expect(result.created).toEqual([]);
    }
    expect(fake.calls.copy).toEqual([]);
  });
});

describe('promoteDraftArtwork — happy path', () => {
  it('copies the draft into the public bucket under the SAME object path', async () => {
    const fake = fakeStorage({ objects: [{ bucket: BANNER_DRAFT_BUCKET, path: DESKTOP }] });

    const result = await promoteDraftArtwork({ ...EMPTY_INPUT, draftImagePath: DESKTOP }, fake.storage);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.imageUrl).toBe(
        `https://proj.supabase.co/storage/v1/object/public/${BANNER_PUBLIC_BUCKET}/${DESKTOP}`,
      );
      expect(result.created).toEqual([{ bucket: BANNER_PUBLIC_BUCKET, path: DESKTOP }]);
      expect(result.adopted).toEqual([]);
    }
    expect(fake.has(BANNER_PUBLIC_BUCKET, DESKTOP)).toBe(true);
    // The draft object is left in place: unpublishing must not lose it.
    expect(fake.has(BANNER_DRAFT_BUCKET, DESKTOP)).toBe(true);
  });

  it('promotes the mobile rendition too and keeps the existing mobile art when no draft replaces it', async () => {
    const fake = fakeStorage({
      objects: [
        { bucket: BANNER_DRAFT_BUCKET, path: DESKTOP, mimetype: 'image/webp' },
        { bucket: BANNER_DRAFT_BUCKET, path: MOBILE, mimetype: 'image/jpeg' },
      ],
    });

    const result = await promoteDraftArtwork(
      { ...EMPTY_INPUT, draftImagePath: DESKTOP, draftImageMobilePath: MOBILE },
      fake.storage,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.imageUrl).toContain(DESKTOP);
      expect(result.imageUrlMobile).toContain(MOBILE);
      expect(result.created).toHaveLength(2);
    }
  });
});

describe('promoteDraftArtwork — validation fails closed', () => {
  it('rejects a draft path that is really a public URL', async () => {
    const fake = fakeStorage();
    const result = await promoteDraftArtwork(
      { ...EMPTY_INPUT, draftImagePath: 'https://evil.example/banners/x.webp' },
      fake.storage,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('INVALID_DRAFT_PATH');
    expect(fake.calls.copy).toEqual([]);
  });

  it('rejects a draft path that is already missing from the private bucket', async () => {
    const fake = fakeStorage();
    const result = await promoteDraftArtwork({ ...EMPTY_INPUT, draftImagePath: DESKTOP }, fake.storage);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('SOURCE_MISSING');
    expect(fake.calls.copy).toEqual([]);
  });
});

describe('promoteDraftArtwork — a failed copy is never assumed to be "already copied"', () => {
  it('adopts the destination ONLY when its size and type match the source', async () => {
    const fake = fakeStorage({
      objects: [
        { bucket: BANNER_DRAFT_BUCKET, path: DESKTOP, size: 2048, mimetype: 'image/webp' },
        { bucket: BANNER_PUBLIC_BUCKET, path: DESKTOP, size: 2048, mimetype: 'image/webp' },
      ],
      failCopy: [DESKTOP],
    });

    const result = await promoteDraftArtwork({ ...EMPTY_INPUT, draftImagePath: DESKTOP }, fake.storage);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.created).toEqual([]);
      expect(result.adopted).toEqual([{ bucket: BANNER_PUBLIC_BUCKET, path: DESKTOP }]);
    }
  });

  it('fails closed when the destination is a DIFFERENT object with the same path', async () => {
    const fake = fakeStorage({
      objects: [
        { bucket: BANNER_DRAFT_BUCKET, path: DESKTOP, size: 2048, mimetype: 'image/webp' },
        { bucket: BANNER_PUBLIC_BUCKET, path: DESKTOP, size: 999_999, mimetype: 'image/png' },
      ],
      failCopy: [DESKTOP],
    });

    const result = await promoteDraftArtwork({ ...EMPTY_INPUT, draftImagePath: DESKTOP }, fake.storage);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('DESTINATION_CONFLICT');
      expect(result.created).toEqual([]);
      expect(result.adopted).toEqual([]);
    }
    // The pre-existing object is untouched.
    expect(fake.calls.remove).toEqual([]);
  });

  it('fails closed when the destination cannot be verified at all', async () => {
    const fake = fakeStorage({
      objects: [{ bucket: BANNER_DRAFT_BUCKET, path: DESKTOP }],
      failCopy: [DESKTOP],
      failList: [BANNER_PUBLIC_BUCKET],
    });

    const result = await promoteDraftArtwork({ ...EMPTY_INPUT, draftImagePath: DESKTOP }, fake.storage);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('COPY_FAILED');
  });
});

describe('promoteDraftArtwork — mobile failure aborts the pair', () => {
  it('reports both renditions and the desktop copy it created so the caller can compensate', async () => {
    const fake = fakeStorage({
      objects: [
        { bucket: BANNER_DRAFT_BUCKET, path: DESKTOP },
        { bucket: BANNER_DRAFT_BUCKET, path: MOBILE, mimetype: 'image/jpeg' },
      ],
      failCopy: [MOBILE],
    });

    const result = await promoteDraftArtwork(
      { ...EMPTY_INPUT, draftImagePath: DESKTOP, draftImageMobilePath: MOBILE },
      fake.storage,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('COPY_FAILED');
      expect(result.created).toEqual([{ bucket: BANNER_PUBLIC_BUCKET, path: DESKTOP }]);
    }
  });
});

describe('promoteDraftArtwork — retry and idempotency', () => {
  it('converges on a retry after the destination was already created', async () => {
    const fake = fakeStorage({
      objects: [{ bucket: BANNER_DRAFT_BUCKET, path: DESKTOP }],
    });

    const first = await promoteDraftArtwork({ ...EMPTY_INPUT, draftImagePath: DESKTOP }, fake.storage);
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.created).toHaveLength(1);

    // Simulate the "object exists" error Supabase returns on the second copy.
    fake.calls.copy.length = 0;
    const retryStorage: BannerArtworkStorage = { ...fake.storage, copy: async () => ({ ok: false, message: 'already exists' }) };
    const second = await promoteDraftArtwork({ ...EMPTY_INPUT, draftImagePath: DESKTOP }, retryStorage);

    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.created).toEqual([]);
      expect(second.adopted).toEqual([{ bucket: BANNER_PUBLIC_BUCKET, path: DESKTOP }]);
    }
  });
});

describe('releasePromotedArtwork — compensation after a failed DB write', () => {
  it('removes only objects this attempt created, and only when unverified-safe', async () => {
    const fake = fakeStorage({ objects: [{ bucket: BANNER_PUBLIC_BUCKET, path: DESKTOP }] });

    const report = await releasePromotedArtwork(
      [{ bucket: BANNER_PUBLIC_BUCKET, path: DESKTOP }],
      fake.storage,
      { verifyUnreferenced: async () => true },
    );

    expect(report.removed).toEqual([{ bucket: BANNER_PUBLIC_BUCKET, path: DESKTOP }]);
    expect(fake.has(BANNER_PUBLIC_BUCKET, DESKTOP)).toBe(false);
  });

  it('deletes NOTHING without a verification callback', async () => {
    const fake = fakeStorage({ objects: [{ bucket: BANNER_PUBLIC_BUCKET, path: DESKTOP }] });

    const report = await releasePromotedArtwork(
      [{ bucket: BANNER_PUBLIC_BUCKET, path: DESKTOP }],
      fake.storage,
    );

    expect(report.removed).toEqual([]);
    expect(report.skipped).toEqual([{ bucket: BANNER_PUBLIC_BUCKET, path: DESKTOP }]);
    expect(fake.has(BANNER_PUBLIC_BUCKET, DESKTOP)).toBe(true);
  });

  it('keeps the object when another banner row still references it (concurrent publish)', async () => {
    const fake = fakeStorage({ objects: [{ bucket: BANNER_PUBLIC_BUCKET, path: DESKTOP }] });

    const report = await releasePromotedArtwork(
      [{ bucket: BANNER_PUBLIC_BUCKET, path: DESKTOP }],
      fake.storage,
      { verifyUnreferenced: async () => false },
    );

    expect(report.skipped).toHaveLength(1);
    expect(fake.has(BANNER_PUBLIC_BUCKET, DESKTOP)).toBe(true);
  });

  it('treats a verification error as "do not delete"', async () => {
    const fake = fakeStorage({ objects: [{ bucket: BANNER_PUBLIC_BUCKET, path: DESKTOP }] });

    const verify = vi.fn(async () => {
      throw new Error('db down');
    });
    const report = await releasePromotedArtwork(
      [{ bucket: BANNER_PUBLIC_BUCKET, path: DESKTOP }],
      fake.storage,
      { verifyUnreferenced: verify },
    );

    expect(verify).toHaveBeenCalledOnce();
    expect(report.skipped).toHaveLength(1);
    expect(report.removed).toEqual([]);
  });

  it('reports a failed removal without throwing', async () => {
    const fake = fakeStorage({
      objects: [{ bucket: BANNER_PUBLIC_BUCKET, path: DESKTOP }],
      failRemove: [DESKTOP],
    });

    const report = await releasePromotedArtwork(
      [{ bucket: BANNER_PUBLIC_BUCKET, path: DESKTOP }],
      fake.storage,
      { verifyUnreferenced: async () => true },
    );

    expect(report.failed).toHaveLength(1);
    expect(fake.has(BANNER_PUBLIC_BUCKET, DESKTOP)).toBe(true);
  });
});
