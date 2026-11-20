// For each rendered example: tee dots vs. points where 3+ line arms meet.
import { readFileSync } from 'node:fs';
for (const file of process.argv.slice(2)) {
  const svg = readFileSync(file, 'utf8');
  const dots = [...svg.matchAll(/class="tee-dot" cx="([\d.]+)" cy="([\d.]+)"/g)].map((m) => ({ x: +m[1], y: +m[2] }));
  const segs = [];
  for (const m of svg.matchAll(/<g class="stream [^"]*"[^>]*>\s*<path d="([^"]+)"/g)) {
    const pts = [...m[1].matchAll(/([ML])\s*(-?[\d.]+)[ ,](-?[\d.]+)/g)].map((p) => ({ x: +p[2], y: +p[3] }));
    for (let i = 0; i + 1 < pts.length; i++) segs.push([pts[i], pts[i + 1]]);
  }
  const near = (a, b) => Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1;
  const arms = (p) => {
    const d = new Set();
    for (const [a, b] of segs) {
      const dir = (u, v) => (Math.abs(u.x - v.x) > Math.abs(u.y - v.y) ? (v.x > u.x ? 'E' : 'W') : v.y > u.y ? 'S' : 'N');
      if (near(p, a)) d.add(dir(a, b));
      else if (near(p, b)) d.add(dir(b, a));
      else {
        const onX = Math.abs(a.y - b.y) < 0.5 && Math.abs(p.y - a.y) < 1 && p.x > Math.min(a.x, b.x) && p.x < Math.max(a.x, b.x);
        const onY = Math.abs(a.x - b.x) < 0.5 && Math.abs(p.x - a.x) < 1 && p.y > Math.min(a.y, b.y) && p.y < Math.max(a.y, b.y);
        if (onX) { d.add('E'); d.add('W'); }
        if (onY) { d.add('N'); d.add('S'); }
      }
    }
    return d.size;
  };
  const badDots = dots.filter((p) => arms(p) < 3);
  const cands = segs.flat().filter((p) => arms(p) >= 3 && !dots.some((d) => near(d, p)));
  const missing = cands.filter((p, i) => cands.findIndex((q) => near(p, q)) === i);
  console.log(`${file.split('/').pop()}: ${dots.length} dots, ${badDots.length} not at a junction ${JSON.stringify(badDots.map((p) => [Math.round(p.x), Math.round(p.y)]))}, ${missing.length} junctions without a dot ${JSON.stringify(missing.map((p) => [Math.round(p.x), Math.round(p.y)]))}`);
}
