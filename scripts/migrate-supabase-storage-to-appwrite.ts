/**
 * Copy existing Supabase Storage files into Appwrite and repoint the database
 * columns at the new `appwrite://<bucket>/<fileId>` references.
 *
 * ---------------------------------------------------------------------------
 * SAFETY PROPERTIES (do not remove):
 *
 *   • Supabase Storage files are NEVER deleted. Not by this script, not by any
 *     flag. Cleanup is a deliberate, manual operation performed by an operator
 *     once the migration has been verified in production.
 *   • Nothing is written unless `--apply` is passed. The default is a dry run.
 *   • Every copy is verified (byte length re-read from Appwrite) BEFORE the DB
 *     column is updated. A failed verification leaves the row untouched, so
 *     the old Supabase URL keeps rendering.
 *   • Rows that already hold an `appwrite://` reference are skipped, so the
 *     script is idempotent and safe to re-run after a partial failure.
 *   • Uses the Supabase service-role key, so it must only ever be run from a
 *     trusted machine / CI secret — never from the browser or a client build.
 *
 * ---------------------------------------------------------------------------
 * USAGE
 *
 *   # Report what would change (default, writes nothing):
 *   npx tsx scripts/migrate-supabase-storage-to-appwrite.ts --dry-run
 *
 *   # Migrate one table at a time, smallest first:
 *   npx tsx scripts/migrate-supabase-storage-to-appwrite.ts --apply --only=banners
 *   npx tsx scripts/migrate-supabase-storage-to-appwrite.ts --apply --only=brands
 *   npx tsx scripts/migrate-supabase-storage-to-appwrite.ts --apply --only=categories
 *   npx tsx scripts/migrate-supabase-storage-to-appwrite.ts --apply --only=product_images
 *   npx tsx scripts/migrate-supabase-storage-to-appwrite.ts --apply --only=profiles
 *   npx tsx scripts/migrate-supabase-storage-to-appwrite.ts --apply --only=retailer_documents
 *
 *   # Everything, with a cap while you watch the first batch:
 *   npx tsx scripts/migrate-supabase-storage-to-appwrite.ts --apply --limit=25
 *
 * Required env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 *               APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY,
 *               APPWRITE_STORAGE_BUCKET_ID (legacy alias: APPWRITE_BUCKET_ID),
 *               APPWRITE_PRIVATE_BUCKET_ID
 *
 * `tsx` is not a project dependency — run it with `npx tsx`, or compile the
 * file first. Keeping it out of package.json avoids shipping a dev-only tool
 * into the application build.
 */

import { randomUUID } from 'node:crypto';

import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { Client as AppwriteClient, ID, Permission, Role, Storage } from 'node-appwrite';

// ---------------------------------------------------------------------------
// Migration plan: one entry per (bucket → table.column) pair.
// Mirrors the inventory table in docs/storage_audit.md.
// ---------------------------------------------------------------------------

interface MigrationTarget {
  /** `--only=` selector. */
  name: string;
  /** Supabase Storage bucket the current files live in. */
  bucket: string;
  /** Table + column holding the reference. */
  table: string;
  idColumn: string;
  column: string;
  /** Private media goes to the private Appwrite bucket with no public read. */
  private: boolean;
  /** Logical Appwrite path prefix, given the row id. */
  folder: (rowId: string) => string;
}

const TARGETS: MigrationTarget[] = [
  {
    name: 'product_images',
    bucket: 'product-images',
    table: 'product_images',
    idColumn: 'id',
    column: 'image_url',
    private: false,
    folder: (id) => `products/${id}/gallery`,
  },
  {
    name: 'banners',
    bucket: 'banners',
    table: 'banners',
    idColumn: 'id',
    column: 'image_url',
    private: false,
    folder: (id) => `banners/${id}`,
  },
  {
    name: 'brands',
    bucket: 'brand-logos',
    table: 'brands',
    idColumn: 'id',
    column: 'logo_url',
    private: false,
    folder: (id) => `brands/${id}`,
  },
  {
    name: 'categories',
    bucket: 'product-images',
    table: 'categories',
    idColumn: 'id',
    column: 'image_url',
    private: false,
    folder: (id) => `categories/${id}`,
  },
  {
    name: 'profiles',
    bucket: 'avatars',
    table: 'profiles',
    idColumn: 'id',
    column: 'avatar_url',
    private: false,
    folder: (id) => `retailers/${id}/profile`,
  },
  {
    name: 'retailer_documents',
    bucket: 'retailer-documents',
    table: 'retailer_documents',
    idColumn: 'id',
    column: 'file_url',
    private: true,
    folder: (id) => `retailers/${id}/documents`,
  },
];

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface Options {
  apply: boolean;
  only: string | null;
  limit: number | null;
}

function parseArgs(argv: string[]): Options {
  const apply = argv.includes('--apply');
  const onlyArg = argv.find((a) => a.startsWith('--only='));
  const limitArg = argv.find((a) => a.startsWith('--limit='));

  if (argv.includes('--delete') || argv.includes('--purge')) {
    console.error(
      'Refusing to run: this script never deletes Supabase Storage files. ' +
        'Remove old objects manually after verifying the migration.',
    );
    process.exit(1);
  }

  return {
    apply,
    only: onlyArg ? (onlyArg.split('=')[1] ?? null) : null,
    limit: limitArg ? Number(limitArg.split('=')[1]) : null,
  };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value.trim();
}

const APPWRITE_REF_PREFIX = 'appwrite://';

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'application/pdf': 'pdf',
};

/**
 * Turn a stored column value into the Supabase object path inside `bucket`.
 * Handles both full public URLs and bare object paths, and returns `null` for
 * values that are already migrated or otherwise not ours to touch.
 */
function toObjectPath(value: string, bucket: string): string | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  if (trimmed.startsWith(APPWRITE_REF_PREFIX)) return null; // already migrated

  if (/^https?:\/\//i.test(trimmed)) {
    const marker = `/storage/v1/object/public/${bucket}/`;
    const index = trimmed.indexOf(marker);
    if (index === -1) return null; // external URL — leave alone
    return decodeURIComponent(trimmed.slice(index + marker.length).split('?')[0] ?? '');
  }

  // Bare object path (how retailer_documents.file_url is stored).
  return trimmed.replace(/^\/+/, '');
}

// ---------------------------------------------------------------------------

interface Stats {
  scanned: number;
  skipped: number;
  migrated: number;
  failed: number;
}

/**
 * Set once in `main()`. Module-scoped rather than passed around because the
 * generated Supabase types make the client generics awkward to thread through
 * a function signature, and this file is a single-run CLI, not a library.
 */
let supabase: ReturnType<typeof createSupabaseClient>;
let storage: Storage;

async function migrateTarget(
  target: MigrationTarget,
  options: Options,
  buckets: { publicBucketId: string; privateBucketId: string },
): Promise<Stats> {
  const stats: Stats = { scanned: 0, skipped: 0, migrated: 0, failed: 0 };
  const appwriteBucket = target.private ? buckets.privateBucketId : buckets.publicBucketId;

  console.log(`\n── ${target.name}: ${target.bucket} → ${appwriteBucket} (${target.table}.${target.column})`);

  const query = supabase
    .from(target.table)
    .select(`${target.idColumn}, ${target.column}`)
    .not(target.column, 'is', null);

  const { data: rows, error } = await (options.limit ? query.limit(options.limit) : query);

  if (error) {
    console.error(`   ! could not read ${target.table}: ${error.message}`);
    stats.failed += 1;
    return stats;
  }

  for (const row of (rows ?? []) as Record<string, string | null>[]) {
    stats.scanned += 1;

    const rowId = row[target.idColumn];
    const current = row[target.column];
    if (!rowId || typeof current !== 'string') {
      stats.skipped += 1;
      continue;
    }

    const objectPath = toObjectPath(current, target.bucket);
    if (!objectPath) {
      stats.skipped += 1;
      continue;
    }

    // 1. COPY — download the object from Supabase Storage.
    const { data: blob, error: downloadError } = await supabase.storage
      .from(target.bucket)
      .download(objectPath);

    if (downloadError || !blob) {
      console.error(`   ! ${rowId}: download failed (${objectPath}) — ${downloadError?.message ?? 'no data'}`);
      stats.failed += 1;
      continue;
    }

    const bytes = Buffer.from(await blob.arrayBuffer());
    const mimeType = blob.type || 'application/octet-stream';
    const ext = EXT_BY_MIME[mimeType] ?? (objectPath.split('.').pop() ?? 'bin').toLowerCase();
    const fileId = randomUUID();
    const logicalPath = `${target.folder(rowId)}/${fileId}.${ext}`;
    const ref = `${APPWRITE_REF_PREFIX}${appwriteBucket}/${fileId}`;

    if (!options.apply) {
      console.log(`   • ${rowId}: would copy ${objectPath} (${bytes.length} B) → ${logicalPath}`);
      stats.migrated += 1;
      continue;
    }

    // 2. UPLOAD to Appwrite with the same permission model as the live app.
    try {
      const payload = new File([new Uint8Array(bytes)], `${fileId}.${ext}`, { type: mimeType });
      await storage.createFile(
        appwriteBucket,
        ID.custom(fileId),
        payload,
        target.private ? [] : [Permission.read(Role.any())],
      );
    } catch (uploadError) {
      const message = uploadError instanceof Error ? uploadError.message : String(uploadError);
      console.error(`   ! ${rowId}: Appwrite upload failed — ${message}`);
      stats.failed += 1;
      continue;
    }

    // 3. VERIFY the copy landed intact before touching the database.
    try {
      const stored = await storage.getFile(appwriteBucket, fileId);
      if (stored.sizeOriginal !== bytes.length) {
        console.error(
          `   ! ${rowId}: size mismatch (source ${bytes.length} B, stored ${stored.sizeOriginal} B) — DB left unchanged`,
        );
        stats.failed += 1;
        continue;
      }
    } catch (verifyError) {
      const message = verifyError instanceof Error ? verifyError.message : String(verifyError);
      console.error(`   ! ${rowId}: verification failed — ${message} — DB left unchanged`);
      stats.failed += 1;
      continue;
    }

    // 4. UPDATE the reference. The Supabase Storage object stays where it is.
    const { error: updateError } = await supabase
      .from(target.table)
      // The generated schema types don't cover a dynamic column name; the
      // value is a plain string and the column is validated by TARGETS above.
      .update({ [target.column]: ref } as never)
      .eq(target.idColumn, rowId);

    if (updateError) {
      console.error(`   ! ${rowId}: DB update failed — ${updateError.message}`);
      stats.failed += 1;
      continue;
    }

    console.log(`   ✓ ${rowId}: ${objectPath} → ${ref}`);
    stats.migrated += 1;
  }

  return stats;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  supabase = createSupabaseClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false } },
  );

  const appwrite = new AppwriteClient()
    .setEndpoint(requireEnv('APPWRITE_ENDPOINT'))
    .setProject(requireEnv('APPWRITE_PROJECT_ID'))
    .setKey(requireEnv('APPWRITE_API_KEY'));

  storage = new Storage(appwrite);
  // Canonical name first, legacy alias second — same order as the app.
  const publicBucketId =
    process.env.APPWRITE_STORAGE_BUCKET_ID?.trim() ||
    process.env.APPWRITE_BUCKET_ID?.trim() ||
    '';
  if (!publicBucketId) {
    console.error(
      'Missing required environment variable: APPWRITE_STORAGE_BUCKET_ID (or legacy APPWRITE_BUCKET_ID)',
    );
    process.exit(1);
  }
  const privateBucketId = process.env.APPWRITE_PRIVATE_BUCKET_ID?.trim() || publicBucketId;

  if (privateBucketId === publicBucketId) {
    console.warn(
      '! APPWRITE_PRIVATE_BUCKET_ID is not set — retailer documents would be copied into the ' +
        'PUBLIC bucket. Set a dedicated private bucket before migrating retailer_documents.',
    );
  }

  const targets = options.only ? TARGETS.filter((t) => t.name === options.only) : TARGETS;
  if (targets.length === 0) {
    console.error(`Unknown --only target. Valid: ${TARGETS.map((t) => t.name).join(', ')}`);
    process.exit(1);
  }

  console.log(options.apply ? 'MODE: APPLY (writes to Appwrite + Supabase rows)' : 'MODE: DRY RUN (no writes)');
  console.log('Supabase Storage objects are never deleted by this script.');

  const totals: Stats = { scanned: 0, skipped: 0, migrated: 0, failed: 0 };

  for (const target of targets) {
    if (target.private && privateBucketId === publicBucketId && options.apply) {
      console.log(`\n── ${target.name}: SKIPPED (no dedicated private bucket configured)`);
      continue;
    }

    const stats = await migrateTarget(target, options, { publicBucketId, privateBucketId });
    totals.scanned += stats.scanned;
    totals.skipped += stats.skipped;
    totals.migrated += stats.migrated;
    totals.failed += stats.failed;
  }

  console.log(
    `\nDone. scanned=${totals.scanned} ${options.apply ? 'migrated' : 'would-migrate'}=${totals.migrated} ` +
      `skipped=${totals.skipped} failed=${totals.failed}`,
  );

  if (totals.failed > 0) process.exitCode = 1;
}

void main();
