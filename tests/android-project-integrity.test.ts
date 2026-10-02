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

/** `pkg -> set(top-level declaration names)` across every Kotlin source set. */
function declaredSymbols(): Map<string, Set<string>> {
  const packages = new Map<string, Set<string>>();
  const declarationPatterns = [
    /^(?:@\w+(?:\([^)]*\))?\s*)*(?:internal\s+|private\s+|public\s+)?(?:annotation\s+class|fun\s+interface|enum\s+class|sealed\s+interface|sealed\s+class|data\s+class|class|object|interface|typealias)\s+([A-Za-z_]\w*)/,
    // extension functions: `fun UserRole.label(...)`
    /^fun\s+[\w.<>?,\s]+\.\s*([A-Za-z_]\w*)\s*\(/,
    /^fun\s+(?:<[^>]+>\s*)?([A-Za-z_]\w*)\s*\(/,
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
