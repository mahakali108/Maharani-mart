/**
 * Page-level authorization must redirect, not throw.
 *
 * `requirePermission()` is the guard for Server Actions: a denial throws so the
 * caller receives a readable message. Rendered in a `page.tsx` it instead
 * triggers the nearest `error.tsx`, so an authorized-elsewhere role opening a
 * page it lacks the permission for saw "Something went wrong" — a malfunction
 * look for a permission decision. `requirePagePermission()` performs the same
 * check and redirects to /unauthorized, which is what a page navigation should
 * do.
 *
 * This test scans every page file so a new page cannot reintroduce the throw.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', 'app');

/**
 * Files that still call the throwing guard at page-body level, with the reason.
 * Keep this list empty in normal operation: it exists only so a file owned by
 * another open PR is exempted explicitly rather than silently.
 */
const ALLOWED_THROWING_PAGE_BODY: Record<string, string> = {
  // Owned by open PR #107 — not modified by this branch.
  'admin/cleanup/page.tsx': 'PR #107 ownership; its page-body guard still throws',
};

function pageFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) pageFiles(full, out);
    else if (entry === 'page.tsx') out.push(full);
  }
  return out;
}

/** Calls of the throwing guard indented exactly two spaces (page component body). */
function pageBodyThrowingGuards(source: string): number[] {
  const lines = source.split('\n');
  const defaultExport = lines.findIndex((line) => /^export default (async )?function/.test(line));
  if (defaultExport === -1) return [];
  const hits: number[] = [];
  lines.forEach((line, index) => {
    if (index <= defaultExport) return;
    const trimmed = line.trimStart();
    if (trimmed.startsWith('*') || trimmed.startsWith('//')) return;
    const indent = line.length - trimmed.length;
    if (indent === 2 && /\brequirePermission\(/.test(line) && !/requirePagePermission\(/.test(line)) {
      hits.push(index + 1);
    }
  });
  return hits;
}

describe('page components use the redirecting permission guard', () => {
  const files = pageFiles(ROOT);

  it('scans a realistic number of pages', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('no page component body calls the throwing requirePermission()', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const rel = relative(ROOT, file).replace(/\\/g, '/');
      const hits = pageBodyThrowingGuards(readFileSync(file, 'utf8'));
      if (hits.length === 0) continue;
      if (ALLOWED_THROWING_PAGE_BODY[rel]) continue;
      offenders.push(`${rel}:${hits.join(',')}`);
    }
    expect(offenders).toEqual([]);
  });

  it('every page that authorizes itself imports the guard from the shared module', () => {
    const missing: string[] = [];
    for (const file of files) {
      const rel = relative(ROOT, file).replace(/\\/g, '/');
      const source = readFileSync(file, 'utf8');
      if (!/requirePagePermission\(/.test(source)) continue;
      if (!/from '@\/lib\/admin\/guard'/.test(source)) missing.push(rel);
    }
    expect(missing).toEqual([]);
  });

  it('server actions keep the throwing guard (it must not become a redirect)', () => {
    const source = readFileSync(join(ROOT, 'admin/collections/page.tsx'), 'utf8');
    expect(source).toMatch(/import \{ requirePermission, requirePagePermission \} from '@\/lib\/admin\/guard'/);
    expect(source.split('\n').filter((line) => /^\s{4}await requirePermission\(/.test(line)).length).toBeGreaterThan(0);
  });
});
