// Scores every single-choice variant of a diagram's layout: node scripts/candidates.mjs file.mmd
import { readFileSync } from 'node:fs';
import { createMermaid } from 'mermaid';
import { icons } from '@mermaid-js/plugin-icons';
import { pid, planLayout, renderPid, clutter } from '../dist/index.js';
import { sharedSides } from '../dist/render.js';
import { symbolHits } from '../dist/search.js';
import { streamWriter } from '@mermaid-js/core/svg';

const file = process.argv[2];
let plan, model, ctx;
const spy = { ...pid, layout: (m, c) => { model = m; ctx = c; plan = planLayout(m, c); return plan.layout(plan.guess); } };
const mermaid = createMermaid();
await mermaid.registerExternalDiagrams([spy, icons]);
mermaid.registerIconPacks([{ name: 'mdi', loader: () => import('@iconify-json/mdi/icons.json', { with: { type: 'json' } }).then((m) => m.default) }]);
await mermaid.render('x', readFileSync(file, 'utf8'));
const show = (name, ch, lay) => {
  const w = streamWriter({ gradient: ctx.theme.gradient(), idPrefix: () => ctx.idPrefix });
  const L = lay ?? plan.layout(ch);
  renderPid(model, L, ctx, w);
  const svg = w.finish();
  const c = { ...clutter(svg), through: symbolHits(svg, model, L).join(' ') };
  console.log(name.padEnd(40), ['hops', 'bends', 'length', 'labelHits', 'overlaps', 'near', 'bumps', 'slanted', 'total', 'through'].map((k) => `${k}=${c[k]}`).join(' '));
};
if (process.argv[3] === 'guess') { show('guess', plan.guess); process.exit(0); }
console.log('free:', JSON.stringify(plan.free));
console.log('guess:', [...plan.guess.mirrored], [...plan.guess.coilSides], [...plan.guess.coilInletLow]);
show('guess', plan.guess);
const base = plan.layout(plan.guess);
for (const { id, size } of sharedSides(model, base))
  for (let n = 0; n + 1 < size; n++) show(`swap ${id}#${n}`, null, { ...base, slotSwaps: new Set([`${id}#${n}`]) });
for (const f of plan.free) {
  const g = plan.guess;
  if (f.kind === 'reverse') { const m = new Set(g.reversed); m.add(f.id); show(`reverse ${f.id} ${model.streams.find((s) => s.id === f.id).name ?? ''}`, { ...g, reversed: m }); }
  if (f.kind === 'mirror') { const m = new Set(g.mirrored); m.has(f.id) ? m.delete(f.id) : m.add(f.id); show(`mirror ${f.id}`, { ...g, mirrored: m }); }
  if (f.kind === 'coilSide') { const m = new Map(g.coilSides); m.set(f.key, m.get(f.key) === 'left' ? 'right' : 'left'); show(`side ${f.key}`, { ...g, coilSides: m }); }
  if (f.kind === 'inletLow') { const m = new Set(g.coilInletLow); m.has(f.key) ? m.delete(f.key) : m.add(f.key); show(`low ${f.key}`, { ...g, coilInletLow: m }); }
}
