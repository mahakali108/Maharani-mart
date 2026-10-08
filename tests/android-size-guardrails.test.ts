/**
 * Android size guardrails — encodes the findings of the 2026-10 app-size audit
 * (docs/ANDROID_SIZE_AUDIT.md) so the artifact cannot silently grow back:
 *
 *   1. release keeps R8 minification AND resource shrinking on;
 *   2. no native .so libraries are vendored into android/ (zero-ABI APK);
 *   3. no product catalog / JSON dataset / font files are bundled (all
 *      production data stays behind the /api/mobile/v1 backend);
 *   4. launcher art stays lightweight raster (the audit converted it to
 *      lossless WebP — pixel-identical, -33%);
 *   5. no heavyweight icon-pack or image library ever re-enters the version
 *      catalog (the one-icon MaharaniIcons approach is deliberate).
 *
 * Complementary to tests/android-project-integrity.test.ts.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');
const ANDROID = join(ROOT, 'android');
const APP = join(ANDROID, 'app');

const SKIP_DIRS = new Set(['build', '.gradle', '.kotlin', '.idea', 'wrapper']);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (SKIP_DIRS.has(entry)) continue;
      walk(full, out);
    } else {
      out.push(full);
    }
  }
  return out;
}

const androidFiles = () => walk(ANDROID).map((f) => relative(ANDROID, f).replace(/\\/g, '/'));

describe('Android artifact-size guardrails', () => {
  it('keeps release minification and resource shrinking enabled', () => {
    const gradle = readFileSync(join(APP, 'build.gradle.kts'), 'utf8');
    const releaseBlock = /release\s*\{[\s\S]*?\n    \}/.exec(gradle);
    expect(releaseBlock).not.toBeNull();
    expect(releaseBlock![0]).toContain('isMinifyEnabled = true');
    expect(releaseBlock![0]).toContain('isShrinkResources = true');
  });

  it('vendors zero native libraries (no ABI split is needed)', () => {
    const sos = androidFiles().filter((f) => f.endsWith('.so'));
    expect(sos).toEqual([]);
  });

  it('bundles no catalog data, JSON datasets, or fonts into the app', () => {
    const files = androidFiles();
    const bundledData = files.filter(
      (f) =>
        f.startsWith('app/src/main/assets/') ||
        (f.startsWith('app/src/main/res/raw/') && /\.(json|csv|db|sqlite)$/i.test(f)) ||
        /\.(ttf|otf|ttc)$/i.test(f),
    );
    expect(bundledData).toEqual([]);
  });

  it('keeps launcher art lightweight (audit: lossless WebP, <= 60 KB each)', () => {
    const art = androidFiles().filter((f) => /^app\/src\/main\/res\/mipmap-[^/]+\/ic_launcher[^/]*\.(png|webp|jpg|jpeg)$/.test(f));
    expect(art.length).toBeGreaterThan(0);
    for (const f of art) {
      const bytes = statSync(join(ANDROID, f)).size;
      expect(bytes, `${f} is ${bytes} bytes — launcher art must stay small`).toBeLessThan(60_000);
    }
  });

  it('does not pull icon packs or heavyweight image libraries into the catalog', () => {
    const catalog = readFileSync(join(ANDROID, 'gradle', 'libs.versions.toml'), 'utf8');
    // Declaration lines only — the catalog's comments deliberately explain why
    // some of these are NOT dependencies, and must keep saying so.
    const declarations = catalog
      .split('\n')
      .filter((line) => /^\s*(?![#\[])\S+\s*=\s*\{/.test(line))
      .join('\n');
    expect(declarations).not.toMatch(/material-icons/i);
    expect(declarations).not.toMatch(/glide|picasso|fresco/i);
    expect(declarations).not.toMatch(/firebase|analytics/i);
  });
});
