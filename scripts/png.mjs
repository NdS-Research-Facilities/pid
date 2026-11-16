// Rasterize SVGs for previewing: node scripts/png.mjs out/x.svg [...]
import { readFileSync, writeFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';
for (const file of process.argv.slice(2)) {
  const svg = resolveVars(readFileSync(file, 'utf8'));
  const png = new Resvg(svg, { fitTo: { mode: 'zoom', value: 2 }, background: 'white', font: { loadSystemFonts: true, defaultFontFamily: 'DejaVu Sans' } }).render().asPng();
  writeFileSync(file.replace(/\.svg$/, '.png'), png);
}

/** resvg has no CSS custom properties: inline Mermaid's `var(--x, fallback)` chains. */
function resolveVars(svg) {
  const style = /style="([^"]*)"/.exec(svg)?.[1] ?? '';
  const decls = new Map();
  for (const m of style.replaceAll('&quot;', '"').matchAll(/(--[\w-]+):((?:[^;(]|\([^)]*\)?\)?)+)/g)) decls.set(m[1], m[2].trim());
  const resolve = (v, depth = 0) =>
    depth > 10 ? v : v.replace(/var\((--[\w-]+)(?:,((?:[^()]|\([^()]*(?:\([^()]*\))?[^()]*\))*))?\)/g, (_, name, fb) =>
      decls.has(name) ? resolve(decls.get(name), depth + 1) : fb !== undefined ? resolve(fb.trim(), depth + 1) : 'black');
  return svg.replace(/(fill|stroke|font-family)="(var\([^"]*)"/g, (_, a, v) => `${a}="${resolve(v.replaceAll("&quot;", "'")).replaceAll('"', "'")}"`);
}
