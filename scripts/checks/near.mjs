// Pairs of different lines running side by side closer than 6 px (but not on one track), over > 1 px.
import { readFileSync } from 'node:fs';
let total = 0;
for (const file of process.argv.slice(2)) {
  const svg = readFileSync(file, 'utf8');
  const lines = [...svg.matchAll(/<g class="stream [^"]*" data-id="edge-(s\d+)"[^>]*>\s*<path d="([^"]+)"/g)].map((m) => ({ id: m[1], pts: [...m[2].matchAll(/[ML]\s*(-?[\d.]+)[ ,](-?[\d.]+)/g)].map((p) => ({ x: +p[1], y: +p[2] })) }));
  const found = [];
  for (let i = 0; i < lines.length; i++) for (let j = i + 1; j < lines.length; j++) {
    const A = lines[i].pts, B = lines[j].pts;
    for (let a = 0; a + 1 < A.length; a++) for (let b = 0; b + 1 < B.length; b++) {
      const [a0, a1, b0, b1] = [A[a], A[a + 1], B[b], B[b + 1]];
      const dv = Math.abs(a0.x - b0.x), dh = Math.abs(a0.y - b0.y);
      const v = Math.abs(a0.x - a1.x) < 0.5 && Math.abs(b0.x - b1.x) < 0.5 && dv >= 0.5 && dv < 6;
      const h = Math.abs(a0.y - a1.y) < 0.5 && Math.abs(b0.y - b1.y) < 0.5 && dh >= 0.5 && dh < 6;
      if (!v && !h) continue;
      const p = v ? 'y' : 'x';
      const lo = Math.max(Math.min(a0[p], a1[p]), Math.min(b0[p], b1[p]));
      const hi = Math.min(Math.max(a0[p], a1[p]), Math.max(b0[p], b1[p]));
      if (hi - lo > 1) found.push(`${lines[i].id}#${a}${a === 0 || a + 2 === A.length ? 'e' : ''}/${lines[j].id}#${b}${b === 0 || b + 2 === B.length ? 'e' : ''}:${(v ? dv : dh).toFixed(1)}`);
    }
  }
  total += found.length;
  console.log(`${file.split('/').pop()}: ${found.length} ${found.join(' ')}`);
}
console.log('TOTAL', total);
