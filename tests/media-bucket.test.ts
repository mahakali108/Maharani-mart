import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildMediaPath } from '@/lib/media/paths';
import {
  isRenderableMediaRef,
  parseMediaRef,
  parseSupabasePublicUrl,
  resolveMediaUrl,
} from '@/lib/media/refs';
import { MEDIA_KIND_CONFIG } from '@/lib/media/types';
import { describeStorageUploadError, isMissingBucketError } from '@/lib/media/upload-error';

const ROOT = path.resolve(__dirname, '..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

const MIGRATION_0016 = read('supabase/migrations/0016_storage_paths_category_bucket.sql');
const MIGRATION_0021 = read('supabase/migrations/0021_ensure_category_images_bucket.sql');

/** Bucket ids inserted by a migration's `insert into storage.buckets` blocks. */
function insertedBucketIds(sql: string): string[] {
  const ids: string[] = [];
  const insertRe = /insert\s+into\s+storage\.buckets\s*\(([^)]*)\)\s*values\s*([\s\S]*?);/gi;
  let m: RegExpExecArray | null;
  while ((m = insertRe.exec(sql)) !== null) {
    const columns = m[1]!.split(',').map((c) => c.trim().toLowerCase());
    const idIndex = columns.indexOf('id');
    const tuples = [...m[2]!.matchAll(/\(([^)]*)\)/g)];
    for (const tuple of tuples) {
      const values = tuple[1]!.split(',').map((v) => v.trim());
      const id = values[idIndex < 0 ? 0 : idIndex] ?? '';
      const quoted = id.match(/^'([^']+)'$/);
      if (quoted) ids.push(quoted[1]!);
    }
  }
  return ids;
}

describe('category image storage bucket — single canonical name', () => {
  it('maps the category-image kind to exactly the category-images bucket (public, 2 MB, png/jpeg/webp)', () => {
    const config = MEDIA_KIND_CONFIG['category-image'];
    expect(config.bucket).toBe('category-images');
    expect(config.private).toBe(false); // retailers render the public URL
    expect(config.maxBytes).toBe(2 * 1024 * 1024);
    expect([...config.mimeTypes].sort()).toEqual(['image/jpeg', 'image/png', 'image/webp']);
  });

  it('stores category files at categories/<owner>/<uuid>.<ext> inside that bucket', () => {
    const p = buildMediaPath(
      'category-image',
      '0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f',
      '9e9e9e9e-9e9e-4e9e-8e9e-9e9e9e9e9e9e',
      'image/webp',
    );
    expect(p).toBe('categories/0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f/9e9e9e9e-9e9e-4e9e-8e9e-9e9e9e9e9e9e.webp');
  });

  it('every configured media bucket is created by the storage migrations (no code can target a phantom bucket)', () => {
    const created = new Set([
      ...insertedBucketIds(read('supabase/migrations/0003_storage_buckets.sql')),
      ...insertedBucketIds(read('supabase/migrations/0006_retailer_documents.sql')),
      ...insertedBucketIds(MIGRATION_0016),
      ...insertedBucketIds(MIGRATION_0021),
    ]);
    for (const config of Object.values(MEDIA_KIND_CONFIG)) {
      expect(created, `bucket ${config.bucket}`).toContain(config.bucket);
    }
  });

  it('0016 and 0021 both define ONLY the canonical category-images id — never a second category bucket', () => {
    expect(insertedBucketIds(MIGRATION_0016)).toEqual(['category-images']);
    expect(insertedBucketIds(MIGRATION_0021)).toEqual(['category-images']);
    // Idempotent, duplicate-safe bucket creation.
    expect(MIGRATION_0021).toMatch(/on conflict \(id\) do nothing/i);
    // The ensure-migration must not silently touch other buckets.
    expect(MIGRATION_0021).not.toMatch(/insert\s+into\s+storage\.objects/i);
    expect(MIGRATION_0021).not.toMatch(/truncate|delete\s+from/i);
  });
});

describe('category-images storage policies — minimum intentional access', () => {
  it('grants public READ and nothing more to anonymous callers', () => {
    // exactly one unconditioned select policy on the bucket
    expect(MIGRATION_0021).toMatch(
      /create policy "public_read_category_images" on storage\.objects\s+for select using \(bucket_id = 'category-images'\);/i,
    );
    // anonymous must NOT be able to insert/update/delete
    const anonymousWrites =
      /for (insert|update|delete)[^;]*bucket_id = 'category-images'(?![^;]*auth\.uid\(\))(?![^;]*is_(staff|admin)_or_above\(\))[^;]*;/i;
    expect(MIGRATION_0021).not.toMatch(anonymousWrites);
  });

  it('uploads/replace require staff+, deletion requires admin+ — matching the app authorization model', () => {
    expect(MIGRATION_0021).toMatch(
      /for insert with check \(bucket_id = 'category-images' and is_staff_or_above\(\)\)/i,
    );
    expect(MIGRATION_0021).toMatch(
      /for update using \(bucket_id = 'category-images' and is_staff_or_above\(\)\)/i,
    );
    expect(MIGRATION_0021).toMatch(
      /for delete using \(bucket_id = 'category-images' and is_admin_or_above\(\)\)/i,
    );
  });

  it('is fully idempotent: every created policy is dropped-if-exists first', () => {
    const created = [...MIGRATION_0021.matchAll(/create policy "([^"]+)"/g)].map((m) => m[1]!);
    expect(created.length).toBeGreaterThanOrEqual(4);
    for (const name of created) {
      expect(MIGRATION_0021, `drop for ${name}`).toContain(`drop policy if exists "${name}"`);
    }
    // Same policy names as 0016, so re-running converges instead of colliding.
    for (const name of created) expect(MIGRATION_0016).toContain(`"${name}"`);
  });

  it('never references the service-role key, and the app upload path uses the caller session (RLS applies)', () => {
    const sqlOnly = MIGRATION_0021.replace(/--[^\n]*/g, '');
    expect(sqlOnly).not.toMatch(/service_role|anon/i);
    const supabaseTs = read('lib/media/supabase.ts');
    expect(supabaseTs).not.toMatch(/createServiceRoleClient/);
    expect(supabaseTs).toMatch(/from\(config\.bucket\)/);
  });
});

describe('stored media references — persist permanent refs only', () => {
  it('never accepts a temporary blob: or data: URL as a stored reference', () => {
    for (const bad of [
      'blob:https://localhost/9e9e9e9e-9e9e-4e9e-8e9e-9e9e9e9e9e9e',
      'data:image/png;base64,iVBORw0KGgo=',
    ]) {
      expect(parseMediaRef(bad)).toBeNull();
      expect(resolveMediaUrl(bad)).toBeNull(); // → placeholder, not a broken <img>
      expect(isRenderableMediaRef(bad)).toBe(false); // → form validator rejects it
    }
  });

  it('round-trips Supabase public URLs to bucket+path (so replace/delete can clean up)', () => {
    const url =
      'https://abcdefghijklmno.supabase.co/storage/v1/object/public/category-images/categories/cat-1/img-1.webp';
    expect(parseSupabasePublicUrl(url)).toEqual({
      bucket: 'category-images',
      path: 'categories/cat-1/img-1.webp',
    });
    expect(resolveMediaUrl(url)).toBe(url);
  });

  it('legacy/unresolvable refs fall back to placeholders, never a crash', () => {
    expect(parseMediaRef('appwrite://bucket/file')).toBeNull();
    expect(resolveMediaUrl('   ')).toBeNull();
  });
});

describe('upload error handling — actionable message for the real failure mode', () => {
  it('classifies Supabase "Bucket not found" and points at the migration fix', () => {
    const err = Object.assign(new Error('Bucket not found'), { statusCode: '400' });
    expect(isMissingBucketError(err)).toBe(true);
    const msg = describeStorageUploadError('category-images', err);
    expect(msg).toContain('category-images');
    expect(msg).toContain('0021_ensure_category_images_bucket.sql');
    expect(msg).not.toMatch(/service/i); // never hints at keys
  });

  it('recognises the 404/InvalidBucketName shape too', () => {
    expect(isMissingBucketError({ statusCode: '404', message: 'Not Found' })).toBe(true);
    expect(isMissingBucketError({ message: 'Bucket not found' })).toBe(true);
  });

  it('passes every other Storage failure through unchanged', () => {
    const dup = Object.assign(new Error('The resource already exists'), { statusCode: '409' });
    expect(isMissingBucketError(dup)).toBe(false);
    expect(describeStorageUploadError('category-images', dup)).toBe(
      'Upload failed: The resource already exists',
    );
    expect(describeStorageUploadError('category-images', null)).toBe(
      'Upload failed: Storage rejected the upload.',
    );
  });

  it('the upload primitive keeps RLS in force: upsert:false, server-UUID path, no caller path', () => {
    const supabaseTs = read('lib/media/supabase.ts');
    expect(supabaseTs).toMatch(/upsert:\s*false/);
    expect(supabaseTs).toMatch(/buildMediaPath\(input\.kind,\s*input\.ownerId,\s*fileId/);
  });
});
