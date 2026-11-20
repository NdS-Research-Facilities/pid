// Small steps: a short (< 15 px) segment between two parallel runs, i.e. a bump in a line.
import { readFileSync } from 'node:fs';
let total = 0;
for (const file of process.argv.slice(2)) {
  const svg = readFileSync(file, 'utf8');
  const found = [];
  for (const m of svg.matchAll(/<g class="stream [^"]*" data-id="edge-(s\d+)"[^>]*>\s*<path d="([^"]+)"/g)) {
    const p = [...m[2].matchAll(/[ML]\s*(-?[\d.]+)[ ,](-?[\d.]+)/g)].map((q) => ({ x: +q[1], y: +q[2] }));
    for (let k = 1; k + 2 < p.length + 1 && k + 1 < p.length; k++) {
      const [a, b, c, d] = [p[k - 1], p[k], p[k + 1], p[k + 2]];
      if (!d) continue;
      const len = Math.hypot(c.x - b.x, c.y - b.y);
      const h1 = Math.abs(a.y - b.y) < 0.5, h3 = Math.abs(c.y - d.y) < 0.5;
      const v1 = Math.abs(a.x - b.x) < 0.5, v3 = Math.abs(c.x - d.x) < 0.5;
      // The short segment must turn: vertical between two horizontal runs, or the other way round.
      const stepV = Math.abs(b.x - c.x) < 0.5, stepH = Math.abs(b.y - c.y) < 0.5;
      const bump = (h1 && h3 && stepV && Math.abs(a.y - d.y) > 0.5) || (v1 && v3 && stepH && Math.abs(a.x - d.x) > 0.5);
      if (len > 0.5 && len < 15 && bump) found.push(`${m[1]}:${Math.round(len)}px`);
    }
  }
  total += found.length;
  console.log(`${file.split('/').pop()}: ${found.length} ${found.join(' ')}`);
}
console.log('TOTAL', total);
