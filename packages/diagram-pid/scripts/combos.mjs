// Scores combinations of layout choices (all mirror/coil combos × each single reversed line,
// re-guessed or not): node scripts/combos.mjs file.mmd
import { readFileSync } from 'node:fs';
import { createMermaid } from 'mermaid';
import { icons } from '@mermaid-js/plugin-icons';
import { pid, planLayout, renderPid, clutter } from '../dist/index.js';
import { streamWriter } from '@mermaid-js/core/svg';

let plan, model, ctx;
const spy = { ...pid, layout: (m, c) => { model = m; ctx = c; plan = planLayout(m, c); return plan.layout(plan.guess); } };
const mermaid = createMermaid();
await mermaid.registerExternalDiagrams([spy, icons]);
mermaid.registerIconPacks([{ name: 'mdi', loader: () => import('@iconify-json/mdi/icons.json', { with: { type: 'json' } }).then((m) => m.default) }]);
await mermaid.render('x', readFileSync(process.argv[2], 'utf8'));
const score = (ch) => {
  const w = streamWriter({ gradient: ctx.theme.gradient(), idPrefix: () => ctx.idPrefix });
  renderPid(model, plan.layout(ch), ctx, w);
  return clutter(w.finish());
};
const bits = plan.free.filter((f) => f.kind !== 'reverse');
const revs = [null, ...plan.free.filter((f) => f.kind === 'reverse').map((f) => f.id)];
const results = [];
for (const r of revs) for (const reguess of r ? [false, true] : [false]) {
  const base = reguess ? plan.guessWith(new Set([r])) : { ...plan.guess, reversed: new Set(r ? [r] : []) };
  for (let m = 0; m < 1 << bits.length; m++) {
    const ch = { ...base, mirrored: new Set(base.mirrored), coilSides: new Map(base.coilSides), coilInletLow: new Set(base.coilInletLow) };
    bits.forEach((b, i) => {
      if (!(m >> i & 1)) return;
      if (b.kind === 'mirror') ch.mirrored.has(b.id) ? ch.mirrored.delete(b.id) : ch.mirrored.add(b.id);
      if (b.kind === 'coilSide') ch.coilSides.set(b.key, ch.coilSides.get(b.key) === 'left' ? 'right' : 'left');
      if (b.kind === 'inletLow') ch.coilInletLow.has(b.key) ? ch.coilInletLow.delete(b.key) : ch.coilInletLow.add(b.key);
    });
    const c = score(ch);
    const broken = c.overlaps + c.near + c.bumps + c.slanted;
    results.push({ name: `rev=${r}${reguess ? '(re)' : ''} bits=${m.toString(2)}`, total: c.total + 1000 * broken, c });
  }
}
results.sort((a, b) => a.total - b.total);
console.log(results.length, 'combos');
for (const r of results.slice(0, 8)) console.log(r.name.padEnd(32), r.total, `hops=${r.c.hops} bends=${r.c.bends} length=${r.c.length} hits=${r.c.labelHits}`);
