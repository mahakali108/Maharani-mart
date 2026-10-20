#!/usr/bin/env node
/**
 * Generates the web-only marketing palette.
 *
 * Deliberately separate from generate-design-tokens.mjs:
 *   - the shared registry is cross-platform (web CSS + Compose Color.kt) and
 *     bans saturated pink/red branding;
 *   - the owner approved berry for retailer marketing surfaces only, and the
 *     native app is out of scope for this work.
 *
 * Output: app/marketing-tokens.generated.css. Never writes Kotlin.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const registry = JSON.parse(readFileSync(resolve(root, 'design/marketing-tokens.json'), 'utf8'));

const kebab = (value) => value.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/\./g, '-').toLowerCase();
const rgbChannels = (hex) => [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16)).join(' ');

function resolveRef(ref) {
  // Accept either `family.shade` or a semantic alias such as `text`.
  const semantic = registry.semantic[ref];
  if (semantic) return resolveRef(semantic.ref);
  const [family, shade] = ref.split('.');
  const value = registry.families[family]?.tokens[shade];
  if (!value) throw new Error(`Unknown marketing token reference: ${ref}`);
  return value;
}

// Fail the build (not just a test) if a marketing pair stops meeting contrast.
const luminance = (hex) => {
  const channels = [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16) / 255);
  const linear = channels.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
for (const pair of registry.contrastPairs ?? []) {
  const ratio = contrast(resolveRef(pair.foreground), resolveRef(pair.background));
  if (ratio < pair.minimum) {
    throw new Error(`${pair.name}: ${ratio.toFixed(2)}:1 is below the required ${pair.minimum}:1`);
  }
}

let css = '/* Generated from design/marketing-tokens.json. Do not edit by hand. */\n';
css += '/* Marketing-only berry palette. Do not use outside the allowlisted storefront marketing components. */\n';
css += ':root {\n';
for (const [family, definition] of Object.entries(registry.families)) {
  css += `  /* ${definition.description} */\n`;
  for (const [shade, value] of Object.entries(definition.tokens)) {
    css += `  --marketing-${kebab(family)}-${kebab(shade)}: ${value};\n`;
    css += `  --marketing-${kebab(family)}-${kebab(shade)}-rgb: ${rgbChannels(value)};\n`;
  }
}
css += '\n  /* Semantic marketing aliases: prefer these names in components. */\n';
for (const [semantic, definition] of Object.entries(registry.semantic)) {
  const [family, shade] = definition.ref.split('.');
  css += `  --marketing-${kebab(semantic)}: var(--marketing-${kebab(family)}-${kebab(shade)});\n`;
  css += `  --marketing-${kebab(semantic)}-rgb: var(--marketing-${kebab(family)}-${kebab(shade)}-rgb);\n`;
}
css += '}\n';

writeFileSync(resolve(root, 'app/marketing-tokens.generated.css'), css);
console.log(
  `Generated ${Object.values(registry.families).reduce((total, family) => total + Object.keys(family.tokens).length, 0)} marketing palette tokens and ${Object.keys(registry.semantic).length} aliases.`,
);
