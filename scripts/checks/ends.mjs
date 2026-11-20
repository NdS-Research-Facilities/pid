// Lines that still end at a tee's layout position while its dot is elsewhere.
import { readFileSync } from 'node:fs';
for (const file of process.argv.slice(2)) {
  const svg = readFileSync(file, 'utf8');
  const tees = [...svg.matchAll(/class="equipment tee[^"]*" data-id="node-([^"]+)"[^>]*>\s*<g transform="translate\(([\d.]+),([\d.]+)\)"/g)].map((m) => ({ id: m[1], x: +m[2] + 4, y: +m[3] + 4 }));
  const dots = [...svg.matchAll(/class="tee-dot" cx="([\d.]+)" cy="([\d.]+)"/g)].map((m) => ({ x: +m[1], y: +m[2] }));
  const ends = [...svg.matchAll(/<g class="stream [^"]*" data-id="edge-(s\d+)"[^>]*>\s*<path d="([^"]+)"/g)].flatMap((m) => {
    const p = [...m[2].matchAll(/[ML]\s*(-?[\d.]+)[ ,](-?[\d.]+)/g)].map((q) => ({ x: +q[1], y: +q[2] }));
    return [{ id: m[1], ...p[0] }, { id: m[1], ...p[p.length - 1] }];
  });
  const near = (a, b) => Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1;
  const stale = tees.filter((t) => !dots.some((d) => near(d, t))).flatMap((t) => ends.filter((e) => near(e, t)).map((e) => `${e.id}@${t.id}`));
  console.log(`${file.split('/').pop()}: ${tees.length} tees, ${stale.length} line ends at a stale tee position ${stale.join(' ')}`);
}
