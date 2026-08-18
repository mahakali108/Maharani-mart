/**
 * Copy existing Supabase Storage files into Firebase Storage and update
 * only the matching Postgres image/path columns.
 *
 * Usage:
 *   npx tsx scripts/migrate-supabase-storage-to-firebase.ts --dry-run
 *   npx tsx scripts/migrate-supabase-storage-to-firebase.ts
 *
 * Required env (never commit real values):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   FIREBASE_ADMIN_PROJECT_ID
 *   FIREBASE_ADMIN_CLIENT_EMAIL
 *   FIREBASE_ADMIN_PRIVATE_KEY
 *   NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET  (or FIREBASE_ADMIN_STORAGE_BUCKET)
 *
 * Does NOT delete any Supabase object.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';

type Kind = 'product' | 'brand' | 'category' | 'banner' | 'avatar' | 'document';

interface Job {
  kind: Kind;
  table: string;
  idColumn: string;
  column: string;
  id: string;
  ownerId: string;
  stored: string;
}

function loadDotEnv() {
  const path = resolve(process.cwd(), '.env.local');
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

function argFlag(name: string): boolean {
  return process.argv.includes(name);
}

function isHttp(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function isAlreadyFirebase(value: string): boolean {
  return (
    value.startsWith('products/') ||
    value.startsWith('brands/') ||
    value.startsWith('categories/') ||
    value.startsWith('banners/') ||
    value.startsWith('retailers/') ||
    value.includes('firebasestorage.googleapis.com') ||
    value.includes('firebasestorage.app')
  );
}

function targetPath(job: Job, filename: string): string {
  switch (job.kind) {
    case 'product':
      return `products/${job.ownerId}/gallery/${filename}`;
    case 'brand':
      return `brands/${job.ownerId}/${filename}`;
    case 'category':
      return `categories/${job.ownerId}/${filename}`;
    case 'banner':
      return `banners/${job.ownerId}/${filename}`;
    case 'avatar':
      return `retailers/${job.ownerId}/profile/${filename}`;
    case 'document':
      return `retailers/${job.ownerId}/documents/${filename}`;
  }
}

function filenameFromStored(stored: string, fallback: string): string {
  try {
    const url = new URL(stored);
    const last = url.pathname.split('/').filter(Boolean).pop();
    if (last) return decodeURIComponent(last).replace(/[^a-zA-Z0-9._-]/g, '-');
  } catch {
    const last = stored.split('/').filter(Boolean).pop();
    if (last) return last.replace(/[^a-zA-Z0-9._-]/g, '-');
  }
  return fallback;
}

function supabaseObjectFromPublicUrl(stored: string): { bucket: string; path: string } | null {
  const match = stored.match(/\/storage\/v1\/object\/(?:public|sign)\/([^/]+)\/(.+?)(?:\?|$)/);
  if (!match?.[1] || !match[2]) return null;
  return { bucket: match[1], path: decodeURIComponent(match[2]) };
}

async function main() {
  loadDotEnv();
  const dryRun = argFlag('--dry-run');

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n');
  const bucketName = process.env.FIREBASE_ADMIN_STORAGE_BUCKET || process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;

  const missing: string[] = [];
  if (!supabaseUrl) missing.push('NEXT_PUBLIC_SUPABASE_URL');
  if (!serviceKey) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (!projectId) missing.push('FIREBASE_ADMIN_PROJECT_ID');
  if (!clientEmail) missing.push('FIREBASE_ADMIN_CLIENT_EMAIL');
  if (!privateKey) missing.push('FIREBASE_ADMIN_PRIVATE_KEY');
  if (!bucketName) missing.push('NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET');

  if (missing.length > 0) {
    console.error('Live file migration cannot run. Missing credentials:');
    for (const key of missing) console.error(`  - ${key}`);
    console.error('Fill .env.local (see .env.local.example) and re-run. No database rows were changed.');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl!, serviceKey!, { auth: { persistSession: false, autoRefreshToken: false } });
  if (!getApps().length) {
    initializeApp({
      credential: cert({ projectId: projectId!, clientEmail: clientEmail!, privateKey: privateKey! }),
      storageBucket: bucketName,
    });
  }
  const bucket = getStorage().bucket(bucketName);

  const jobs: Job[] = [];

  const { data: productImages, error: productErr } = await supabase
    .from('product_images')
    .select('id, product_id, image_url');
  if (productErr) throw productErr;
  for (const row of productImages ?? []) {
    if (!row.image_url) continue;
    jobs.push({
      kind: 'product',
      table: 'product_images',
      idColumn: 'id',
      column: 'image_url',
      id: row.id,
      ownerId: row.product_id,
      stored: row.image_url,
    });
  }

  const { data: banners, error: bannerErr } = await supabase.from('banners').select('id, image_url');
  if (bannerErr) throw bannerErr;
  for (const row of banners ?? []) {
    if (!row.image_url) continue;
    jobs.push({
      kind: 'banner',
      table: 'banners',
      idColumn: 'id',
      column: 'image_url',
      id: row.id,
      ownerId: row.id,
      stored: row.image_url,
    });
  }

  const { data: brands, error: brandErr } = await supabase.from('brands').select('id, logo_url');
  if (brandErr) throw brandErr;
  for (const row of brands ?? []) {
    if (!row.logo_url) continue;
    jobs.push({
      kind: 'brand',
      table: 'brands',
      idColumn: 'id',
      column: 'logo_url',
      id: row.id,
      ownerId: row.id,
      stored: row.logo_url,
    });
  }

  const { data: categories, error: categoryErr } = await supabase.from('categories').select('id, image_url');
  if (categoryErr) throw categoryErr;
  for (const row of categories ?? []) {
    if (!row.image_url) continue;
    jobs.push({
      kind: 'category',
      table: 'categories',
      idColumn: 'id',
      column: 'image_url',
      id: row.id,
      ownerId: row.id,
      stored: row.image_url,
    });
  }

  const { data: profiles, error: profileErr } = await supabase.from('profiles').select('id, avatar_url');
  if (profileErr) throw profileErr;
  for (const row of profiles ?? []) {
    if (!row.avatar_url) continue;
    jobs.push({
      kind: 'avatar',
      table: 'profiles',
      idColumn: 'id',
      column: 'avatar_url',
      id: row.id,
      ownerId: row.id,
      stored: row.avatar_url,
    });
  }

  const { data: documents, error: docErr } = await supabase.from('retailer_documents').select('id, retailer_id, file_url');
  if (docErr) throw docErr;
  for (const row of documents ?? []) {
    if (!row.file_url) continue;
    jobs.push({
      kind: 'document',
      table: 'retailer_documents',
      idColumn: 'id',
      column: 'file_url',
      id: row.id,
      ownerId: row.retailer_id,
      stored: row.file_url,
    });
  }

  console.log(`Found ${jobs.length} image/file reference(s) in Postgres.`);
  if (dryRun) console.log('Dry run — no files will be copied and no rows will be updated.\n');

  let copied = 0;
  let skipped = 0;
  let failed = 0;

  for (const job of jobs) {
    if (isAlreadyFirebase(job.stored)) {
      skipped += 1;
      console.log(`skip already-firebase ${job.table}.${job.column} ${job.id}`);
      continue;
    }

    const filename = filenameFromStored(job.stored, `${job.id}`);
    const dest = targetPath(job, `${Date.now()}-${filename}`);
    console.log(`${dryRun ? 'would-copy' : 'copy'} ${job.table}/${job.id} -> ${dest}`);

    if (dryRun) continue;

    try {
      let bytes: ArrayBuffer;
      let contentType = 'application/octet-stream';

      if (isHttp(job.stored)) {
        const response = await fetch(job.stored);
        if (!response.ok) throw new Error(`download failed (${response.status})`);
        bytes = await response.arrayBuffer();
        contentType = response.headers.get('content-type') ?? contentType;
      } else {
        const parsed = supabaseObjectFromPublicUrl(job.stored);
        const bucketId = parsed?.bucket ?? (job.kind === 'document' ? 'retailer-documents' : undefined);
        const objectPath = parsed?.path ?? job.stored;
        if (!bucketId) throw new Error('cannot infer Supabase bucket');
        const { data, error } = await supabase.storage.from(bucketId).download(objectPath);
        if (error || !data) throw new Error(error?.message ?? 'download failed');
        bytes = await data.arrayBuffer();
        contentType = data.type || contentType;
      }

      const file = bucket.file(dest);
      await file.save(Buffer.from(bytes), {
        resumable: false,
        metadata: { contentType, metadata: { migratedFrom: job.stored, table: job.table } },
      });
      const [exists] = await file.exists();
      if (!exists) throw new Error('upload verification failed');

      const { error: updateError } = await supabase.from(job.table).update({ [job.column]: dest }).eq(job.idColumn, job.id);
      if (updateError) throw updateError;
      copied += 1;
    } catch (error) {
      failed += 1;
      console.error(`FAIL ${job.table}/${job.id}:`, error instanceof Error ? error.message : error);
    }
  }

  console.log(`\nDone. copied=${copied} skipped=${skipped} failed=${failed} dryRun=${dryRun}`);
  console.log('Original Supabase files were not deleted.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
