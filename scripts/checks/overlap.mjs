// Pairs of different lines running along the same column/row over a stretch (> 1 px).
import { readFileSync } from 'node:fs';
for (const file of process.argv.slice(2)) {
  const svg = readFileSync(file, 'utf8');
  const lines = [...svg.matchAll(/<g class="stream [^"]*" data-id="edge-(s\d+)"[^>]*>\s*<path d="([^"]+)"/g)].map((m) => ({ id: m[1], pts: [...m[2].matchAll(/[ML]\s*(-?[\d.]+)[ ,](-?[\d.]+)/g)].map((p) => ({ x: +p[1], y: +p[2] })) }));
  // Tee dots: a shared run touching a tee dot is that tee's trunk, not an overlap.
  const dots = [...svg.matchAll(/class="tee-dot" cx="([\d.]+)" cy="([\d.]+)"/g)].map((m) => ({ x: +m[1], y: +m[2] }));
  const found = [];
  for (let i = 0; i < lines.length; i++) for (let j = i + 1; j < lines.length; j++)
    for (let a = 0; a + 1 < lines[i].pts.length; a++) for (let b = 0; b + 1 < lines[j].pts.length; b++) {
      const [a0, a1, b0, b1] = [lines[i].pts[a], lines[i].pts[a + 1], lines[j].pts[b], lines[j].pts[b + 1]];
      const v = Math.abs(a0.x - a1.x) < .5 && Math.abs(b0.x - b1.x) < .5 && Math.abs(a0.x - b0.x) < .5;
      const h = Math.abs(a0.y - a1.y) < .5 && Math.abs(b0.y - b1.y) < .5 && Math.abs(a0.y - b0.y) < .5;
      if (!v && !h) continue;
      const p = v ? 'y' : 'x';
      const lo = Math.max(Math.min(a0[p], a1[p]), Math.min(b0[p], b1[p])), hi = Math.min(Math.max(a0[p], a1[p]), Math.max(b0[p], b1[p]));
      if (hi - lo <= 1) continue;
      const onTee = dots.some((d) => (v ? Math.abs(d.x - a0.x) < 1 && d.y >= lo - 1 && d.y <= hi + 1 : Math.abs(d.y - a0.y) < 1 && d.x >= lo - 1 && d.x <= hi + 1));
      if (!onTee) found.push(`${lines[i].id}/${lines[j].id}@${v ? 'x' : 'y'}=${Math.round(v ? a0.x : a0.y)}`);
    }
  console.log(`${file.split('/').pop()}: ${found.length} overlaps ${found.join(' ')}`);
}
