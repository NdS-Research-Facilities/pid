// Clutter score per benchmark diagram: pnpm test (renders out/*.svg), pnpm build, then
//   node scripts/score.mjs [out/x.svg ...]      (default: every out/*.svg)
// Add --hits to list what each text box overlaps.
import { readdirSync, readFileSync } from 'node:fs';
import { clutter, labelHits } from '../packages/diagram-pid/dist/score.js';

const args = process.argv.slice(2);
const hits = args.includes('--hits');
const files = args.filter((a) => !a.startsWith('--'));
if (!files.length) for (const f of readdirSync('out').filter((f) => f.endsWith('.svg') && !f.startsWith('.')).sort()) files.push(`out/${f}`);

const cols = ['hops', 'bends', 'length', 'labelHits', 'area', 'overlaps', 'near', 'bumps', 'slanted', 'total'];
const name = (f) => f.split('/').pop().replace(/\.svg$/, '');
const rows = files.map((f) => [name(f), clutter(readFileSync(f, 'utf8'))]);
const w = Math.max(7, ...rows.map(([n]) => n.length));
console.log(['diagram'.padEnd(w), ...cols.map((c) => c.padStart(9))].join(' '));
const sum = Object.fromEntries(cols.map((c) => [c, 0]));
for (const [n, c] of rows) {
  for (const k of cols) sum[k] += c[k];
  console.log([n.padEnd(w), ...cols.map((k) => String(c[k]).padStart(9))].join(' '));
}
console.log(['TOTAL'.padEnd(w), ...cols.map((k) => String(Math.round(sum[k] * 100) / 100).padStart(9))].join(' '));
if (hits) for (const f of files) { const h = labelHits(readFileSync(f, 'utf8')); if (h.length) console.log(`${name(f)}: ${h.join(' ')}`); }
for (const [n, c] of rows) for (const k of ['overlaps', 'near', 'bumps', 'slanted']) if (c[k]) { console.error(`${n}: ${k} = ${c[k]} (must be 0)`); process.exitCode = 1; }
