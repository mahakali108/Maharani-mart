/**
 * Saran District, Bihar — the active service district.
 *
 * Covers: the single config constant, the reviewed migration (default only, no
 * data rewrite, reversible), the admin default, that no UI/config source still
 * presents Khagaria as the active area, and — executed on PGlite with every
 * migration applied — that new areas default to Saran while existing rows keep
 * their recorded district.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { SERVICE_AREA_LABEL, SERVICE_DISTRICT, SERVICE_STATE } from '@/lib/config/service-area';
import { createMigratedDb, type Db } from './helpers/pg-harness';

const root = process.cwd();
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');
const MIGRATION = 'supabase/migrations/0058_saran_default_district.sql';
const ROLLBACK = 'supabase/rollbacks/0058_saran_default_district.down.sql';
const GAYA_MIGRATION = 'supabase/migrations/0071_gaya_default_district.sql';

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...sourceFiles(rel));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(rel);
  }
  return out;
}

describe('Gaya — current default district configuration', () => {
  const gayaSql = read(GAYA_MIGRATION);

  it('updates only the default for newly added areas and does not claim coverage', () => {
    expect(gayaSql).toMatch(/alter table public\.areas alter column district set default 'Gaya';/);
    const statements = gayaSql.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n');
    expect(statements).not.toMatch(/\bupdate\b|\binsert\b|\bdelete\b|pin\s*code|pincode/i);
  });

  it('is Gaya, Bihar and does not assert that every PIN is serviceable', () => {
    expect(SERVICE_DISTRICT).toBe('Gaya');
    expect(SERVICE_STATE).toBe('Bihar');
    expect(SERVICE_AREA_LABEL).toBe('Gaya District, Bihar');
    expect(SERVICE_DISTRICT).not.toBe('Khagaria');
  });
});

describe('Saran — migration 0058 is a reviewed, reversible default change', () => {
  const sql = read(MIGRATION);

  it('sets the areas.district default to Saran', () => {
    expect(sql).toMatch(/alter table public\.areas alter column district set default 'Saran';/);
  });

  it('never rewrites existing data (no UPDATE / INSERT / DELETE)', () => {
    const statements = sql
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n');
    expect(statements).not.toMatch(/\bupdate\b/i);
    expect(statements).not.toMatch(/\binsert\b/i);
    expect(statements).not.toMatch(/\bdelete\b/i);
  });

  it('does not invent areas, pincodes or coordinates', () => {
    const statements = sql
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n');
    expect(statements).not.toMatch(/pincode|latitude|longitude|geo/i);
  });

  it('ships a rollback that restores the previous default and changes no rows', () => {
    expect(existsSync(join(root, ROLLBACK))).toBe(true);
    const down = read(ROLLBACK);
    expect(down).toMatch(/set default 'Khagaria'/);
    expect(down).not.toMatch(/\bupdate\b|\binsert\b|\bdelete\b/i);
  });
});

describe('Gaya — no Khagaria default in active application source', () => {
  const dirs = ['app', 'components', 'lib', 'middleware.ts'];
  const files = dirs.flatMap((d) => (d.endsWith('.ts') ? [d] : sourceFiles(d)));

  it('admin area form defaults to Gaya (not Khagaria)', () => {
    const form = read('components/admin/area-form.tsx');
    expect(form).toMatch(/defaultValue=\{SERVICE_DISTRICT\}/);
    expect(form).not.toMatch(/Khagaria/);
  });

  it('no app/components/lib source hard-codes Khagaria', () => {
    const offenders = files.filter((f) => /khagaria/i.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it('login, sidebar and admin areas use the shared Gaya label', () => {
    expect(read('app/login/page.tsx')).toContain('SERVICE_AREA_LABEL');
    expect(read('components/layout/sidebar.tsx')).toContain('SERVICE_AREA_LABEL');
    expect(read('app/admin/areas/page.tsx')).toContain('SERVICE_AREA_LABEL');
    expect(read('app/register-retailer/page.tsx')).toContain('SERVICE_AREA_LABEL');
  });

  it('home shows the service-area selector with the Gaya label', () => {
    const home = read('components/retailer/home-content.tsx');
    expect(home).toContain('data-testid="service-area-selector"');
    expect(home).toContain('SERVICE_AREA_LABEL');
  });
});

describe('Gaya — executed against PostgreSQL (PGlite) with all migrations', () => {
  let db: Db;
  beforeAll(async () => {
    db = await createMigratedDb();
  }, 120_000);

  it('the column default is Gaya', async () => {
    const { rows } = await db.query<{ column_default: string }>(
      `select column_default from information_schema.columns
        where table_schema = 'public' and table_name = 'areas' and column_name = 'district'`
    );
    expect(rows[0]?.column_default).toContain("'Gaya'");
  });

  it('a new area without an explicit district is recorded as Gaya', async () => {
    await db.query(`insert into public.areas (name) values ('Fixture Area Gaya Default')`);
    const { rows } = await db.query<{ district: string }>(
      `select district from public.areas where name = 'Fixture Area Gaya Default'`
    );
    expect(rows[0]?.district).toBe('Gaya');
  });

  it('an explicitly recorded district is kept as entered', async () => {
    await db.query(`insert into public.areas (name, district) values ('Fixture Legacy Area', 'Khagaria')`);
    const { rows } = await db.query<{ district: string }>(
      `select district from public.areas where name = 'Fixture Legacy Area'`
    );
    expect(rows[0]?.district).toBe('Khagaria');
  });
});
