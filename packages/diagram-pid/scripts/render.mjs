// Renders .mmd files to SVG with the built plugin (pnpm build first), for comparing layouts
// outside the tests:  node scripts/render.mjs OUT_DIR file.mmd ...
// Prints the time per diagram.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { icons } from '@mermaid-js/plugin-icons';
import { createMermaid } from 'mermaid';
import { pid } from '../dist/index.js';

const [out, ...files] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const mermaid = createMermaid();
await mermaid.registerExternalDiagrams([pid, icons]);
mermaid.registerIconPacks([{ name: 'mdi', loader: () => import('@iconify-json/mdi/icons.json', { with: { type: 'json' } }).then((m) => m.default) }]);
for (const f of files) {
  const name = basename(f).replace(/\.mmd$/, '');
  const t = performance.now();
  const { svg } = await mermaid.render(name.replace(/\W/g, '-'), readFileSync(f, 'utf8'));
  const ms = performance.now() - t;
  writeFileSync(`${out}/${name}.svg`, svg);
  console.log(`${name.padEnd(20)} ${ms.toFixed(0).padStart(6)} ms`);
}
