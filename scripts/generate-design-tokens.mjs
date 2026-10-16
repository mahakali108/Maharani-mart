#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const registry = JSON.parse(readFileSync(resolve(root, 'design/tokens.json'), 'utf8'));

const kebab = (value) => value.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/\./g, '-').toLowerCase();
const pascal = (value) => value
  .split(/[.\-_]/)
  .filter(Boolean)
  .map((part) => part[0].toUpperCase() + part.slice(1))
  .join('');
const resolveRef = (ref) => {
  const [family, shade] = ref.split('.');
  const value = registry.families[family]?.tokens[shade];
  if (!value) throw new Error(`Unknown design token reference: ${ref}`);
  return value;
};
const rgbChannels = (hex) => [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16)).join(' ');

let css = `/* Generated from design/tokens.json. Do not edit by hand. */\n:root {\n`;
for (const [family, definition] of Object.entries(registry.families)) {
  css += `  /* ${definition.description} */\n`;
  for (const [shade, value] of Object.entries(definition.tokens)) {
    css += `  --palette-${kebab(family)}-${kebab(shade)}: ${value};\n`;
    css += `  --palette-${kebab(family)}-${kebab(shade)}-rgb: ${rgbChannels(value)};\n`;
  }
}
css += '\n  /* Semantic aliases: prefer these names for UI roles. */\n';
for (const [semantic, definition] of Object.entries(registry.semantic)) {
  const [family, shade] = definition.ref.split('.');
  css += `  /* ${definition.description} */\n`;
  css += `  --color-${kebab(semantic)}: var(--palette-${kebab(family)}-${kebab(shade)});\n`;
  css += `  --color-${kebab(semantic)}-rgb: var(--palette-${kebab(family)}-${kebab(shade)}-rgb);\n`;
}
css += '}\n';

let kotlin = `// Generated from design/tokens.json. Do not edit by hand.\npackage com.maharanitraders.core.designsystem.theme\n\nimport androidx.compose.ui.graphics.Color\n\n/** Shared web/native colour registry. Semantic aliases below are the preferred UI API. */\nobject MaharaniPalette {\n`;
for (const [family, definition] of Object.entries(registry.families)) {
  const familyName = pascal(family);
  kotlin += `  // ${definition.description}\n`;
  for (const [shade, value] of Object.entries(definition.tokens)) {
    const property = `${familyName}${pascal(shade)}`;
    kotlin += `  val ${property} = Color(0xFF${value.slice(1).toUpperCase()})\n`;
  }
  kotlin += '\n';
}
kotlin += '  // Semantic aliases shared with web CSS custom properties.\n';
for (const [semantic, definition] of Object.entries(registry.semantic)) {
  const [family, shade] = definition.ref.split('.');
  const alias = pascal(semantic);
  const value = `${pascal(family)}${pascal(shade)}`;
  kotlin += `  /** ${definition.description} */\n  val ${alias} = ${value}\n`;
}
kotlin += '}\n';

writeFileSync(resolve(root, 'app/design-tokens.generated.css'), css);
writeFileSync(resolve(root, 'android/core/designsystem/src/main/kotlin/com/maharanitraders/core/designsystem/theme/Color.kt'), kotlin);
console.log(`Generated ${Object.values(registry.families).reduce((total, family) => total + Object.keys(family.tokens).length, 0)} palette tokens and ${Object.keys(registry.semantic).length} semantic aliases.`);
