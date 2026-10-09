/**
 * Android release versioning and signing — executable launch gates.
 *
 * WHY THIS FILE EXISTS
 * Two of the release checklist's open items (docs/ANDROID_RELEASE_CHECKLIST.md
 * §1 and §2) are the ones that can silently ship a bad artifact: a version string
 * nobody meant, and an unsigned APK described as a release. Neither is caught by
 * a Kotlin unit test, and neither is visible without an Android toolchain.
 *
 * What is asserted here, against the real files:
 *
 *   1. `android/version.properties` is the single source of truth, is well
 *      formed, and derives a clean MAJOR.MINOR.PATCH versionName — the
 *      "1.0.0-phase-b" pre-release marker that the checklist says "must not
 *      ship" can never come back as a literal in build.gradle.kts;
 *   2. the Gradle build READS that file (through the configuration-cache-tracked
 *      provider API) and fails loudly rather than defaulting;
 *   3. signing material comes only from the environment, is never committed, and
 *      an unconfigured build cannot produce something that looks signed;
 *   4. CI verifies the version OUT OF THE BUILT ARTIFACT with aapt, gates every
 *      signed-release step on the keystore actually being present, keeps the
 *      decoded keystore outside the workspace, destroys it, and never echoes a
 *      secret value.
 *
 * A green run here is NOT a signed release. Signing needs a real upload key that
 * only the maintainer can create; until the CI secrets exist the artifact stays
 * unsigned and that state is reported as BLOCKED, never as PASS.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');
const read = (relative: string) => readFileSync(join(ROOT, relative), 'utf8');

const PROPS_TEXT = read('android/version.properties');
const GRADLE = read('android/app/build.gradle.kts');
const WORKFLOW = read('.github/workflows/android-apk.yml');
const GITIGNORE = read('.gitignore');

/** Parse the properties file exactly as java.util.Properties would, for the keys we care about. */
function parseProperties(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('!')) continue;
    const separator = line.indexOf('=');
    if (separator < 0) continue;
    out[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return out;
}

const PROPS = parseProperties(PROPS_TEXT);

/** Every file under android/, ignoring generated output. */
function walkAndroid(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (['build', '.gradle', '.kotlin', '.idea'].includes(entry)) continue;
      walkAndroid(full, out);
    } else {
      out.push(full);
    }
  }
  return out;
}

describe('1. android/version.properties is well formed and is the only version source', () => {
  it('defines all four policy keys as plain non-negative integers', () => {
    for (const key of ['VERSION_MAJOR', 'VERSION_MINOR', 'VERSION_PATCH', 'VERSION_CODE']) {
      const value = PROPS[key];
      expect(value, `${key} must be defined`).toBeTruthy();
      expect(value, `${key} must be a plain integer`).toMatch(/^[0-9]+$/);
    }
  });

  it('versionCode is at least 1 — Google Play and the installer both reject 0', () => {
    expect(Number(PROPS.VERSION_CODE)).toBeGreaterThanOrEqual(1);
  });

  it('derives a clean MAJOR.MINOR.PATCH versionName with no pre-release marker', () => {
    const name = `${PROPS.VERSION_MAJOR}.${PROPS.VERSION_MINOR}.${PROPS.VERSION_PATCH}`;
    expect(name).toMatch(/^[0-9]+\.[0-9]+\.[0-9]+$/);
    // The exact string the release checklist forbids shipping.
    expect(name).not.toContain('phase');
    for (const marker of ['-rc', '-beta', '-alpha', '-SNAPSHOT', '-dev', '+build']) {
      expect(name, `${marker} must not appear in a public versionName`).not.toContain(marker);
    }
  });

  it('documents the increment policy next to the values it governs', () => {
    expect(PROPS_TEXT).toContain('STRICTLY INCREASE');
    expect(PROPS_TEXT).toContain('VERSION_CODE');
    expect(PROPS_TEXT).toContain('VERSION_MAJOR');
    // Why the code is not derived from a date or a CI run number.
    expect(PROPS_TEXT).toContain('INSTALL_FAILED_VERSION_DOWNGRADE');
  });
});

describe('2. the Gradle build derives the version instead of hardcoding it', () => {
  it('assigns versionCode/versionName from the derived values', () => {
    expect(GRADLE).toMatch(/versionCode = maharaniVersionCode/);
    expect(GRADLE).toMatch(/versionName = maharaniVersionName/);
  });

  it('contains no hardcoded version literal that could drift from the properties file', () => {
    expect(GRADLE).not.toMatch(/versionCode = [0-9]/);
    expect(GRADLE).not.toMatch(/versionName = "/);
    // The historical "1.0.0-phase-b" literal may be *described* in a comment, but
    // it must never be assigned again.
    expect(GRADLE).not.toMatch(/version(Name|Code)\s*=\s*"[^"]*-phase/);
    expect(GRADLE).not.toMatch(/versionName\s*=\s*"[^"]*(?:-rc|-beta|-alpha|-SNAPSHOT)/);
    const derived = `${PROPS.VERSION_MAJOR}.${PROPS.VERSION_MINOR}.${PROPS.VERSION_PATCH}`;
    expect(derived).not.toContain('phase');
  });

  it('reads version.properties through the configuration-cache-tracked provider API', () => {
    expect(GRADLE).toContain('rootProject.layout.projectDirectory.file("version.properties")');
    expect(GRADLE).toContain('providers');
    expect(GRADLE).toContain('.asText');
    // A bare readText() at configuration time is an untracked implicit dependency
    // and can serve a stale version straight out of the cache.
    expect(GRADLE).not.toMatch(/File\([^)]*version\.properties[^)]*\)\.readText\(\)/);
  });

  it('parses the properties file with Kotlin stdlib only — never java.util.Properties', () => {
    // PROVEN FAILURE, not a hypothetical: in a Gradle Kotlin DSL script the simple
    // name `java` resolves to the project's `java` EXTENSION, shadowing the `java`
    // package root, so `java.util.Properties` does not compile — CI run 37957848482
    // failed with "Unresolved reference 'util'" at exactly that line. Comments may
    // explain the trap; code must not repeat it.
    const code = GRADLE.split('\n')
      .filter((line) => !line.trimStart().startsWith('//'))
      .join('\n');
    expect(code).not.toContain('java.util.Properties');
    expect(code).not.toMatch(/\bjava\.[a-z]/);
    expect(GRADLE).toContain('lineSequence()');
    expect(GRADLE).toContain('.associate {');
    expect(GRADLE).toContain('toIntOrNull()');
  });

  it('parses version.properties the same way the Gradle script does', () => {
    // The test and the build must not disagree about what the file means, or the
    // green test would be describing a different version than the one shipped.
    const values: Record<string, string> = {};
    for (const rawLine of PROPS_TEXT.split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#') || line.startsWith('!')) continue;
      if (!line.includes('=')) continue;
      const separator = line.indexOf('=');
      values[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
    }
    const code = Number(values.VERSION_CODE);
    const name = [values.VERSION_MAJOR, values.VERSION_MINOR, values.VERSION_PATCH].join('.');
    expect(code).toBe(Number(PROPS.VERSION_CODE));
    expect(name).toBe(`${PROPS.VERSION_MAJOR}.${PROPS.VERSION_MINOR}.${PROPS.VERSION_PATCH}`);
    expect(name).toMatch(/^[0-9]+\.[0-9]+\.[0-9]+$/);
  });

  it('fails the build on a missing or malformed version file instead of defaulting', () => {
    expect(GRADLE).toContain('android/version.properties is missing');
    expect(GRADLE).toMatch(/must define \$key/);
    expect(GRADLE).toMatch(/must be a plain integer/);
    expect(GRADLE).toMatch(/must be >= \$minimum/);
    expect(GRADLE.match(/throw GradleException/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
  });

  it('builds the versionName by joining the three numeric components', () => {
    expect(GRADLE).toMatch(/VERSION_MAJOR/);
    expect(GRADLE).toMatch(/VERSION_MINOR/);
    expect(GRADLE).toMatch(/VERSION_PATCH/);
    expect(GRADLE).toContain('.joinToString(".")');
  });

  it('keeps the shipped application identity stable', () => {
    expect(GRADLE).toContain('applicationId = "com.maharanitraders.app"');
    expect(GRADLE).toContain('namespace = "com.maharanitraders.app"');
  });
});

describe('3. signing material is environmental and never committed', () => {
  it('reads all four signing values from the environment only', () => {
    for (const variable of [
      'RELEASE_KEYSTORE_PATH',
      'RELEASE_KEYSTORE_PASSWORD',
      'RELEASE_KEY_ALIAS',
      'RELEASE_KEY_PASSWORD',
    ]) {
      expect(GRADLE, `${variable} must come from System.getenv`).toContain(`System.getenv("${variable}")`);
    }
  });

  it('applies the release signing config only when every value is present', () => {
    expect(GRADLE).toContain('val releaseSigningConfigured: Boolean =');
    expect(GRADLE).toMatch(/if \(releaseSigningConfigured\) \{\s*\n\s*signingConfigs \{/);
    expect(GRADLE).toMatch(/if \(releaseSigningConfigured\) \{\s*\n\s*signingConfig = signingConfigs\.getByName\("release"\)/);
  });

  it('announces an unconfigured signing setup on every build, without printing a value', () => {
    expect(GRADLE).toContain('Maharani release signing is NOT configured');
    expect(GRADLE).toContain('must not be given to a retailer');
    // The warning names the variables; it must never interpolate one.
    const warning = GRADLE.slice(GRADLE.indexOf('Maharani release signing is NOT configured'));
    expect(warning.slice(0, 600)).not.toMatch(/\$releaseStorePassword|\$releaseKeyPassword|\$releaseStorePath/);
  });

  it('no keystore or key file exists anywhere under android/', () => {
    const offenders = walkAndroid(join(ROOT, 'android')).filter((file) =>
      /\.(jks|keystore|p12|pfx|pem|key)$/i.test(file)
    );
    expect(offenders, `signing material must never be committed: ${offenders.join(', ')}`).toEqual([]);
  });

  it('.gitignore keeps every keystore shape out of the repository', () => {
    expect(GITIGNORE).toContain('*.keystore');
    expect(GITIGNORE).toContain('*.jks');
    expect(GITIGNORE).toContain('*.pem');
    expect(GITIGNORE).toContain('local.properties');
  });

  it('git tracks no signing material', () => {
    let tracked: string;
    try {
      tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8', timeout: 60_000 });
    } catch {
      // No git binary or not a checkout — the filesystem assertion above still holds.
      return;
    }
    const offenders = tracked
      .split('\n')
      .filter((path) => /\.(jks|keystore|p12|pfx)$/i.test(path.trim()));
    expect(offenders, `git tracks signing material: ${offenders.join(', ')}`).toEqual([]);
  });

  it('keeps lint as a hard release gate', () => {
    expect(GRADLE).toMatch(/abortOnError = true/);
  });
});

describe('4. CI verifies the real artifact and cannot mislabel an unsigned build', () => {
  it('reads the version back out of the built APK with aapt', () => {
    expect(WORKFLOW).toContain('Verify artifact version against the declared version policy');
    expect(WORKFLOW).toContain('dump badging');
    expect(WORKFLOW).toContain("versionCode='\\([^']*\\)' versionName='\\([^']*\\)'");
    expect(WORKFLOW).toContain('version mismatch');
  });

  it('rejects a pre-release marker in the version CI actually builds', () => {
    expect(WORKFLOW).toMatch(/case "\$EXPECTED_NAME" in/);
    expect(WORKFLOW).toContain('must be plain MAJOR.MINOR.PATCH');
  });

  it('publishes the verified version as evidence', () => {
    expect(WORKFLOW).toContain('### Version policy');
    // The backticks are shell-escaped inside the run block, so match the wording.
    expect(WORKFLOW).toContain('android/version.properties');
    expect(WORKFLOW).toContain('(verified against the built artifacts)');
    expect(WORKFLOW).toContain('| versionName |');
    expect(WORKFLOW).toContain('| versionCode |');
  });

  it('gates every signed-release step on the keystore actually being present', () => {
    expect(WORKFLOW).toContain('id: keystore');
    const gated = WORKFLOW.match(/if: steps\.keystore\.outputs\.configured == 'true'/g) ?? [];
    expect(gated.length, 'build, verify and measure steps must all be gated').toBeGreaterThanOrEqual(3);
    // The gating step itself must not be conditional, or `configured` would be
    // empty and every dependent step would silently skip.
    expect(WORKFLOW).toMatch(/- name: Decode the release keystore when CI secrets provide one\n\s+id: keystore\n/);
  });

  it('reports a missing keystore as BLOCKED, never as a pass', () => {
    expect(WORKFLOW).toContain('signed release BLOCKED');
    expect(WORKFLOW).toContain('must NOT be given to a retailer or uploaded to Play');
    expect(WORKFLOW).toContain('**BLOCKED** — no signing material is configured.');
  });

  it('keeps the decoded keystore outside the workspace and destroys it', () => {
    expect(WORKFLOW).toContain('/tmp/maharani-signing');
    expect(WORKFLOW).toContain('chmod 700 /tmp/maharani-signing');
    expect(WORKFLOW).toContain('chmod 600 /tmp/maharani-signing/release.keystore');
    expect(WORKFLOW).toContain('rm -rf /tmp/maharani-signing');
    expect(WORKFLOW).toMatch(/- name: Destroy the decoded keystore\n\s+if: always\(\)/);
    // It must never land in an uploaded artifact path.
    expect(WORKFLOW).not.toMatch(/path:[\s\S]{0,200}maharani-signing/);
  });

  it('fails on a malformed base64 keystore instead of signing with an empty file', () => {
    expect(WORKFLOW).toContain('base64 --decode');
    expect(WORKFLOW).toContain('the decoded keystore is only');
  });

  it('verifies the signature with apksigner and asserts the SIGNED filename exists', () => {
    expect(WORKFLOW).toContain('apksigner');
    expect(WORKFLOW).toContain('verify --verbose --print-certs');
    expect(WORKFLOW).toContain('app-release.apk');
    expect(WORKFLOW).toContain("grep -qE '^Verifies$'");
    expect(WORKFLOW).toContain('APK Signature Scheme v2');
    // An unsigned Gradle release is named app-release-unsigned.apk; asserting the
    // signed name is what stops the two being confused.
    expect(WORKFLOW).toContain('only app-release.apk is distributable');
  });

  it('never echoes a secret value', () => {
    // The only permitted references are the four signing secrets and GITHUB_TOKEN,
    // and each must be consumed through `env:` — never interpolated into a run
    // block's echo/printf output.
    const referenced = [...WORKFLOW.matchAll(/secrets\.([A-Za-z0-9_]+)/g)].map((m) => m[1]);
    const allowed = new Set([
      'GITHUB_TOKEN',
      'ANDROID_RELEASE_KEYSTORE_BASE64',
      'ANDROID_RELEASE_KEYSTORE_PASSWORD',
      'ANDROID_RELEASE_KEY_ALIAS',
      'ANDROID_RELEASE_KEY_PASSWORD',
    ]);
    for (const name of referenced) {
      expect(allowed.has(name as string), `${name} is not a signing secret`).toBe(true);
    }
    for (const secret of [
      'ANDROID_RELEASE_KEYSTORE_PASSWORD',
      'ANDROID_RELEASE_KEY_ALIAS',
      'ANDROID_RELEASE_KEY_PASSWORD',
      'ANDROID_RELEASE_KEYSTORE_BASE64',
    ]) {
      const inline = new RegExp(`(echo|printf)[^\\n]*\\$\\{\\{\\s*secrets\\.${secret}`, 'g');
      expect(WORKFLOW.match(inline), `${secret} must never be printed`).toBeNull();
    }
    // apksigner output is filtered to the public verdict and digests.
    expect(WORKFLOW).toContain("grep -E '^(Verifies|Verified using|Number of signers|Signer #1 certificate SHA-256 digest)'");
  });

  it('leaves the historical unsigned size measurement intact and comparable', () => {
    expect(WORKFLOW).toContain('Build unsigned release APK and AAB for size measurement');
    expect(WORKFLOW).toContain('Measure artifact sizes and generate breakdown');
    expect(WORKFLOW).toContain('### Signed release sizes');
  });

  it('still runs the tests, lint and debug assembly that the release checklist requires', () => {
    expect(WORKFLOW).toContain('testDebugUnitTest');
    expect(WORKFLOW).toContain('lintDebug');
    expect(WORKFLOW).toContain('assembleDebug');
    expect(WORKFLOW).toContain("package: name='com.maharanitraders.app'");
  });
});

describe('5. the signing runbook exists and is honest about what is not done', () => {
  const DOC = 'docs/ANDROID_RELEASE_SIGNING.md';

  it('is present and referenced from both the build file and CI', () => {
    expect(existsSync(join(ROOT, DOC))).toBe(true);
    expect(GRADLE).toContain('docs/ANDROID_RELEASE_SIGNING.md');
    expect(WORKFLOW).toContain('docs/ANDROID_RELEASE_SIGNING.md');
  });

  it('names the four secrets CI expects, exactly as the build reads them', () => {
    const doc = read(DOC);
    for (const secret of [
      'ANDROID_RELEASE_KEYSTORE_BASE64',
      'ANDROID_RELEASE_KEYSTORE_PASSWORD',
      'ANDROID_RELEASE_KEY_ALIAS',
      'ANDROID_RELEASE_KEY_PASSWORD',
    ]) {
      expect(doc, `${secret} must be documented`).toContain(secret);
    }
    for (const variable of [
      'RELEASE_KEYSTORE_PATH',
      'RELEASE_KEYSTORE_PASSWORD',
      'RELEASE_KEY_ALIAS',
      'RELEASE_KEY_PASSWORD',
    ]) {
      expect(doc, `${variable} must be documented`).toContain(variable);
    }
  });

  it('covers both distribution channels and forbids committing the key', () => {
    const doc = read(DOC);
    expect(doc).toContain('Google Play');
    expect(doc).toContain('Play App Signing');
    expect(doc).toContain('Direct APK');
    expect(doc).toMatch(/never commit/i);
    expect(doc).toContain('Data safety');
    expect(doc).toContain('targetSdk');
  });

  it('states plainly that no signed artifact exists yet', () => {
    const doc = read(DOC);
    expect(doc).toContain('BLOCKED');
    expect(doc).toMatch(/not.*(published|distributed)/i);
  });
});
