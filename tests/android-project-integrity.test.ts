/**
 * Static integrity checks for the native Android project (`android/**`).
 *
 * WHY THIS FILE EXISTS
 * The environment that produced those sources has no JDK and no Android SDK, so a broken
 * import or a missing resource would otherwise only be discovered by the Android CI job —
 * after a review round. These checks run in the existing vitest harness and cover the
 * failure classes that do not need a compiler:
 *
 *   1. every `import com.maharanitraders.…` resolves to a top-level declaration that exists
 *      in the Kotlin sources (catches renamed/moved classes and typos in package names);
 *   2. every module listed in `settings.gradle.kts` maps to a real directory with a build
 *      script (catches a half-added module);
 *   3. every resource referenced from the manifest, themes or Kotlin (`@drawable/…`,
 *      `@style/…`, `R.string.…`) exists as a file or a `values` entry (catches a launcher
 *      icon or theme attribute that would fail resource linking on the first build).
 *
 * These are *complementary* to the security assertions in
 * `tests/mobile-api-foundation.test.ts`; neither replaces a real compile, and a green run
 * here is not a substitute for the Android CI job.
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

const allFiles = () => walk(ANDROID);
const kotlinFiles = () => allFiles().filter((f) => f.endsWith('.kt'));
const kotlinOrScriptFiles = () => allFiles().filter((f) => f.endsWith('.kt') || f.endsWith('.kts'));

/**
 * Lex just enough Kotlin to answer one question: are the block comments in this file
 * balanced, and does any of them open a *nested* comment?
 *
 * Kotlin nests block comments — `/* /* *\/ *\/` — while Java, JavaScript and C# do not.
 * A doc comment containing a glob such as `/api/mobile/v1/auth/*` therefore does not end
 * at its own `*\/`: it swallows the rest of the file. The compiler then reports one
 * "Unclosed comment" at EOF and, far more loudly, an "Unresolved reference" for every
 * name that file used to declare, which points at innocent importers instead of at the
 * comment. String and character literals have to be skipped, or a `/*` inside a string
 * would be counted.
 */
function commentDepthProblem(source: string, file = ''): string | null {
  let i = 0;
  let line = 1;
  let depth = 0;
  let openedAtLine = 0;
  const newlines = (from: number, to: number) => (source.slice(from, to).match(/\n/g) ?? []).length;

  const skip = (from: number, until: number) => {
    line += newlines(from, until);
    return until;
  };

  while (i < source.length) {
    const char = source[i]!;
    const next = source[i + 1] ?? '';
    if (char === '\n') {
      line += 1;
      i += 1;
      continue;
    }
    if (depth === 0) {
      if (char === '/' && next === '/') {
        const eol = source.indexOf('\n', i);
        i = eol === -1 ? source.length : eol;
      } else if (source.startsWith('"""', i)) {
        const end = source.indexOf('"""', i + 3);
        i = skip(i, end === -1 ? source.length : end + 3);
      } else if (char === '"' || char === "'") {
        let j = i + 1;
        while (j < source.length && source[j] !== char && source[j] !== '\n') {
          if (source[j] === '\\') j += 1;
          j += 1;
        }
        i = skip(i, j + 1);
      } else if (char === '/' && next === '*') {
        depth = 1;
        openedAtLine = line;
        i += 2;
      } else {
        i += 1;
      }
      continue;
    }
    if (char === '/' && next === '*') {
      return `${file} line ${line}: block comment (opened line ${openedAtLine}) opens another comment — Kotlin nests them, so it will not close here`;
    }
    if (char === '*' && next === '/') {
      depth -= 1;
      i += 2;
      continue;
    }
    i += 1;
  }
  if (depth !== 0) {
    return `${file} line ${openedAtLine}: block comment is never closed (reaches end of file)`;
  }
  return null;
}

/**
 * Strips Kotlin comments from a fragment so that *prose* cannot be mistaken for
 * code. Kotlin block comments nest, so the scanner tracks depth; string literals
 * are kept (a `//` inside a URL string is not a comment) and `"""` raw strings are
 * skipped whole. Used on constructor argument text, where a KDoc between two
 * parameters once produced a phantom parameter named `core` — read out of the
 * prose "`core:network`".
 */
function stripKotlinComments(source: string): string {
  let out = '';
  let depth = 0;
  let inLine = false;
  let inString = false;
  let inRaw = false;
  for (let i = 0; i < source.length; i += 1) {
    const c = source[i]!;
    const next = source[i + 1];
    if (inLine) {
      if (c === '\n') {
        inLine = false;
        out += c;
      }
      continue;
    }
    if (depth > 0) {
      if (c === '/' && next === '*') {
        depth += 1;
        i += 1;
      } else if (c === '*' && next === '/') {
        depth -= 1;
        i += 1;
      }
      continue;
    }
    if (inRaw) {
      if (c === '"' && source.slice(i, i + 3) === '"""') {
        inRaw = false;
        i += 2;
      }
      continue;
    }
    if (inString) {
      out += c;
      if (c === '\\') i += 1;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"' && source.slice(i, i + 3) === '"""') {
      inRaw = true;
      i += 2;
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
      continue;
    }
    if (c === '/' && next === '/') {
      inLine = true;
      i += 1;
      continue;
    }
    if (c === '/' && next === '*') {
      depth = 1;
      i += 1;
      continue;
    }
    out += c;
  }
  return out;
}

/** `pkg -> set(top-level declaration names)` across every Kotlin source set. */
function declaredSymbols(): Map<string, Set<string>> {
  const packages = new Map<string, Set<string>>();
  const declarationPatterns = [
    /^(?:@\w+(?:\([^)]*\))?\s*)*(?:\w+\s+)*(?:annotation\s+class|fun\s+interface|enum\s+class|sealed\s+interface|sealed\s+class|data\s+class|class|object|interface|typealias)\s+([A-Za-z_]\w*)/,
    // extension functions, including the modified and generic forms:
    //   `fun UserRole.label(...)`, `inline fun <T, R> AppResult<T>.map(...)`
    /^(?:@\w+(?:\([^)]*\))?\s*)*(?:\w+\s+)*fun\s+(?:<[^>]*>\s*)?[\w.]+(?:<[^>]*>)?\.([A-Za-z_]\w*)\s*\(/,
    // top-level functions: `fun health()`, `suspend fun login(...)`
    /^(?:@\w+(?:\([^)]*\))?\s*)*(?:\w+\s+)*fun\s+(?:<[^>]*>\s*)?([A-Za-z_]\w*)\s*\(/,
  ];

  for (const file of kotlinFiles()) {
    const source = readFileSync(file, 'utf8');
    const lines = source.split('\n');
    const packageName = lines.find((line) => line.startsWith('package '))?.slice(8).trim();
    if (!packageName) continue;

    const names = packages.get(packageName) ?? new Set<string>();
    for (const line of lines) {
      for (const pattern of declarationPatterns) {
        const match = pattern.exec(line);
        if (match) {
          names.add(match[1]!);
          break;
        }
      }
    }
    packages.set(packageName, names);
  }
  return packages;
}

describe('Android project integrity', () => {
  it('every project import resolves to a declared top-level symbol', () => {
    const packages = declaredSymbols();
    // Generated by AGP, not present in the sources.
    const generated = new Set(['com.maharanitraders.app.BuildConfig']);
    const unresolved: string[] = [];

    for (const file of kotlinFiles()) {
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        if (!line.startsWith('import com.maharanitraders.')) continue;
        const target = line.slice('import '.length).trim();
        if (target.endsWith('.*') || generated.has(target)) continue;

        const lastDot = target.lastIndexOf('.');
        const packageName = target.slice(0, lastDot);
        const symbol = target.slice(lastDot + 1);

        if (!packages.get(packageName)?.has(symbol)) {
          unresolved.push(`${relative(ROOT, file)} → ${target}`);
        }
      }
    }

    expect(unresolved).toEqual([]);
  });

  it('every Gradle module in settings.gradle.kts exists with a build script', () => {
    const settings = readFileSync(join(ANDROID, 'settings.gradle.kts'), 'utf8');
    const includes = [...settings.matchAll(/include\(\s*([^)]*)\)/g)]
      .flatMap((match) => match[1]!.split(','))
      .map((entry) => entry.trim().replace(/^"|"$/g, ''))
      .filter((entry) => entry.startsWith(':'));

    expect(includes.length).toBeGreaterThan(0);

    for (const module of includes) {
      const dir = join(ANDROID, module.replace(/:/g, '/'));
      expect(statSync(dir).isDirectory(), `${module} directory`).toBe(true);
      expect(
        ['build.gradle.kts', 'build.gradle'].some((name) => {
          try {
            return statSync(join(dir, name)).isFile();
          } catch {
            return false;
          }
        }),
        `${module} build script`,
      ).toBe(true);
    }
  });

  it('every referenced resource exists as a file or a values entry', () => {
    const resourceDirs = allFiles().filter((f) => /[\\/]res[\\/]/.test(f));
    const files = new Set(resourceDirs.map((f) => f.replace(/\\/g, '/')));

    const declaredValues = new Set<string>();
    const resourceFiles: { type: string; name: string }[] = [];
    for (const file of resourceDirs) {
      const normalized = file.replace(/\\/g, '/');
      const match = /\/res\/(drawable|mipmap|xml|raw|anim)[^/]*\/([^/]+)\.(png|webp|jpg|jpeg|xml|json)$/.exec(
        normalized,
      );
      if (match) resourceFiles.push({ type: match[1]!, name: match[2]! });

      // `values*/…xml` declarations: <string|color|style|dimen|bool|integer name="…">
      const valuesMatch = /\/res\/values[^/]*\/([^/]+)\.xml$/.exec(normalized);
      if (valuesMatch) {
        const source = readFileSync(file, 'utf8');
        for (const declaration of source.matchAll(
          /<(string|color|style|dimen|bool|integer|string-array|array|plurals)\s+name="([^"]+)"/g,
        )) {
          declaredValues.add(`${declaration[1]}:${declaration[2]}`);
        }
      }
    }

    const referenced = new Map<string, string[]>(); // "type:name" -> referencing files
    for (const file of allFiles()) {
      if (!/\.(xml|kt)$/.test(file)) continue;
      const source = readFileSync(file, 'utf8');
      const display = relative(ROOT, file);

      for (const match of source.matchAll(/@(drawable|mipmap|color|string|style|xml|dimen|bool|integer)\/([\w.]+)/g)) {
        const key = `${match[1]}:${match[2]}`;
        referenced.set(key, [...(referenced.get(key) ?? []), display]);
      }
      for (const match of source.matchAll(/\bR\.(drawable|mipmap|color|string|style|xml|dimen|bool|integer)\.(\w+)/g)) {
        const key = `${match[1]}:${match[2]}`;
        referenced.set(key, [...(referenced.get(key) ?? []), display]);
      }
    }

    const missing: string[] = [];
    for (const [key, sources] of referenced) {
      const [type, name] = key.split(':') as [string, string];
      const exists =
        declaredValues.has(key) ||
        (['drawable', 'mipmap', 'xml', 'raw', 'anim'].includes(type) &&
          resourceFiles.some((resource) => resource.type === type && resource.name === name));

      if (!exists) missing.push(`${key} (referenced by ${[...new Set(sources)].join(', ')})`);
    }

    // Sanity: the scan actually saw resources, so a broken walk cannot pass silently.
    expect(resourceFiles.length).toBeGreaterThan(0);
    expect(declaredValues.size).toBeGreaterThan(0);
    expect(missing).toEqual([]);
  });

  it('keeps the launcher icon, splash and network config resources wired', () => {
    const manifest = readFileSync(join(APP, 'src', 'main', 'AndroidManifest.xml'), 'utf8');
    expect(manifest).toContain('@mipmap/ic_launcher');
    expect(manifest).toContain('@xml/network_security_config');

    const theme = readFileSync(join(APP, 'src', 'main', 'res', 'values', 'themes.xml'), 'utf8');
    expect(theme).toContain('windowSplashScreenAnimatedIcon');
    expect(theme).toContain('postSplashScreenTheme');
  });

  it('keeps release HTTP transport HTTPS-only, non-logging and non-retrying', () => {
    const networkModule = readFileSync(
      join(ANDROID, 'core', 'network', 'src', 'main', 'kotlin', 'com', 'maharanitraders', 'core', 'network', 'di', 'NetworkModule.kt'),
      'utf8',
    );
    const appModule = readFileSync(
      join(APP, 'src', 'main', 'kotlin', 'com', 'maharanitraders', 'app', 'di', 'AppModule.kt'),
      'utf8',
    );
    const manifest = readFileSync(join(APP, 'src', 'main', 'AndroidManifest.xml'), 'utf8');
    const releaseNetworkConfig = readFileSync(
      join(APP, 'src', 'main', 'res', 'xml', 'network_security_config.xml'),
      'utf8',
    );

    expect(appModule).toContain('allowLocalHttp = BuildConfig.DEBUG');
    expect(manifest).toContain('android:usesCleartextTraffic="false"');
    expect(releaseNetworkConfig).toContain('cleartextTrafficPermitted="false"');
    expect(releaseNetworkConfig).toContain('<certificates src="system" />');
    expect(networkModule).toContain('.retryOnConnectionFailure(false)');
    expect(networkModule).toContain('.followRedirects(false)');
    expect(networkModule).toContain('.followSslRedirects(false)');
    expect(networkModule).not.toMatch(/HttpLoggingInterceptor|sslSocketFactory|hostnameVerifier/);
  });
});

describe('Android build scripts stay executable', () => {
  // WHY THIS CHECK EXISTS
  // Every Android CI run failed with "project ':app' does not specify `compileSdk`"
  // for a file that plainly sets it, while AGP's own model probe printed the extension
  // object as non-null with `namespace` and `compileSdk` both null: the script's
  // `android {}` block had never run, and neither had anything after it. The cause was
  // in the file's first doc comment, whose text was `/api/mobile/v1/auth/*` — Kotlin
  // nests block comments, so that `/*` opened a second comment and the outer `*/`
  // closed the inner one, leaving the comment open to the end of the file. The whole
  // body became comment text. The statements before the comment still ran — the script
  // printed its own "plugins applied" marker — which is why the failure looked like an
  // AGP problem rather than a parse problem.
  const buildScripts = () => walk(ANDROID).filter((f) => f.endsWith('.gradle.kts'));

  it('has no Kotlin or Gradle-script block comment that nests or never closes', () => {
    // The check is a lexer rather than a "no block comments" rule: a normal doc comment
    // is fine, a doc comment containing `/*` is not, and only a lexer can tell them
    // apart. It covers sources as well as scripts — `:core:network`'s `AuthDtos.kt` had
    // the identical defect, which surfaced as twenty-two "Unresolved reference" errors
    // in `MaharaniApi.kt` and one "Unclosed comment" at its own end of file.
    const offenders: string[] = [];
    for (const file of kotlinOrScriptFiles()) {
      const problem = commentDepthProblem(readFileSync(file, 'utf8'), relative(ROOT, file));
      if (problem) offenders.push(problem);
    }
    expect(offenders).toEqual([]);
  });

  it('declares the android extension in every module that applies an android plugin', () => {
    const missing: string[] = [];
    for (const file of buildScripts()) {
      const source = readFileSync(file, 'utf8');
      // `apply false` at the root only puts the plugin on the classpath.
      if (!/alias\(libs\.plugins\.android\.[\w.]+\)(?!\s*apply false)/.test(source)) continue;
      const hasNamespace = /namespace\s*=\s*"/.test(source);
      const hasSdk = /compileSdk\s*\{|compileSdk\s*=\s*\d+|compileSdkVersion/.test(source);
      if (!hasNamespace || !hasSdk) missing.push(relative(ROOT, file));
    }
    expect(missing).toEqual([]);
  });

  it('imports the AppResult extension functions wherever it uses them', () => {
    // `AppResult.map`, `.getOrNull`, `.onSuccess` and friends are top-level
    // extensions in `com.maharanitraders.core.common` — they have to be, because a
    // member `map` would put `T` in an `in` position and break the covariance that
    // lets `Failure : AppResult<Nothing>` stand in for any `AppResult<T>`. The
    // consequence is that importing the *interface* does not bring them in, and
    // `:core:auth`'s `AuthRepository.kt` failed to compile with eight
    // "Unresolved reference 'map' on receiver of type 'AppResult<…>'" errors for
    // exactly that reason.
    //
    // Deliverable-evidence for this check: reintroducing the missing import line
    // makes it fail with that file named.
    const helpers = ['getOrNull', 'errorOrNull', 'onSuccess', 'onFailure'];
    const offenders: string[] = [];
    for (const file of kotlinFiles()) {
      const rel = relative(ROOT, file);
      if (rel.includes('core/common/src/main')) continue; // same package as the declarations
      const source = readFileSync(file, 'utf8');
      if (!source.includes('com.maharanitraders.core.common.')) continue;

      // `.map` is also the stdlib collection function, so it only counts when it is
      // chained straight onto the call that produces an AppResult.
      // no braces inside the lambda: `execute { api.login(...) }.map {}`.
      // Allowing nesting would also match `list.filter { … }.map { … }`, which is
      // the stdlib function and needs no import — `:feature:auth`'s
      // `AreaDirectory.kt` does exactly that on a list and must stay clean.
      //
      // Both executors count: `ApiCallExecutor` exposes `execute` (yields the raw
      // envelope) and `executeEnvelope` (unwraps it), and either can be the
      // receiver. An earlier revision matched only `executeEnvelope`, which is why
      // `:feature:catalog`'s `CatalogRepository.kt` reached CI with 15 unresolved
      // `map`/`it`/`data`/`page`/`meta` references.
      const mapOnAppResult = /execute(?:Envelope)?\s*\{[^{}]*\}\s*\.\s*map\s*[({]/.test(source);
      const needsImport = [
        ...(mapOnAppResult ? ['map'] : []),
        ...helpers.filter((h) => [`.${h}(`, `.${h} {`].some((call) => source.includes(call))),
      ];
      for (const helper of needsImport) {
        if (!source.includes(`com.maharanitraders.core.common.${helper}`)) {
          offenders.push(`${rel}: calls .${helper}(…) without importing com.maharanitraders.core.common.${helper}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('backs every cross-module import with a declared project dependency', () => {
    // A module that imports another module's package without depending on it
    // compiles only by accident. `:core:common` did exactly this with
    // `com.maharanitraders.core.model`, which the first real compile rejected.
    const modules = new Map<string, string>(); // ':core:model' -> directory
    for (const file of buildScripts()) {
      const dir = file.slice(0, file.lastIndexOf('/'));
      if (dir === ANDROID) continue;
      modules.set(':' + relative(ANDROID, dir).replace(/\//g, ':'), dir);
    }

    const packageOwner = new Map<string, string>();
    for (const [module, dir] of modules) {
      for (const file of walk(dir).filter((f) => f.endsWith('.kt'))) {
        const pkg = /^package\s+([\w.]+)/m.exec(readFileSync(file, 'utf8'))?.[1];
        if (pkg?.startsWith('com.maharanitraders')) packageOwner.set(pkg, module);
      }
    }

    const missing = new Set<string>();
    for (const [module, dir] of modules) {
      const declared = new Set(
        [...readFileSync(join(dir, 'build.gradle.kts'), 'utf8').matchAll(/project\("(:[\w:]+)"\)/g)].map(
          (m) => m[1]!,
        ),
      );
      for (const file of walk(dir).filter((f) => f.endsWith('.kt'))) {
        for (const line of readFileSync(file, 'utf8').split('\n')) {
          const imported = /^\s*import\s+(com\.maharanitraders[\w.]*)/.exec(line)?.[1];
          if (!imported) continue;
          const parts = imported.split('.');
          let owner: string | undefined;
          for (let i = parts.length; i > 2; i--) {
            const candidate = parts.slice(0, i).join('.');
            if (packageOwner.has(candidate)) {
              owner = packageOwner.get(candidate);
              break;
            }
          }
          if (owner && owner !== module && !declared.has(owner)) {
            missing.add(`${module} imports ${owner} (${relative(ROOT, file)})`);
          }
        }
      }
    }
    expect([...missing].sort()).toEqual([]);
  });
});

describe('Android design tokens resolve', () => {
  // The first real compile rejected core/designsystem: Theme.kt referenced
  // `MaharaniPalette.BrandRed600` while Color.kt defined `Red600`, and both
  // Theme.kt and StateSurfaces.kt referenced an extra-colour holder that had
  // never been written. Neither is catchable without a compiler, and neither
  // is caught by an import check, so the member references are checked here.
  const themeDir = join(
    ANDROID,
    'core',
    'designsystem',
    'src',
    'main',
    'kotlin',
    'com',
    'maharanitraders',
    'core',
    'designsystem',
    'theme',
  );
  const membersOf = (file: string, pattern: RegExp) =>
    new Set([...readFileSync(join(themeDir, file), 'utf8').matchAll(pattern)].map((m) => m[1]!));

  const paletteMembers = () => membersOf('Color.kt', /^\s*val\s+(\w+)\s*=/gm);
  const extraColorMembers = () => membersOf('ExtraColors.kt', /^\s*val\s+(\w+):/gm);

  it('resolves every MaharaniPalette member reference', () => {
    const defined = paletteMembers();
    expect(defined.size).toBeGreaterThan(20);

    const missing = new Set<string>();
    for (const file of kotlinFiles()) {
      for (const match of readFileSync(file, 'utf8').matchAll(/MaharaniPalette\.(\w+)/g)) {
        if (!defined.has(match[1]!)) missing.add(`${match[1]} (${relative(ROOT, file)})`);
      }
    }
    expect([...missing].sort()).toEqual([]);
  });

  it('resolves every extra-colour reference', () => {
    const defined = extraColorMembers();
    expect(defined.size).toBeGreaterThan(5);

    const missing = new Set<string>();
    for (const file of kotlinFiles()) {
      for (const match of readFileSync(file, 'utf8').matchAll(/colors\.(\w+)/g)) {
        if (!defined.has(match[1]!)) missing.add(`${match[1]} (${relative(ROOT, file)})`);
      }
    }
    expect([...missing].sort()).toEqual([]);
  });
});

describe('Android test doubles keep up with the main sources', () => {
  // WHY: the first run that compiled test sources failed twice in the same way.
  // `SessionManager` gained an `authRepository` constructor parameter and
  // `SessionController` gained `signIn`/`registerRetailer`; `:core:auth` reported
  // "No value passed for parameter 'authRepository'" and "Class 'FakeMaharaniApi'
  // is not abstract and does not implement abstract members". `:app`'s
  // FakeSessionController was one compile away from the identical failure. Both are
  // decidable from the sources, so they are decided here rather than in CI.
  const mainSources = () => kotlinFiles().filter((f) => f.includes('/src/main/'));
  const testSources = () => kotlinFiles().filter((f) => f.includes('/src/test/'));

  /** Every project interface declared in main sources: name -> required members. */
  function projectInterfaces(): Map<string, { members: string[]; file: string }> {
    const found = new Map<string, { members: string[]; file: string }>();
    for (const file of mainSources()) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/\binterface\s+(\w+)/g)) {
        const braceAt = source.indexOf('{', match.index);
        if (braceAt === -1) continue;
        let depth = 0;
        let end = braceAt;
        for (; end < source.length; end += 1) {
          if (source[end] === '{') depth += 1;
          else if (source[end] === '}') {
            depth -= 1;
            if (depth === 0) break;
          }
        }
        const body = source.slice(braceAt + 1, end);
        const members = [
          ...body.matchAll(/^\s*(?:suspend\s+|override\s+)*(?:val|var|fun)\s+(\w+)/gm),
        ].map((m) => m[1]!);
        found.set(match[1]!, { members: [...new Set(members)], file: relative(ROOT, file) });
      }
    }
    return found;
  }

  /** Splits an argument list on top-level commas only. */
  function splitArguments(source: string, open: number): string[] | null {
    let depth = 0;
    const parts: string[] = [];
    let current = '';
    for (let i = open; i < source.length; i += 1) {
      const char = source[i];
      // A comment is not an argument: skip it entirely, or its text (and the
      // commas inside it) would end up glued to the argument that follows.
      if (char === '/' && source[i + 1] === '/') {
        const eol = source.indexOf('\n', i);
        i = (eol === -1 ? source.length : eol) - 1;
        continue;
      }
      if (char === '(' || char === '[' || char === '{') {
        depth += 1;
        if (depth === 1) continue; // the call's own opening bracket
      } else if (char === ')' || char === ']' || char === '}') {
        depth -= 1;
        if (depth === 0) {
          parts.push(current);
          return parts;
        }
      } else if (char === ',' && depth === 1) {
        parts.push(current);
        current = '';
        continue;
      }
      current += char;
    }
    return null;
  }

  /** Required (no-default) constructor parameters of every main-source class. */
  function requiredConstructorParameters(): Map<string, { params: string[]; file: string }> {
    const found = new Map<string, { params: string[]; file: string }>();
    for (const file of mainSources()) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/\bconstructor\s*\(/g)) {
        const head = source.slice(Math.max(0, match.index - 400), match.index);
        const className = [...head.matchAll(/class\s+(\w+)/g)].pop()?.[1];
        if (!className) continue;
        const args = splitArguments(source, source.indexOf('(', match.index));
        if (!args) continue;
        const required = args
          .map((arg) => arg.trim())
          .filter((arg) => arg.length > 0 && !arg.includes('='))
          .map((arg) => {
            // Comments first: an argument is `/** doc */ private val name: Type`,
            // and the prose inside that doc is not a parameter declaration.
            const clean = stripKotlinComments(arg).trim();
            return (
              /(?:\bval\b|\bvar\b)\s+(\w+)\s*:/.exec(clean)?.[1] ??
              /^(\w+)\s*:/.exec(clean)?.[1]
            );
          })
          .filter((name): name is string => Boolean(name));
        const existing = found.get(className);
        found.set(className, {
          params: [...new Set([...(existing?.params ?? []), ...required])],
          file: existing?.file ?? relative(ROOT, file),
        });
      }
    }
    return found;
  }

  it('implements every member of every project interface a test double claims', () => {
    const interfaces = projectInterfaces();
    expect(interfaces.size).toBeGreaterThan(5);

    const offenders: string[] = [];
    for (const file of testSources()) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/class\s+(\w+)\s*(?:\([^)]*\))?\s*:\s*([\w.]+)/g)) {
        const className = match[1]!;
        const interfaceName = match[2]!.split('.').pop()!;
        const declaration = interfaces.get(interfaceName);
        if (!declaration) continue;
        const missing = declaration.members.filter(
          (member) =>
            !(
              source.includes(`fun ${member}(`) ||
              source.includes(`fun ${member} (`) ||
              source.includes(`val ${member}:`) ||
              source.includes(`val ${member} `) ||
              source.includes(`var ${member}:`)
            ),
        );
        if (missing.length > 0) {
          offenders.push(
            `${className} : ${interfaceName} — missing ${missing.join(', ')} (interface in ${declaration.file}; double in ${relative(ROOT, file)})`,
          );
        }
      }
    }
    expect(offenders.sort()).toEqual([]);
  });

  /**
   * Blanks block comments, preserving every offset.
   *
   * `splitArguments` skips `//` comments but not KDoc, and a KDoc sentence
   * containing a comma splits one parameter into two — which is how a prose
   * word ending in a colon got read as a parameter name.
   */
  function blankBlockComments(source: string): string {
    const out = source.split('');
    let i = 0;
    while (i < source.length) {
      if (source[i] === '/' && source[i + 1] === '*') {
        const close = source.indexOf('*/', i + 2);
        const end = close === -1 ? source.length : close + 2;
        for (let k = i; k < end; k += 1) if (out[k] !== '\n') out[k] = ' ';
        i = end;
      } else {
        i += 1;
      }
    }
    return out.join('');
  }

  /**
   * Every function an interface declares, with its parameter NAMES.
   *
   * Kotlin requires an override to match the signature exactly, so a parameter
   * added to an interface breaks every double that implements it — even though
   * the double still has a function of that name.
   */
  function interfaceFunctionParameters(): Map<string, Map<string, string[]>> {
    const found = new Map<string, Map<string, string[]>>();
    for (const file of mainSources()) {
      const source = blankBlockComments(readFileSync(file, 'utf8'));
      for (const match of source.matchAll(/\binterface\s+(\w+)/g)) {
        const braceAt = source.indexOf('{', match.index);
        if (braceAt === -1) continue;
        let depth = 0;
        let end = braceAt;
        for (; end < source.length; end += 1) {
          if (source[end] === '{') depth += 1;
          else if (source[end] === '}') {
            depth -= 1;
            if (depth === 0) break;
          }
        }
        const body = source.slice(braceAt + 1, end);
        const functions = new Map<string, string[]>();
        for (const fn of body.matchAll(/(?:^|\n)\s*(?:suspend\s+)?fun\s+(\w+)\s*\(/g)) {
          const open = body.indexOf('(', fn.index! + fn[0].length - 1);
          const args = splitArguments(body, open);
          if (!args) continue;
          functions.set(fn[1]!, parameterNames(args));
        }
        if (functions.size > 0) found.set(match[1]!, functions);
      }
    }
    return found;
  }

  /** Parameter names from a split argument list, annotations and docs removed. */
  function parameterNames(args: string[]): string[] {
    return args
      .map((arg) =>
        arg
          // KDoc on a parameter is prose, and prose contains words followed by
          // colons. Remove block and line comments before reading names.
          .replace(/\/\*[\s\S]*?\*\//g, ' ')
          .replace(/\/\/[^\n]*/g, ' ')
          // `@Query("fav")` is not the parameter name either.
          .replace(/@\w+\s*\([^)]*\)/g, ' ')
          .replace(/@\w+/g, ' ')
          .trim(),
      )
      .filter((arg) => arg.length > 0)
      .map((arg) => /(?:^|\s)(\w+)\s*:/.exec(arg)?.[1])
      .filter((name): name is string => Boolean(name));
  }

  it('matches the interface signature in every test double override', () => {
    // WHY: adding `favoritesOnly` to `MaharaniApi.catalogProducts` compiled the
    // catalogue fake (which was updated) but broke `:core:auth`'s FakeMaharaniApi,
    // which still declared the OLD parameter list. The rule above only checks that
    // a member of that NAME exists, so it passed and CI caught it instead.
    const interfaces = interfaceFunctionParameters();
    expect(interfaces.size).toBeGreaterThan(3);

    const offenders: string[] = [];
    for (const file of testSources()) {
      const source = blankBlockComments(readFileSync(file, 'utf8'));
      for (const match of source.matchAll(/class\s+(\w+)\s*(?:\([^)]*\))?\s*:\s*([\w.]+)/g)) {
        const className = match[1]!;
        const interfaceName = match[2]!.split('.').pop()!;
        const functions = interfaces.get(interfaceName);
        if (!functions) continue;

        for (const override of source.matchAll(/override\s+(?:suspend\s+)?fun\s+(\w+)\s*\(/g)) {
          const expected = functions.get(override[1]!);
          if (!expected) continue;
          const open = source.indexOf('(', override.index! + override[0].length - 1);
          const args = splitArguments(source, open);
          if (!args) continue;
          const actual = parameterNames(args);
          if (actual.join(',') !== expected.join(',')) {
            offenders.push(
              `${className}.${override[1]} takes (${actual.join(', ')}) but ${interfaceName} declares (${expected.join(', ')}) in ${relative(ROOT, file)}`,
            );
          }
        }
      }
    }
    expect(offenders.sort()).toEqual([]);
  });

  it('passes every required constructor parameter at every test call site', () => {
    const constructors = requiredConstructorParameters();
    expect(constructors.size).toBeGreaterThan(5);

    const offenders: string[] = [];
    for (const file of testSources()) {
      const source = readFileSync(file, 'utf8');
      for (const [className, { params, file: declarationFile }] of constructors) {
        if (params.length === 0) continue;
        let from = 0;
        for (;;) {
          const at = source.indexOf(`${className}(`, from);
          if (at === -1) break;
          from = at + 1;
          // A class name inside a longer identifier is not a call.
          const before = at === 0 ? ' ' : source[at - 1]!;
          if (/[A-Za-z0-9_]/.test(before)) continue;
          const args = splitArguments(source, at + className.length);
          if (!args) continue;
          // A trailing comma leaves an empty final part, and a comment between
          // arguments is not an argument at all; neither should stop the check.
          const effective = args
            .map((arg) => arg.trim())
            .filter((arg) => arg.length > 0 && !arg.startsWith('//'));
          // Only judge argument lists that use named arguments throughout: a call
          // that passes positionally is not decidable without types.
          const named = effective.map((arg) => {
            const eq = arg.indexOf('=');
            if (eq <= 0) return undefined;
            const name = arg.slice(0, eq).trim();
            return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : undefined;
          });
          if (named.some((name) => !name)) continue;
          const missing = params.filter((param) => !named.includes(param));
          if (missing.length > 0) {
            offenders.push(
              `${className}(…) omits ${missing.join(', ')} (class in ${declarationFile}; call in ${relative(ROOT, file)})`,
            );
          }
        }
      }
    }
    expect(offenders.sort()).toEqual([]);
  });
});

describe('Android toolchain pins stay consistent', () => {
  it('pins the KGP classpath to the same Kotlin version as the catalog', () => {
    // AGP 9's built-in Kotlin brings KGP 2.2.10 unless it is raised explicitly.
    // The Compose compiler plugin and the serialization plugin are KGP plugins
    // and must match the compiler exactly, so the two declarations of the Kotlin
    // version have to agree or the build fails in a confusing way.
    const catalog = readFileSync(join(ANDROID, 'gradle', 'libs.versions.toml'), 'utf8');
    const rootBuild = readFileSync(join(ANDROID, 'build.gradle.kts'), 'utf8');

    const catalogKotlin = /^kotlin = "([^"]+)"/m.exec(catalog)?.[1];
    expect(catalogKotlin).toBeTruthy();

    const classpathKotlin =
      /classpath\("org\.jetbrains\.kotlin:kotlin-gradle-plugin:([^"]+)"\)/.exec(rootBuild)?.[1];
    expect(classpathKotlin).toBe(catalogKotlin);
  });
});

describe('Android coroutine tests share one test scheduler', () => {
  // WHY: the first run that executed JUnit tests failed 13 of 14 cases in
  // `:core:auth:testDebugUnitTest` with "Detected use of different schedulers".
  // The class declared `private val dispatcher = StandardTestDispatcher()` — a
  // scheduler of its own — while every test body ran in `runTest { }`, which quietly
  // creates a *second* scheduler. Calling `advanceUntilIdle()` on one while work sits
  // on the other is reported as an error rather than silently hanging, so the whole
  // class failed at once. The rule is decidable from the source, so it is decided here
  // instead of costing an Android CI round: a file-level test dispatcher must be handed
  // to `runTest`, or it must be built from the ambient `testScheduler`.
  const testSources = () => kotlinFiles().filter((f) => f.includes('/src/test/'));

  /** Name of a class-level `val x = StandardTestDispatcher()` (no shared scheduler). */
  const fileLevelDispatcherWithoutScheduler = (source: string) =>
    /^[ \t]*(?:(?:private|internal|protected)\s+)?val\s+(\w+)\s*(?::[^=\n]+)?=\s*\w*(?:Standard|Unconfined)TestDispatcher\s*\(\s*\)/m.exec(
      source,
    )?.[1];

  it('hands a file-level TestDispatcher to runTest instead of bare runTest { }', () => {
    const offenders: string[] = [];
    let filesChecked = 0;
    for (const file of testSources()) {
      const source = readFileSync(file, 'utf8');
      const dispatcher = fileLevelDispatcherWithoutScheduler(source);
      if (!dispatcher) continue;
      filesChecked += 1;

      const callSites = [...source.matchAll(/\brunTest\s*(?:\{|\()/g)];
      for (const callSite of callSites) {
        if (callSite[0].endsWith('{')) {
          offenders.push(
            `${relative(ROOT, file)} declares '${dispatcher}' but calls bare \`runTest { }\`` +
              ` (line ${source.slice(0, callSite.index).split('\n').length}) — use \`runTest(${dispatcher}) { }\``,
          );
        }
      }

      // A file that never actually runs on the dispatcher would make this rule vacuous.
      if (callSites.length > 0 && !new RegExp(`\\brunTest\\s*\\(\\s*${dispatcher}\\b`).test(source)) {
        offenders.push(
          `${relative(ROOT, file)} declares '${dispatcher}' but no \`runTest(${dispatcher})\` call uses it`,
        );
      }
    }

    // Guard against the rule quietly matching nothing after a refactor.
    expect(filesChecked).toBeGreaterThan(0);
    expect(offenders).toEqual([]);
  });
});

describe('Android error vocabulary matches the mobile API contract', () => {
  // WHY: a `SessionManagerTest` double invented the code `invalid_refresh_token`
  // (the refresh route actually answers a dead refresh token with `401 invalid_token`).
  // The test then asserted a transition the server can never produce, and an Android CI
  // round was spent on it. Both directions of that agreement are decidable from the
  // sources: every code the mobile API can emit must be understood by the app, and no
  // test may assert on a code the app (or the server) does not know.
  const testSources = () => kotlinFiles().filter((f) => f.includes('/src/test/'));
  const SERVER_HTTP = join(ROOT, 'lib', 'mobile', 'http.ts');
  const ANDROID_CODES = join(
    ANDROID,
    'core',
    'model',
    'src',
    'main',
    'kotlin',
    'com',
    'maharanitraders',
    'core',
    'model',
    'ApiErrorCode.kt',
  );

  /** The server's authoritative union: `export type MobileErrorCode = 'a' | 'b' | …`. */
  function serverErrorCodes(): Set<string> {
    const source = readFileSync(SERVER_HTTP, 'utf8');
    const union = /export type MobileErrorCode =([\s\S]*?);/.exec(source)?.[1] ?? '';
    return new Set([...union.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]!));
  }

  /** Every `WIRE_NAME("wire_value", retryable)` entry in the Android enum. */
  function androidErrorCodes(): Set<string> {
    const source = readFileSync(ANDROID_CODES, 'utf8');
    return new Set([...source.matchAll(/^\s*[A-Z][A-Z0-9_]*\(\s*"([a-z_]+)"/gm)].map((match) => match[1]!));
  }

  it('understands every code the mobile API can emit', () => {
    const server = [...serverErrorCodes()].sort();
    // Guard against a parsing change silently emptying the server list.
    expect(server.length).toBeGreaterThan(20);

    const android = androidErrorCodes();
    const unknownToTheApp = server.filter((code) => !android.has(code));
    expect(unknownToTheApp).toEqual([]);
  });

  it('never asserts on a code the server cannot emit', () => {
    const android = androidErrorCodes();
    // Codes a test deliberately pretends the server invented, to prove that an
    // unrecognised code is handled without crashing. Anything else must be real.
    const DELIBERATELY_INVENTED = new Set([
      'brand_new_server_code', // proves an unknown code off a 401 stays retryable
      'brand_new_code', // the executor's unknown-code path
      'some_new_token_code', // proves an unknown code ON a 401 is terminal
    ]);

    const offenders: string[] = [];
    let assertionsChecked = 0;
    for (const file of testSources()) {
      const source = readFileSync(file, 'utf8');
      const patterns = [
        /httpError\(\s*\d+\s*,\s*"([a-z_]+)"/g, // the shared test helper
        /"code"\s*:\s*"([a-z_]+)"/g, // hand-written error envelopes
      ];
      for (const pattern of patterns) {
        for (const match of source.matchAll(pattern)) {
          const code = match[1]!;
          assertionsChecked += 1;
          if (!android.has(code) && !DELIBERATELY_INVENTED.has(code)) {
            const line = source.slice(0, match.index).split('\n').length;
            offenders.push(`${relative(ROOT, file)}:${line} asserts on '${code}', which no wire code declares`);
          }
        }
      }
    }

    expect(assertionsChecked).toBeGreaterThan(5);
    expect(offenders.sort()).toEqual([]);
  });
});

describe('Phase D wiring that only a Gradle build would otherwise catch', () => {
  /**
   * WHY: an unknown `libs.foo` accessor is a Gradle *configuration* failure, not
   * a Kotlin compile error, so it aborts the build before anything is compiled
   * and the message names the script rather than the cause. The version catalog
   * is a plain TOML file and the accessor names are derivable from it, so a typo
   * is decidable here.
   */
  it('resolves every libs.* accessor to an alias in the version catalog', () => {
    const catalog = readFileSync(join(ANDROID, 'gradle', 'libs.versions.toml'), 'utf8');

    const section = (name: string) =>
      new RegExp(`^\\[${name}\\]([\\s\\S]*?)(?=^\\[|$(?![\\s\\S]))`, 'm').exec(catalog)?.[1] ?? '';
    // Catalog accessors spell a dashed alias with dots: `androidx-core-ktx` is
    // reached as `libs.androidx.core.ktx`.
    const aliases = (body: string) =>
      new Set([...body.matchAll(/^([A-Za-z0-9_.-]+)\s*=/gm)].map((m) => m[1]!));
    const libraries = aliases(section('libraries'));
    const plugins = aliases(section('plugins'));
    expect(libraries.size).toBeGreaterThan(20);
    expect(plugins.size).toBeGreaterThan(3);

    const resolves = (alias: string, pool: Set<string>) =>
      pool.has(alias) || pool.has(alias.replaceAll('.', '-'));

    const offenders: string[] = [];
    let checked = 0;
    for (const file of kotlinOrScriptFiles().filter((f) => f.endsWith('.gradle.kts'))) {
      // Comments name the catalog file itself (`libs.versions.toml`), which is
      // not an accessor. Only real code is scanned.
      const source = stripKotlinComments(readFileSync(file, 'utf8'));
      const where = relative(ROOT, file);
      for (const match of source.matchAll(/\blibs\.plugins\.([A-Za-z0-9_.]+)/g)) {
        checked += 1;
        if (!resolves(match[1]!, plugins)) offenders.push(`${where}: libs.plugins.${match[1]}`);
      }
      for (const match of source.matchAll(/\blibs\.(?!plugins\.)([A-Za-z0-9_.]+)/g)) {
        checked += 1;
        if (!resolves(match[1]!, libraries)) offenders.push(`${where}: libs.${match[1]}`);
      }
    }
    expect(checked).toBeGreaterThan(50);
    expect(offenders.sort()).toEqual([]);
  });

  /**
   * WHY: `retrofit2.converter.kotlinx.serialization` needs a generated
   * serializer for every response type. A DTO missing `@Serializable` fails in
   * KSP with a message that points at the converter, not at the forgotten
   * annotation.
   */
  it('annotates every network DTO with @Serializable', () => {
    const dtoDir = join(ANDROID, 'core', 'network', 'src', 'main', 'kotlin',
      'com', 'maharanitraders', 'core', 'network', 'dto');
    const offenders: string[] = [];
    let checked = 0;

    for (const file of walk(dtoDir).filter((f) => f.endsWith('.kt'))) {
      const lines = readFileSync(file, 'utf8').split('\n');
      for (let i = 0; i < lines.length; i += 1) {
        const declared = /^\s*(?:data )?class (\w+)/.exec(lines[i]!);
        if (!declared) continue;
        checked += 1;
        // Annotations sit directly above the declaration; a KDoc block ends the run.
        let annotated = false;
        for (let j = i - 1; j >= 0; j -= 1) {
          const line = lines[j]!.trim();
          if (line.startsWith('@')) {
            if (line.startsWith('@Serializable')) annotated = true;
            continue;
          }
          break;
        }
        if (!annotated) {
          offenders.push(`${relative(ROOT, file)}:${i + 1} class ${declared[1]} has no @Serializable`);
        }
      }
    }
    expect(checked).toBeGreaterThan(10);
    expect(offenders.sort()).toEqual([]);
  });

  /**
   * WHY: a Retrofit `@Query("...")` whose name the server does not read is
   * silently dropped — the request succeeds, the filter does nothing, and the
   * shopper sees an unfiltered list with a control that appears to work. That is
   * the exact failure the migration contract forbids, and it is invisible to both
   * the Kotlin compiler and the route tests.
   */
  it('only sends catalogue query parameters the server actually reads', () => {
    const parser = readFileSync(join(ROOT, 'lib', 'mobile', 'catalog.ts'), 'utf8');
    const route = readFileSync(
      join(ROOT, 'app', 'api', 'mobile', 'v1', 'catalog', 'products', 'route.ts'), 'utf8');

    const server = new Set<string>([
      ...[...parser.matchAll(/search\.get\('([A-Za-z]+)'\)/g)].map((m) => m[1]!),
      // The cursor is consumed by the route, not by the filter parser.
      ...[...route.matchAll(/searchParams\.get\('([A-Za-z]+)'\)/g)].map((m) => m[1]!),
    ]);
    expect(server.has('q')).toBe(true);
    expect(server.has('cursor')).toBe(true);

    const api = readFileSync(join(ANDROID, 'core', 'network', 'src', 'main', 'kotlin',
      'com', 'maharanitraders', 'core', 'network', 'MaharaniApi.kt'), 'utf8');
    // Scope to the catalogue endpoints only: extract the section between the
    // "Phase D" comment and the "Phase E" comment, then read all @Query params
    // from that section. Other endpoints (orders, notifications, etc.) have their
    // own server-side query contracts and are tested independently.
    const phaseD = /Phase D[\s\S]*?Phase E/.exec(api)?.[0] ?? api;
    const sent = [...phaseD.matchAll(/@Query\("([A-Za-z]+)"\)/g)].map((m) => m[1]!);
    expect(sent.length).toBeGreaterThan(3);

    const unknown = sent.filter((name) => !server.has(name));
    expect(unknown).toEqual([]);
  });

  /**
   * WHY: `ignoreUnknownKeys` is what lets the server add a field without
   * breaking every installed app. It is one line, easy to lose in a refactor, and
   * the failure only appears in production on the next additive change.
   * `tests/../CatalogSerializationTest.kt` decodes with the same three settings,
   * so they have to stay identical or that test proves nothing about the app.
   */
  it('keeps the production Json lenient, matching the serialization test', () => {
    const networkModule = readFileSync(join(ANDROID, 'core', 'network', 'src', 'main', 'kotlin',
      'com', 'maharanitraders', 'core', 'network', 'di', 'NetworkModule.kt'), 'utf8');
    const production = /fun provideJson\(\): Json = Json \{([\s\S]*?)\n  \}/.exec(networkModule)?.[1] ?? '';

    for (const setting of ['ignoreUnknownKeys = true', 'explicitNulls = false', 'coerceInputValues = true']) {
      expect(production, `NetworkModule must keep \`${setting}\``).toContain(setting);
    }

    const test = readFileSync(join(ANDROID, 'core', 'network', 'src', 'test', 'kotlin',
      'com', 'maharanitraders', 'core', 'network', 'CatalogSerializationTest.kt'), 'utf8');
    const tested = /private val json = Json \{([\s\S]*?)\n  \}/.exec(test)?.[1] ?? '';
    for (const setting of ['ignoreUnknownKeys = true', 'explicitNulls = false', 'coerceInputValues = true']) {
      expect(tested, `CatalogSerializationTest must mirror \`${setting}\``).toContain(setting);
    }
  });
});

describe('The Coil pin stays inside what the toolchain allows', () => {
  /**
   * WHY: this exact class of failure cannot be seen by anything in this repo —
   * it is AAR *metadata* checked at build time. Commit `ced2d85` was the first
   * to consume the pre-existing `coil` alias, and CI failed on
   * `:app:checkDebugAarMetadata`:
   *
   *   Dependency 'io.coil-kt.coil3:coil-compose-android:3.6.3' requires libraries
   *   and applications that depend on it to compile against version 37 or later
   *   of the Android APIs. :app is currently compiled against android-36.
   *
   * Coil 3.6.0 raised its compile SDK to 37 (its changelog says so), and AGP
   * 9.0.1 tops out at 36. 3.5.0 is not a workaround: it is built against Compose
   * 1.11.1, newer than this project's `composeUi` pin, so Gradle would resolve
   * Compose upward and upgrade it app-wide. The ceilings below are a snapshot of
   * Coil's published requirements; raise them together with compileSdk, AGP and
   * the `platforms;android-NN` pin in `.github/workflows/android-apk.yml`.
   */
  it('does not require a compileSdk or Compose newer than the project pins', () => {
    const catalog = readFileSync(join(ANDROID, 'gradle', 'libs.versions.toml'), 'utf8');
    const pin = (name: string) => new RegExp(`^${name} = "([^"]+)"`, 'm').exec(catalog)?.[1];

    const coil = pin('coil');
    const composeUi = pin('composeUi');
    expect(coil, 'libs.versions.toml must pin coil').toBeTruthy();
    expect(composeUi, 'libs.versions.toml must pin composeUi').toBeTruthy();

    const parts = (v: string) => v!.split(/[.\-]/).slice(0, 3).map((n) => Number.parseInt(n, 10) || 0);
    const atLeast = (v: string, floor: number[]) => {
      const a = parts(v);
      for (let i = 0; i < 3; i += 1) {
        if ((a[i] ?? 0) > (floor[i] ?? 0)) return true;
        if ((a[i] ?? 0) < (floor[i] ?? 0)) return false;
      }
      return true;
    };

    // The highest compileSdk any consuming module declares.
    let compileSdk = 0;
    for (const file of kotlinOrScriptFiles().filter((f) => f.endsWith('.gradle.kts'))) {
      for (const match of readFileSync(file, 'utf8').matchAll(/version\s*=\s*release\((\d+)\)/g)) {
        compileSdk = Math.max(compileSdk, Number.parseInt(match[1]!, 10));
      }
    }
    expect(compileSdk, 'a module must declare compileSdk').toBeGreaterThanOrEqual(36);

    // Coil 3.6.0 -> AAR metadata requires compileSdk 37.
    if (atLeast(coil!, [3, 6, 0])) {
      expect(compileSdk, `coil ${coil} requires compileSdk 37+`).toBeGreaterThanOrEqual(37);
    }
    // Coil 3.5.0 -> built against Compose 1.11.1.
    if (atLeast(coil!, [3, 5, 0])) {
      expect(atLeast(composeUi!, [1, 11, 1]),
        `coil ${coil} is built against Compose 1.11.1, which would upgrade composeUi ${composeUi}`).toBe(true);
    }
  });
});

describe('Compose and Coil Modifier extensions are imported where they are used', () => {
  /**
   * WHY: `clickable`, `background`, `clip`, `testTag` and friends are extension
   * functions on `Modifier`, so importing `androidx.compose.ui.Modifier` does not
   * put them in scope. The failure is a bare `Unresolved reference` at the call
   * site and nothing else hints at the missing import.
   *
   * `:feature:catalog`'s `ProductDetailScreen.kt` reached CI this way — one
   * `.clickable(…)` at line 285 with no `androidx.compose.foundation.clickable`.
   *
   * Only extensions whose names are unambiguous are listed. Deliberately absent:
   * `size`, `padding`, `height`, `width`, `map`, `filter`, `first` — all also
   * stdlib collection members, so a naive check would flag correct code.
   */
  const EXTENSIONS: Record<string, string> = {
    clickable: 'androidx.compose.foundation.clickable',
    background: 'androidx.compose.foundation.background',
    border: 'androidx.compose.foundation.border',
    clip: 'androidx.compose.ui.draw.clip',
    testTag: 'androidx.compose.ui.platform.testTag',
    verticalScroll: 'androidx.compose.foundation.verticalScroll',
    horizontalScroll: 'androidx.compose.foundation.horizontalScroll',
    crossfade: 'coil3.request.crossfade',
  };

  it('imports every Modifier extension it calls', () => {
    const offenders: string[] = [];
    let checked = 0;

    for (const file of kotlinFiles()) {
      const source = readFileSync(file, 'utf8');
      const imports = new Set([...source.matchAll(/^import\s+([\w.]+)/gm)].map((m) => m[1]!));

      for (const [extension, required] of Object.entries(EXTENSIONS)) {
        const used = new RegExp(`\\.\\s*${extension}\\s*[({]`).exec(source);
        if (!used) continue;
        checked += 1;
        if (!imports.has(required)) {
          const line = source.slice(0, used.index).split('\n').length;
          offenders.push(`${relative(ROOT, file)}:${line} calls .${extension}(…) without importing ${required}`);
        }
      }
    }
    expect(checked).toBeGreaterThan(10);
    expect(offenders.sort()).toEqual([]);
  });
});
