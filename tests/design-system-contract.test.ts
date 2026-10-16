import { execFileSync, spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');
const read = (file: string) => readFileSync(join(ROOT, file), 'utf8');
const registry = JSON.parse(read('design/tokens.json')) as {
  families: Record<string, { tokens: Record<string, string> }>;
  semantic: Record<string, { ref: string; description: string }>;
  contrastPairs: { name: string; foreground: string; background: string; minimum: number }[];
};

const kebab = (value: string) => value.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/\./g, '-').toLowerCase();
const pascal = (value: string) => value.split(/[.\-_]/).filter(Boolean).map((part) => part[0]!.toUpperCase() + part.slice(1)).join('');

function walk(path: string): string[] {
  const absolute = join(ROOT, path);
  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const child = join(absolute, entry.name);
    return entry.isDirectory() ? walk(relative(ROOT, child)) : [child];
  });
}

function resolveToken(ref: string): string {
  const [familyOrSemantic, shade] = ref.split('.');
  if (shade === undefined) throw new Error(`Invalid token reference: ${ref}`);
  const semantic = registry.semantic[ref];
  if (semantic) return resolveToken(semantic.ref);
  const value = registry.families[familyOrSemantic!]?.tokens[shade];
  if (!value) throw new Error(`Unknown token reference: ${ref}`);
  return value;
}

function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16) / 255);
  const linear = channels.map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
}

function contrastRatio(foreground: string, background: string): number {
  const [lighter, darker] = [relativeLuminance(foreground), relativeLuminance(background)].sort((a, b) => b - a);
  return (lighter! + 0.05) / (darker! + 0.05);
}

function hslFromRgb(red: number, green: number, blue: number): [number, number, number] {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const lightness = (max + min) / 2;
  if (delta === 0) return [0, 0, lightness];
  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  let hue: number;
  if (max === r) hue = ((g - b) / delta) % 6;
  else if (max === g) hue = (b - r) / delta + 2;
  else hue = (r - g) / delta + 4;
  hue = ((hue * 60) % 360 + 360) % 360;
  return [hue, saturation, lightness];
}

function isProhibitedChromaticRed(red: number, green: number, blue: number): boolean {
  const [hue, saturation, lightness] = hslFromRgb(red, green, blue);
  // Clearly light pastel pink is allowed. Darker/mid-tone pink-red hues
  // (including saturated pink, dusty rose, wine, crimson and maroon) are not.
  return saturation >= 0.18 && lightness < 0.86 && (hue >= 285 || hue <= 20);
}

const sourceExtensions = new Set(['.tsx', '.ts', '.css', '.html', '.svg', '.kt', '.kts', '.xml']);
const uiSourceRoots = [
  'app',
  'components',
  'lib',
  'public',
  'android/app/src/main',
  'android/core/designsystem/src/main',
  'android/feature',
  'resources',
];
const uiSources = [
  ...uiSourceRoots.flatMap(walk),
  join(ROOT, 'tailwind.config.ts'),
].filter((file) => sourceExtensions.has(file.slice(file.lastIndexOf('.'))));
const rasterRoots = ['resources', 'android/app/src/main/res'];
const rasterAssets = [
  join(ROOT, 'public/apple-touch-icon.png'),
  join(ROOT, 'public/favicon.ico'),
  ...walk('public/icons'),
  ...rasterRoots.flatMap(walk),
].filter((file) => /\.(png|webp|ico)$/i.test(file));
const imageMagickAvailable = spawnSync('convert', ['-version'], { stdio: 'ignore' }).status === 0;

function redMatchesInImage(file: string): number {
  const histogram = execFileSync('convert', [
    file,
    '-background', '#FFFFFF', '-alpha', 'remove', '-alpha', 'off',
    '-colorspace', 'HSL', '-depth', '8', '-format', '%c', 'histogram:info:-',
  ], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  for (const match of histogram.matchAll(/hsl\(\s*([\d.]+),\s*([\d.]+)%,\s*([\d.]+)%\s*\)/gi)) {
    const hue = Number(match[1]);
    const saturation = Number(match[2]) / 100;
    const lightness = Number(match[3]) / 100;
    // Brand raster artwork is violet/white rather than a pink surface, so
    // darker chromatic red/pink fringes fail while clearly light pastel edges pass.
    if (saturation >= 0.18 && lightness < 0.92 && (hue >= 285 || hue <= 20)) return 1;
  }
  return 0;
}

describe('shared web and Compose design-token contract', () => {
  const generatedCss = read('app/design-tokens.generated.css');
  const generatedKotlin = read('android/core/designsystem/src/main/kotlin/com/maharanitraders/core/designsystem/theme/Color.kt');

  it('keeps the documented 117 palette values, 12 families and 39 semantic aliases', () => {
    const familyCount = Object.keys(registry.families).length;
    const paletteCount = Object.values(registry.families).reduce((total, family) => total + Object.keys(family.tokens).length, 0);
    expect(familyCount).toBe(12);
    expect(paletteCount).toBe(117);
    expect(Object.keys(registry.semantic)).toHaveLength(39);
    expect(read('docs/design-system.md')).toContain('117 documented palette tokens across 12 coherent families');
  });

  it('matches every canonical palette hex in generated CSS and Kotlin', () => {
    const cssPalette = new Map([...generatedCss.matchAll(/^\s*--palette-([\w-]+):\s*(#[0-9A-F]{6});$/gim)].map((match) => [match[1]!, match[2]!.toUpperCase()]));
    const kotlinPalette = new Map([...generatedKotlin.matchAll(/^\s*val\s+(\w+)\s*=\s*Color\(0xFF([0-9A-F]{6})\)$/gm)].map((match) => [match[1]!, `#${match[2]!.toUpperCase()}`]));

    for (const [family, definition] of Object.entries(registry.families)) {
      for (const [shade, hex] of Object.entries(definition.tokens)) {
        const cssName = `${kebab(family)}-${kebab(shade)}`;
        const kotlinName = `${pascal(family)}${pascal(shade)}`;
        expect(cssPalette.get(cssName), `missing CSS palette token ${cssName}`).toBe(hex.toUpperCase());
        expect(kotlinPalette.get(kotlinName), `missing Compose palette token ${kotlinName}`).toBe(hex.toUpperCase());
      }
    }
  });

  it('matches all 39 semantic aliases in web CSS and Compose', () => {
    for (const [name, definition] of Object.entries(registry.semantic)) {
      const [family, shade] = definition.ref.split('.');
      const cssAlias = new RegExp(`--color-${kebab(name)}:\\s*var\\(--palette-${kebab(family!)}-${kebab(shade!)}\\);`);
      const kotlinAlias = new RegExp(`\\bval ${pascal(name)} = ${pascal(family!)}${pascal(shade!)}\\b`);
      expect(generatedCss, `missing CSS alias ${name}`).toMatch(cssAlias);
      expect(generatedKotlin, `missing Compose alias ${name}`).toMatch(kotlinAlias);
    }
    expect([...generatedCss.matchAll(/^\s*(--color-[\w-]+):\s*var\(/gm)].filter((match) => !match[1]!.endsWith('-rgb'))).toHaveLength(39);
  });

  it('passes every documented WCAG contrast pair in light and dark roles', () => {
    expect(registry.contrastPairs.length).toBeGreaterThanOrEqual(18);
    for (const pair of registry.contrastPairs) {
      const ratio = contrastRatio(resolveToken(pair.foreground), resolveToken(pair.background));
      expect(ratio, `${pair.name}: ${ratio.toFixed(2)}:1 < ${pair.minimum}:1`).toBeGreaterThanOrEqual(pair.minimum);
    }
  });
});

describe('retailer source-level contrast and target-size acceptance', () => {
  it('raises every previously measured normal-text pair and keeps qualifying large text above 3:1', () => {
    const measuredPairs = [
      ['slate.600', 'foundation.white'],
      ['slate.600', 'ivory.50'],
      ['slate.600', 'slate.50'],
      ['violet.600', 'violet.50'],
    ] as const;
    for (const [foreground, background] of measuredPairs) {
      const ratio = contrastRatio(resolveToken(foreground), resolveToken(background));
      expect(ratio, `${foreground} on ${background}: ${ratio.toFixed(2)}:1 < 4.5:1`).toBeGreaterThanOrEqual(4.5);
    }

    // The retailer's large price/heading colors are stronger than the 3:1
    // large-text threshold on the actual light surfaces used by these cards.
    for (const [foreground, background] of [
      ['violet.600', 'ivory.50'],
      ['navy.900', 'foundation.white'],
    ] as const) {
      const ratio = contrastRatio(resolveToken(foreground), resolveToken(background));
      expect(ratio, `${foreground} on ${background}: ${ratio.toFixed(2)}:1 < 3:1`).toBeGreaterThanOrEqual(3);
    }

    const normalTextSources = [
      'components/retailer/cart-item-row.tsx',
      'components/retailer/cart-checkout-bar.tsx',
      'components/retailer/cart-order-summary.tsx',
      'components/retailer/pack-selector.tsx',
      'components/retailer/variant-switcher.tsx',
      'components/retailer/pricing-schedule.tsx',
      'app/retailer/catalog/[id]/page.tsx',
    ];
    for (const file of normalTextSources) {
      expect(read(file), `${file} still uses the measured low-contrast slate.400 text`).not.toContain('text-slate-400');
    }
    expect(read('components/retailer/variant-switcher.tsx')).not.toContain('text-primary-300');
    expect(read('components/retailer/product-gallery.tsx')).not.toContain('text-slate-300');
  });

  it('keeps form-control boundaries and focus indicators at or above 3:1', () => {
    const white = resolveToken('foundation.white');
    const slate50 = resolveToken('slate.50');
    const violet50 = resolveToken('violet.50');
    expect(contrastRatio(resolveToken('slate.400'), white)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(resolveToken('slate.400'), slate50)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(resolveToken('violet.500'), violet50)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(resolveToken('violet.600'), white)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(resolveToken('focus.outline'), white)).toBeGreaterThanOrEqual(3);

    const controls = [
      ['components/retailer/search-field.tsx', 'border-slate-400', 'focus:border-action-600'],
      ['components/retailer/qty-stepper.tsx', 'border border-slate-400', 'focus-visible:ring-primary-600'],
      ['components/retailer/pack-selector.tsx', 'border-slate-400', 'focus-visible:ring-primary-600'],
      ['components/retailer/product-feedback.tsx', 'border border-slate-400', 'focus:border-primary-600'],
      ['components/retailer/cart-save-controls.tsx', 'border-slate-400', 'focus:border-primary-600'],
    ] as const;
    for (const [file, boundary, focus] of controls) {
      const source = read(file);
      expect(source, `${file} is missing a 3:1 form boundary`).toContain(boundary);
      expect(source, `${file} is missing a high-contrast focus state`).toContain(focus);
    }
  });

  it('keeps the reported retailer buttons, icon controls and mobile navigation at 44px minimum', () => {
    const targets = [
      ['components/layout/retailer-shell.tsx', 'h-11 w-11'],
      ['components/layout/mobile-bottom-nav.tsx', 'min-h-11 min-w-11'],
      ['components/retailer/search-field.tsx', 'h-11 w-11'],
      ['components/retailer/product-card.tsx', 'h-11 w-11'],
      ['components/retailer/product-gallery.tsx', 'h-11 w-11'],
      ['components/retailer/promo-carousel.tsx', 'h-11 w-11'],
      ['components/retailer/pack-selector.tsx', 'min-h-11 min-w-11'],
      ['components/retailer/cart-item-row.tsx', 'min-h-11 min-w-11'],
      ['components/retailer/product-feedback.tsx', 'h-11 w-11'],
      ['components/retailer/favorite-toggle.tsx', 'h-11 w-11'],
      ['components/retailer/share-button.tsx', 'h-11 w-11'],
      ['components/retailer/variant-switcher.tsx', 'min-h-11'],
      ['components/retailer/home-content.tsx', 'min-h-11'],
      ['components/retailer/cart-save-controls.tsx', 'min-h-11'],
      ['components/retailer/clear-cart-button.tsx', 'min-h-11'],
      ['app/retailer/cart/page.tsx', 'h-11 items-center gap-1.5'],
      ['app/retailer/catalog/[id]/page.tsx', 'min-h-11 min-w-11'],
    ] as const;
    for (const [file, targetClass] of targets) {
      expect(read(file), `${file} is missing its 44px target class (${targetClass})`).toContain(targetClass);
    }
    expect(read('components/retailer/product-card.tsx')).toContain('min-h-11 w-full');
    expect(read('components/retailer/search-field.tsx')).toContain('min-h-11 w-full');
    expect(read('components/retailer/promo-carousel.tsx')).not.toMatch(/w-6|sm:w-8/);
  });
});

describe('prohibited-colour audit', () => {
  it('rejects red-family and off-system colour utilities, legacy palette names, and red alert markers', () => {
    const violations: string[] = [];
    const forbiddenUtility = /\b(?:bg|text|border|ring|outline|fill|stroke|from|via|to)-(?:red|rose|pink|fuchsia|crimson|maroon|wine|blue|green|emerald|cyan|teal|lime|indigo|purple|orange|gray|gold|yellow|zinc|neutral)(?:-[0-9]{2,3})?(?:\/[0-9]{1,3})?\b|\b(?:BrandRed|OutOfStockRose|brand_red)\w*\b|\bColor\.(?:Red|Magenta|Pink|Orange|Yellow|Cyan|Teal|Green|Blue|Gray|Purple|Indigo)\b|🔴/i;
    const redRgb = /\b(?:rgba?)\(\s*(\d{1,3})(?:\s*,\s*|\s+)(\d{1,3})(?:\s*,\s*|\s+)(\d{1,3})/gi;
    const redHsl = /\b(?:hsla?)\(\s*([0-9.]+)(?:deg)?\s*[, ]\s*([0-9.]+)%\s*[, ]\s*([0-9.]+)%/gi;

    for (const file of uiSources) {
      const source = readFileSync(file, 'utf8');
      if (forbiddenUtility.test(source)) violations.push(`${relative(ROOT, file)}: prohibited colour utility/name or red marker`);
      for (const match of source.matchAll(/#([\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})\b/gi)) {
        const encoded = match[1]!;
        const hex = encoded.length <= 4 ? [...encoded.slice(0, 3)].map((channel) => channel + channel).join('') : encoded.slice(0, 6);
        const rgb = [0, 2, 4].map((index) => Number.parseInt(hex.slice(index, index + 2), 16));
        if (isProhibitedChromaticRed(rgb[0]!, rgb[1]!, rgb[2]!)) violations.push(`${relative(ROOT, file)}: #${encoded}`);
      }
      for (const match of source.matchAll(/\b0x(?:[\da-f]{2})?([\da-f]{6})\b/gi)) {
        const hex = match[1]!;
        const rgb = [0, 2, 4].map((index) => Number.parseInt(hex.slice(index, index + 2), 16));
        if (isProhibitedChromaticRed(rgb[0]!, rgb[1]!, rgb[2]!)) violations.push(`${relative(ROOT, file)}: 0x${match[0].slice(2)}`);
      }
      for (const match of source.matchAll(redRgb)) {
        const rgb = match.slice(1, 4).map(Number);
        if (isProhibitedChromaticRed(rgb[0]!, rgb[1]!, rgb[2]!)) violations.push(`${relative(ROOT, file)}: rgb(${rgb.join(', ')})`);
      }
      for (const match of source.matchAll(redHsl)) {
        const hue = Number(match[1]) % 360;
        const saturation = Number(match[2]) / 100;
        const lightness = Number(match[3]) / 100;
        if (saturation >= 0.18 && lightness < 0.86 && (hue >= 285 || hue <= 20)) violations.push(`${relative(ROOT, file)}: hsl(${match.slice(1, 4).join(', ')})`);
      }
      const sourceExtension = file.slice(file.lastIndexOf('.'));
      const cssOrVector = ['.css', '.html', '.svg', '.xml'].includes(sourceExtension);
      const namedRed = '(?:red|darkred|crimson|maroon|wine|burgundy|scarlet|rose|pink|hotpink|deeppink|firebrick|indianred|tomato|salmon|coral|lightcoral|palevioletred)';
      if (cssOrVector) {
        const namedCssColour = new RegExp(`(?:\\b(?:background(?:-color|-image)?|color|border(?:-color)?|outline(?:-color)?|box-shadow|fill|stroke|stop-color)\\s*:\\s*[^;{}]*?|\\b(?:fill|stroke|stop-color|color)\\s*=\\s*["'][^"']*?)\\b${namedRed}\\b`, 'i');
        const namedCssVariable = new RegExp(`--[\\w-]+\\s*:\\s*[^;{}]*?\\b${namedRed}\\b`, 'i');
        const cssWithoutVariableReferences = source.replace(/var\(\s*--[\w-]+(?:\s*,[^)]*)?\)/gi, 'var()');
        if (namedCssColour.test(cssWithoutVariableReferences) || namedCssVariable.test(cssWithoutVariableReferences)) {
          violations.push(`${relative(ROOT, file)}: named red-family CSS/SVG colour`);
        }
      }
      const inlineStyleRed = new RegExp(`\\b(?:backgroundColor|color|borderColor|outlineColor|fill|stroke|stopColor)\\s*:\\s*["'\\x60]?\\s*${namedRed}\\b`, 'i');
      const svgAttributeRed = new RegExp(`\\b(?:fill|stroke|stop-color|stopColor|color)\\s*=\\s*["']\\s*${namedRed}\\b`, 'i');
      if (inlineStyleRed.test(source) || svgAttributeRed.test(source)) {
        violations.push(`${relative(ROOT, file)}: named red-family inline/SVG colour`);
      }
      const arbitraryRedUtility = new RegExp(`\\b(?:bg|text|border|ring|outline|fill|stroke|from|via|to)-\\[[^\\]]*\\b${namedRed}\\b[^\\]]*\\]`, 'gi');
      for (const match of source.matchAll(arbitraryRedUtility)) {
        violations.push(`${relative(ROOT, file)}: ${match[0]}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('keeps pastel-pink utility use out of action, navigation, brand and status surfaces', () => {
    const pinkUtility = /\b(?:bg|text|border|ring|outline|fill|stroke|from|via|to)-(?:blush|pastelPink|pastel-pink)(?:-[0-9]{2,3})?(?:\/[0-9]{1,3})?\b/gi;
    const violations: string[] = [];
    for (const file of uiSources) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(pinkUtility)) {
        violations.push(`${relative(ROOT, file)}: ${match[0]}`);
      }
    }

    expect(violations).toEqual([]);
    expect(read('app/globals.css')).toContain('.discovery-tile:nth-child(5n+1) { --aisle-color: var(--palette-pastel-pink-100); }');
    expect(read('components/retailer/category-card.tsx')).toContain('bg-[var(--aisle-color)]');
  });

  const imageTest = imageMagickAvailable ? it : it.skip;
  imageTest('keeps red branding out of PWA, Android launcher and splash raster assets', () => {
    const violations = rasterAssets.filter((file) => redMatchesInImage(file) > 0).map((file) => relative(ROOT, file));
    expect(violations).toEqual([]);
  });
});

describe('visual role mappings', () => {
  it('uses violet actions, lavender selection, ivory surfaces, and semantic status tones', () => {
    const button = read('components/ui/button.tsx');
    const retailerShell = read('components/layout/retailer-shell.tsx');
    const catalogueNav = read('components/retailer/catalogue-nav.tsx');
    const mobileNav = read('components/layout/mobile-bottom-nav.tsx');
    const productCard = read('components/retailer/product-card.tsx');
    const promoBanner = read('components/retailer/promo-banner.tsx');
    const adminStatus = read('components/admin/status-badge.tsx');
    const nativeTheme = read('android/core/designsystem/src/main/kotlin/com/maharanitraders/core/designsystem/theme/Theme.kt');
    const nativeTabs = read('android/feature/catalog/src/main/kotlin/com/maharanitraders/feature/catalog/ui/components/CatalogTabStrip.kt');

    expect(button).toContain('bg-primary-600 text-white hover:bg-primary-700');
    expect(retailerShell).toContain('bg-ivory-100');
    expect(retailerShell).toContain('bg-white/95');
    expect(retailerShell).toContain("active ? 'text-primary-600' : 'text-slate-600 hover:text-primary-600'");
    expect(catalogueNav).toContain("active === key ? 'bg-lavender-100 text-primary-700'");
    expect(mobileNav).toContain('bg-lavender-100');
    expect(productCard).toContain('text-primary-600');
    expect(productCard).toContain('bg-mint-50 text-mint-800');
    expect(productCard).toContain('bg-slate-100 text-slate-700');
    expect(productCard).toContain('bg-action-600');
    expect(productCard).toContain('text-error-700');
    expect(promoBanner).toContain('bg-peach-50');
    expect(promoBanner).toContain('bg-action-600');
    expect(adminStatus).toContain("confirmed: 'bg-mint-50 text-mint-700'");
    expect(adminStatus).toContain("pending: 'bg-amber-50 text-amber-700'");
    expect(adminStatus).toContain("cancelled: 'bg-primary-50 text-primary-700'");
    expect(nativeTheme).toContain('primary = MaharaniPalette.ActionPrimary');
    expect(nativeTheme).toContain('error = MaharaniPalette.StatusErrorIcon');
    expect(nativeTabs).toContain('MaterialTheme.colorScheme.primary');
  });
});

describe('responsive and broken-image safety', () => {
  it('keeps page-level layouts within small screens and shows a token-based keyboard focus ring', () => {
    const css = read('app/globals.css');
    const docs = read('docs/design-system.md');
    expect(css).toContain("@import './design-tokens.generated.css'");
    expect(css).toContain('overflow-x: clip');
    expect(css).toContain('max-width: 100%');
    expect(css).toContain('outline: 3px solid var(--color-focus-outline)');
    expect(css).toContain('min-height: 44px');
    expect(docs).toContain('320, 360, 390, 768, 1024, and 1440 CSS pixels');
  });

  it('renders a labelled fallback instead of a broken web or Compose image', () => {
    const webImage = read('components/media/stored-image.tsx');
    const webCard = read('components/retailer/product-card.tsx');
    const nativeImage = read('android/feature/catalog/src/main/kotlin/com/maharanitraders/feature/catalog/ui/components/ProductImage.kt');
    expect(webImage).toContain('onError={() => setErroredSrc(resolved)}');
    expect(webImage).toContain('erroredSrc === resolved');
    expect(webCard).toContain('Image unavailable');
    expect(nativeImage).toContain('error = { ProductImageFallback(fallbackLabel, brandedMonogram) }');
    expect(nativeImage).toContain('contentDescription = fallbackLabel');
  });
});
