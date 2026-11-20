// Hops (arcs where one line crosses another), per file and in total: node hops.mjs out/*.svg
import { readFileSync } from 'node:fs';
let total = 0;
for (const file of process.argv.slice(2)) {
  const svg = readFileSync(file, 'utf8');
  let n = 0;
  for (const m of svg.matchAll(/<g class="stream [^"]*" data-id="edge-s\d+"[^>]*>\s*<path d="([^"]+)"/g)) n += (m[1].match(/A/g) ?? []).length;
  total += n;
  console.log(`${file.split('/').pop()}: ${n}`);
}
console.log('TOTAL', total);
