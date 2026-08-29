/**
 * Android resource-directory-name validator — shared by
 *   - scripts/android-postsync.mjs (runs automatically on every
 *     `npx cap sync`, including in CI), and
 *   - the "Validate Android resource directories" step of
 *     .github/workflows/android-apk.yml.
 *
 * WHY: Android requires resource-directory qualifiers to appear in ONE
 * canonical order — Table 2 of
 * https://developer.android.com/guide/topics/resources/providing-resources#table2
 * (… → screen orientation `port`/`land` → UI mode → night mode
 * `night`/`notnight` → screen density `mdpi`…`xxxhdpi` → …). A directory
 * such as `drawable-night-port-hdpi` puts `night` before `port`, and the
 * Android resource merger rejects it with "Invalid resource directory
 * name", failing :app:mergeDebugResources. That exact bug broke a build
 * once; this module is the guard rail that keeps it from ever coming
 * back.
 *
 * Run it directly to audit a checkout:
 *
 *     node scripts/android-resource-validation.mjs
 *
 * It validates the committed brand resources (resources/android-res) and,
 * when present, the generated native tree (android/app/src/main/res) that
 * `npx cap sync android` produced. Exit code 0 = all directory names
 * valid; 1 = at least one invalid name found.
 *
 * No dependencies, no network. Business logic: none — this is purely
 * native-shell packaging.
 */
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RESOURCE_TYPES = new Set([
  'anim', 'animator', 'color', 'drawable', 'font', 'interpolator', 'layout',
  'menu', 'mipmap', 'navigation', 'raw', 'string', 'style', 'transition',
  'values', 'xml',
]);

// Fixed-name qualifier token -> canonical precedence (Table 2 order).
const QUALIFIER_PRECEDENCE = {
  ldltr: 3, ldrtl: 3,
  small: 7, normal: 7, large: 7, xlarge: 7,
  long: 8, notlong: 8,
  round: 9, notround: 9,
  widecg: 10, nowidecg: 10,
  highdr: 11, lowdr: 11,
  port: 12, land: 12,
  car: 13, desk: 13, television: 13, appliance: 13, watch: 13, vrheadset: 13,
  night: 14, notnight: 14,
  ldpi: 15, mdpi: 15, hdpi: 15, xhdpi: 15, xxhdpi: 15, xxxhdpi: 15,
  nodpi: 15, tvdpi: 15, anydpi: 15,
  notouch: 16, finger: 16,
  keysexposed: 17, keyshidden: 17, keyssoft: 17,
  nokeys: 18, qwerty: 18, '12key': 18,
  navexposed: 19, navhidden: 19,
  nonav: 20, dpad: 20, trackball: 20, wheel: 20,
};

/**
 * Canonical precedence of a qualifier token.
 * Returns `undefined` for tokens this validator cannot positively
 * recognize (locale codes, sw<N>dp/w<N>dp/h<N>dp, b+47 tags, …) so the
 * caller SKIPS that directory — the check can never reject a valid
 * directory it does not understand.
 */
export const qualifierPrecedence = (token) => {
  if (Object.prototype.hasOwnProperty.call(QUALIFIER_PRECEDENCE, token)) {
    return QUALIFIER_PRECEDENCE[token];
  }
  if (/^\d+dpi$/.test(token)) return 15; // non-standard density (e.g. 480dpi)
  if (/^v\d+$/.test(token)) return 22; // platform version is always last
  return undefined;
};

/**
 * Returns the names of every directory directly under `rootDir` whose
 * resource qualifiers are out of canonical order (or duplicated/ordered
 * wrongly). Directories without qualifiers, and directories whose tokens
 * the validator does not recognize, are skipped.
 */
export const findInvalidResourceDirs = (rootDir) => {
  const invalid = [];
  for (const entry of readdirSync(rootDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const name = entry.name;
    const firstDash = name.indexOf('-');
    if (firstDash === -1) continue; // plain "drawable"/"values"/… — nothing to check
    if (!RESOURCE_TYPES.has(name.slice(0, firstDash))) continue; // unknown type — not ours to judge
    let prev = 0;
    for (const token of name.slice(firstDash + 1).split('-')) {
      const precedence = qualifierPrecedence(token);
      if (precedence === undefined) break; // unrecognized token — skip this directory
      if (precedence <= prev) {
        invalid.push(name);
        break; // reported once; no need to keep checking this dir
      }
      prev = precedence;
    }
  }
  return invalid;
};

export const INVALID_DIR_HELP =
  'Qualifiers must follow the canonical order of Table 2 at\n' +
  'https://developer.android.com/guide/topics/resources/providing-resources#table2\n' +
  '(orientation before night mode before density — e.g. drawable-port-night-hdpi,\n' +
  'never drawable-night-port-hdpi). Gradle would reject these in\n' +
  ':app:mergeDebugResources with "Invalid resource directory name".';

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
const isCli = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isCli) {
  const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
  const targets = [
    ['committed brand resources', join(repo, 'resources', 'android-res')],
    ['generated native resources', join(repo, 'android', 'app', 'src', 'main', 'res')],
  ];

  let failed = false;
  for (const [label, dir] of targets) {
    if (!existsSync(dir)) {
      console.log(`[android-resource-validation] ${label}: not present (${dir}) — skipped.`);
      continue;
    }
    const all = readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
    const invalid = findInvalidResourceDirs(dir);
    if (invalid.length > 0) {
      failed = true;
      console.error(`[android-resource-validation] ${label}: ${all.length} directories, ${invalid.length} INVALID:`);
      for (const name of invalid) console.error(`  - ${name}`);
    } else {
      console.log(`[android-resource-validation] ${label}: ${all.length} directories, 0 invalid — OK.`);
    }
  }

  if (failed) {
    console.error('[android-resource-validation] ERROR: invalid Android resource directory name(s).');
    console.error(INVALID_DIR_HELP);
    process.exit(1);
  }
  console.log('[android-resource-validation] all Android resource directory names are valid.');
}
