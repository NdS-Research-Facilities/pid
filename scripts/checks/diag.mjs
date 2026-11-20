// Lines with a slanted segment (every run should be horizontal or vertical): node diag.mjs out/*.svg
import { readFileSync } from 'node:fs';
for (const file of process.argv.slice(2)) {
  const svg = readFileSync(file, 'utf8');
  const bad = [];
  for (const m of svg.matchAll(/<g class="stream [^"]*" data-id="edge-(s\d+)"[^>]*>\s*<path d="([^"]+)"/g)) {
    const segs = [...m[2].matchAll(/([MLA])([^MLA]+)/g)];
    let prev;
    for (const s of segs) {
      const nums = s[2].trim().split(/[ ,]+/).map(Number);
      const p = { x: nums[nums.length - 2], y: nums[nums.length - 1] };
      if (prev && s[1] === 'L' && Math.abs(p.x - prev.x) > 0.5 && Math.abs(p.y - prev.y) > 0.5) bad.push(`${m[1]} (${prev.x},${prev.y})->(${p.x},${p.y})`);
      prev = p;
    }
  }
  console.log(`${file.split('/').pop()}: ${bad.length} ${bad.join(' ')}`);
}
