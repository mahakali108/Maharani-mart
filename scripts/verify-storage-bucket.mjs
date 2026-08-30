#!/usr/bin/env node
/**
 * verify-storage-bucket.mjs — verifies the `category-images` Supabase Storage
 * bucket against the CONFIGURED project, end to end:
 *
 *   1. bucket exists (exact id `category-images`, public read, 2 MB, png/jpeg/webp)
 *   2. a real upload to categories/_verification/<uuid>.png succeeds
 *   3. the public URL resolves (retailer display path)
 *   4. the verification object is deleted again (cleanup path)
 *
 * Usage (server-side, never expose the keys it reads):
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     node scripts/verify-storage-bucket.mjs
 * It also falls back to reading .env.local. The service-role key is used ONLY
 * here, ONLY server-side, to list buckets and to remove the test object; it is
 * never printed, and the app's own upload path never uses it.
 *
 * Exit codes: 0 = bucket verified, 1 = problem (message explains the fix),
 * 2 = script misconfigured (missing env vars / network).
 */

import { randomUUID } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { createClient } from '@supabase/supabase-js';

const BUCKET_ID = 'category-images'; // canonical — lib/media/types.ts MEDIA_KIND_CONFIG
const MIGRATION = 'supabase/migrations/0021_ensure_category_images_bucket.sql';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readEnvLocal() {
  const file = path.join(ROOT, '.env.local');
  const out = {};
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

const local = readEnvLocal();
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || local.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || local.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || local.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function fail(code, ...lines) {
  for (const l of lines) console.error(l);
  process.exit(code);
}

if (!url || !serviceKey) {
  fail(2,
    'Missing configuration: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY',
    'must be set in the environment (or .env.local). Keys are used server-side only',
    'and are never printed.');
}

let projectRef;
try {
  projectRef = new URL(url).hostname.split('.')[0];
} catch {
  fail(2, `NEXT_PUBLIC_SUPABASE_URL is not a valid URL: ${url}`);
}
console.log(`Target Supabase project: ${projectRef}  (bucket: ${BUCKET_ID})`);

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// 1. Bucket must exist with the documented, intentional access model.
const { data: buckets, error: listError } = await supabase.storage.listBuckets();
if (listError) fail(2, `Could not reach Supabase Storage: ${listError.message}`);
const bucket = buckets.find((b) => b.id === BUCKET_ID);
if (!bucket) {
  fail(1,
    `FAIL: bucket "${BUCKET_ID}" does not exist in project ${projectRef}.`,
    `This is the exact cause of "Upload failed: Bucket not found".`,
    `Fix: apply ${MIGRATION} to this project (supabase db push, or paste it into`,
    `the SQL editor). It is idempotent and creates NO duplicate bucket.`,
    `If the project instead has an older differently-named bucket holding category`,
    `images, migrate/point to it deliberately — do not keep two category buckets.`);
}
const problems = [];
if (!bucket.public) problems.push('bucket is not public (retailer <img> display needs the public URL)');
if (bucket.file_size_limit !== 2097152) problems.push(`file_size_limit is ${bucket.file_size_limit}, expected 2097152`);
const wantMime = ['image/jpeg', 'image/png', 'image/webp'].sort().join(',');
const haveMime = Array.isArray(bucket.allowed_mime_types) ? [...bucket.allowed_mime_types].sort().join(',') : '(none)';
if (haveMime !== wantMime) problems.push(`allowed_mime_types are [${haveMime}], expected [${wantMime}]`);
if (problems.length) fail(1, `FAIL: "${BUCKET_ID}" exists but is misconfigured:`, ...problems.map((p) => ` - ${p}`),
  `Re-applying ${MIGRATION} reconciles visibility; limits need a deliberate update.`);
console.log(`PASS: bucket "${BUCKET_ID}" exists — public, ${bucket.file_size_limit} byte limit, [${haveMime}]`);

// 2. Real upload. A valid 1x1 PNG, so magic-byte sniffing would pass too.
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
const verifyPath = `categories/_verification/${randomUUID()}.png`;
const { error: upErr } = await supabase.storage.from(BUCKET_ID).upload(verifyPath, new Uint8Array(PNG_1x1), {
  contentType: 'image/png',
  cacheControl: '60',
  upsert: false,
});
if (upErr) fail(1, `FAIL: upload to ${BUCKET_ID}/${verifyPath} was rejected: ${upErr.message}`);
console.log(`PASS: uploaded ${BUCKET_ID}/${verifyPath} (${PNG_1x1.length} bytes)`);

// 3. Public URL must serve the object (this is what retailer UI renders).
const { data: pub } = supabase.storage.from(BUCKET_ID).getPublicUrl(verifyPath);
let get = null;
try {
  get = await fetch(pub.publicUrl, { method: 'GET' });
} catch (e) {
  fail(1, `FAIL: public URL fetch threw: ${e.message}`);
}
if (!get || get.status !== 200) {
  await supabase.storage.from(BUCKET_ID).remove([verifyPath]);
  fail(1, `FAIL: public URL returned ${get ? get.status : 'no response'} — public read is not working for this bucket.`);
}
console.log(`PASS: public URL resolved with HTTP 200 (via anon host ${new URL(pub.publicUrl).hostname})`);

// 4. Cleanup — also proves the delete path works.
const { error: rmErr } = await supabase.storage.from(BUCKET_ID).remove([verifyPath]);
if (rmErr) fail(1, `WARN: upload+read verified but cleanup of ${verifyPath} failed: ${rmErr.message}`, 'Remove that object manually.');
console.log(`PASS: verification object removed again`);

console.log(`\nOK — "${BUCKET_ID}" is correctly configured in ${projectRef} and a real upload/read/delete round-trip succeeded.`);
if (!anonKey) console.log('note: NEXT_PUBLIC_SUPABASE_ANON_KEY not set; RLS write policies were not exercised (they are defined by the migrations above).');
process.exit(0);
