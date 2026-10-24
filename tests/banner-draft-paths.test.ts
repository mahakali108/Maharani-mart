import { describe, expect, it } from 'vitest';
import {
  DRAFT_BANNER_PATH_RE,
  draftBannerOwner,
  isDraftBannerPath,
  isSafeObjectPath,
  isSignedStorageUrl,
  isRenderableMediaRef,
} from '@/lib/media/refs';

const ID = '8f14e45f-ceea-4a67-9a0f-1e2b3c4d5e6f';
const ID2 = '0b7c1d2e-3f40-4a5b-8c9d-0e1f2a3b4c5d';

describe('private banner draft paths', () => {
  it('accepts exactly the paths buildMediaPath() produces', () => {
    for (const path of [
      `banners/_draft/${ID}.jpg`,
      `banners/_draft/${ID}.png`,
      `banners/_draft/${ID}.webp`,
      `banners/${ID}/${ID}.webp`,
      `banners/${ID}/${ID2}.jpg`,
    ]) {
      expect(isDraftBannerPath(path), path).toBe(true);
      expect(DRAFT_BANNER_PATH_RE.test(path), path).toBe(true);
    }
  });

  it('rejects absolute URLs — private artwork must never be stored as a public link', () => {
    for (const value of [
      `https://abc.supabase.co/storage/v1/object/public/banners/${ID}.webp`,
      `http://localhost/banners/_draft/${ID}.webp`,
      `//cdn.example.com/banners/_draft/${ID}.webp`,
    ]) {
      expect(isDraftBannerPath(value), value).toBe(false);
    }
  });

  it('rejects signed URLs, traversal and other buckets', () => {
    for (const value of [
      `https://abc.supabase.co/storage/v1/object/sign/banner-drafts/banners/_draft/${ID}.webp?token=abc`,
      `banners/../../etc/passwd`,
      `banners/_draft/../${ID}.webp`,
      `product-images/${ID}/${ID}.webp`,
      `banners/_draft/${ID}.svg`,
      `banners/_draft/${ID}`,
      `banners/${ID}/nested/${ID}.webp`,
      `Banners/_draft/${ID}.webp`,
    ]) {
      expect(isDraftBannerPath(value), value).toBe(false);
    }
  });

  it('is case-sensitive, because Storage object paths are', () => {
    expect(isDraftBannerPath(`banners/_draft/${ID.toUpperCase()}.webp`)).toBe(false);
  });

  it('rejects a path whose owner segment is malformed', () => {
    expect(isDraftBannerPath(`banners/not-a-uuid/${ID}.webp`)).toBe(false);
    expect(isDraftBannerPath(`banners/${ID.toUpperCase()}/${ID}.webp`)).toBe(false);
  });

  it('reports the owning banner id, or `_draft` before the row exists', () => {
    expect(draftBannerOwner(`banners/_draft/${ID}.webp`)).toBe('_draft');
    expect(draftBannerOwner(`banners/${ID}/${ID2}.webp`)).toBe(ID);
    expect(draftBannerOwner('https://example.com/x.webp')).toBeNull();
  });

  it('is never renderable on its own — it needs a signed URL', () => {
    expect(isRenderableMediaRef(`banners/_draft/${ID}.webp`)).toBe(false);
  });
});

describe('signed storage URL detection', () => {
  it('recognises Supabase signed URLs and any token-bearing URL', () => {
    expect(isSignedStorageUrl(`https://x.supabase.co/storage/v1/object/sign/banner-drafts/a.webp?token=1`)).toBe(true);
    expect(isSignedStorageUrl('https://example.com/a.webp?token=abc')).toBe(true);
    expect(isSignedStorageUrl('https://example.com/a.webp?x=1&token=abc')).toBe(true);
  });

  it('does not flag ordinary public URLs or object paths', () => {
    expect(isSignedStorageUrl(`https://x.supabase.co/storage/v1/object/public/banners/a.webp`)).toBe(false);
    expect(isSignedStorageUrl(`banners/_draft/${ID}.webp`)).toBe(false);
    expect(isSignedStorageUrl('')).toBe(false);
    expect(isSignedStorageUrl(null)).toBe(false);
  });
});

describe('isSafeObjectPath — last line of defence before a bucket delete', () => {
  it('accepts ordinary object paths', () => {
    expect(isSafeObjectPath(`banners/${ID}/${ID}.webp`)).toBe(true);
    expect(isSafeObjectPath('retailer-documents/abc/def.pdf')).toBe(true);
  });

  it('rejects anything that could name a different object or escape the bucket', () => {
    for (const value of [
      '',
      '/etc/passwd',
      '../x.webp',
      'a/../../b.webp',
      'a//b.webp',
      'a\\b.webp',
      'https://x.supabase.co/storage/v1/object/public/banners/a.webp',
      `https://x.supabase.co/storage/v1/object/sign/banners/a.webp?token=1`,
      ' a.webp',
      'a.webp ',
    ]) {
      expect(isSafeObjectPath(value), JSON.stringify(value)).toBe(false);
    }
    expect(isSafeObjectPath(null)).toBe(false);
    expect(isSafeObjectPath(undefined)).toBe(false);
  });
});
