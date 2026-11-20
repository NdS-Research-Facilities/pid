/**
 * Clutter score of a rendered P&ID SVG. It reads the SVG the renderer produced, so it measures
 * what the user sees. Lower is better; `overlaps`, `near`, `bumps` and `slanted` must be 0.
 */
import { junctions } from './render.js';

type Point2 = { x: number; y: number };

export interface Clutter {
  /** Arcs where one line hops over another. */
  hops: number;
  /** Turns, summed over all lines. */
  bends: number;
  /** Total line length in px. */
  length: number;
  /** viewBox width × height. */
  area: number;
  /** Different lines on one track: must be 0. */
  overlaps: number;
  /** Different lines closer than 6 px side by side (inner runs): must be 0. */
  near: number;
  /** Small steps in a line: must be 0. */
  bumps: number;
  /** Line segments neither horizontal nor vertical: must be 0. */
  slanted: number;
  /** Text boxes overlapping a line or another text box. */
  labelHits: number;
  /** Weighted sum of the above; lower is better. */
  total: number;
}

export const WEIGHTS = { hops: 10, bends: 1, length: 0.01, labelHits: 5, area: 0 } as const;

const STREAM = /<g class="stream [^"]*" data-id="edge-(s\d+)"[^>]*>\s*<path d="([^"]+)"/g;
const POINTS = /[ML]\s*(-?[\d.]+)[ ,](-?[\d.]+)/g;

/** The first path of every stream (the line itself, not its arrowhead). */
function streams(svg: string): { id: string; d: string; pts: Point2[] }[] {
  return [...svg.matchAll(STREAM)].map((m) => ({
    id: m[1]!,
    d: m[2]!,
    pts: [...m[2]!.matchAll(POINTS)].map((p) => ({ x: +p[1]!, y: +p[2]! })),
  }));
}

/** Pairs of different lines in `svg` running along the same column or row (a tee's trunk excepted). */
export function overlappingLines(svg: string): string[] {
  const lines = streams(svg);
  const dots = [...svg.matchAll(/class="tee-dot" cx="([\d.]+)" cy="([\d.]+)"/g)].map((m) => ({ x: +m[1]!, y: +m[2]! }));
  const found: string[] = [];
  for (let i = 0; i < lines.length; i++)
    for (let j = i + 1; j < lines.length; j++)
      for (let a = 0; a + 1 < lines[i]!.pts.length; a++)
        for (let b = 0; b + 1 < lines[j]!.pts.length; b++) {
          const [a0, a1, b0, b1] = [lines[i]!.pts[a]!, lines[i]!.pts[a + 1]!, lines[j]!.pts[b]!, lines[j]!.pts[b + 1]!];
          const v = Math.abs(a0.x - a1.x) < 0.5 && Math.abs(b0.x - b1.x) < 0.5 && Math.abs(a0.x - b0.x) < 0.5;
          const h = Math.abs(a0.y - a1.y) < 0.5 && Math.abs(b0.y - b1.y) < 0.5 && Math.abs(a0.y - b0.y) < 0.5;
          if (!v && !h) continue;
          const p = v ? 'y' : 'x';
          const lo = Math.max(Math.min(a0[p], a1[p]), Math.min(b0[p], b1[p]));
          const hi = Math.min(Math.max(a0[p], a1[p]), Math.max(b0[p], b1[p]));
          if (hi - lo <= 1) continue;
          const trunk = dots.some((d) => (v ? Math.abs(d.x - a0.x) < 1 && d.y >= lo - 1 && d.y <= hi + 1 : Math.abs(d.y - a0.y) < 1 && d.x >= lo - 1 && d.x <= hi + 1));
          if (!trunk) found.push(`${lines[i]!.id}/${lines[j]!.id}`);
        }
  return found;
}

/**
 * Pairs of different lines running side by side closer than 6 px (not on one track) over a
 * stretch, where at least one of the two runs is an inner one (the renderer can move those; the
 * first and last runs end on a symbol). Hops split a run; collinear pieces count as one run.
 */
export function nearLines(svg: string): string[] {
  const runs = streams(svg).map(({ id, pts }) => {
    const out: { a: Point2; b: Point2; v: boolean }[] = [];
    for (let k = 0; k + 1 < pts.length; k++) {
      const [a, b] = [pts[k]!, pts[k + 1]!];
      const v = Math.abs(a.x - b.x) < 0.5;
      const last = out[out.length - 1];
      if (last && last.v === v && (v ? Math.abs(last.a.x - a.x) < 0.5 : Math.abs(last.a.y - a.y) < 0.5)) last.b = b;
      else out.push({ a, b, v });
    }
    return { id, runs: out };
  });
  const found: string[] = [];
  for (let i = 0; i < runs.length; i++)
    for (let j = i + 1; j < runs.length; j++)
      runs[i]!.runs.forEach((r, a) =>
        runs[j]!.runs.forEach((q, b) => {
          const inner = (a > 0 && a < runs[i]!.runs.length - 1) || (b > 0 && b < runs[j]!.runs.length - 1);
          if (!inner || r.v !== q.v) return;
          const d = r.v ? Math.abs(r.a.x - q.a.x) : Math.abs(r.a.y - q.a.y);
          if (d < 0.5 || d >= 6) return;
          const p = r.v ? 'y' : 'x';
          const lo = Math.max(Math.min(r.a[p], r.b[p]), Math.min(q.a[p], q.b[p]));
          const hi = Math.min(Math.max(r.a[p], r.b[p]), Math.max(q.a[p], q.b[p]));
          if (hi - lo > 1) found.push(`${runs[i]!.id}/${runs[j]!.id}: ${d.toFixed(1)} px`);
        }),
      );
  return found;
}

/** Small steps in lines: a short (< 15 px) turn between two parallel runs. There should be none. */
export function bumps(svg: string): string[] {
  const found: string[] = [];
  for (const { id, pts: p } of streams(svg)) {
    for (let k = 1; k + 2 < p.length; k++) {
      const [a, b, c, d] = [p[k - 1]!, p[k]!, p[k + 1]!, p[k + 2]!];
      const len = Math.hypot(c.x - b.x, c.y - b.y);
      const flat = (u: Point2, w: Point2) => Math.abs(u.y - w.y) < 0.5;
      const upright = (u: Point2, w: Point2) => Math.abs(u.x - w.x) < 0.5;
      const bump =
        (flat(a, b) && flat(c, d) && upright(b, c) && Math.abs(a.y - d.y) > 0.5) ||
        (upright(a, b) && upright(c, d) && flat(b, c) && Math.abs(a.x - d.x) > 0.5);
      if (len > 0.5 && len < 15 && bump) found.push(`${id}:${Math.round(len)}px`);
    }
  }
  return found;
}

/** Line ends at a tee's layout position where that tee's dot is elsewhere: there should be none. */
export function staleTeeEnds(svg: string): string[] {
  const tees = [...svg.matchAll(/class="equipment tee[^"]*" data-id="node-([^"]+)"[^>]*>\s*<g transform="translate\(([\d.]+),([\d.]+)\)"/g)].map(
    (m) => ({ id: m[1]!, x: +m[2]! + 4, y: +m[3]! + 4 }),
  );
  const dots = [...svg.matchAll(/class="tee-dot" cx="([\d.]+)" cy="([\d.]+)"/g)].map((m) => ({ x: +m[1]!, y: +m[2]! }));
  const ends = streams(svg).flatMap(({ id, pts }) => [{ id, ...pts[0]! }, { id, ...pts[pts.length - 1]! }]);
  const near = (a: Point2, b: Point2) => Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1;
  return tees.filter((t) => !dots.some((d) => near(d, t))).flatMap((t) => ends.filter((e) => near(e, t)).map((e) => `${e.id}@${t.id}`));
}

/** Every tee dot in `svg` sits where three or more line arms meet. */
export function dotsOnJunctions(svg: string): { dots: number; off: string[] } {
  const dots = [...svg.matchAll(/class="tee-dot" cx="([\d.]+)" cy="([\d.]+)"/g)].map((m) => ({ x: +m[1]!, y: +m[2]! }));
  const paths = [...svg.matchAll(/<g class="stream [^"]*"[^>]*>\s*<path d="([^"]+)"/g)].map((m) =>
    [...m[1]!.matchAll(POINTS)].map((p) => ({ x: +p[1]!, y: +p[2]! })),
  );
  const found = junctions(paths);
  const off = dots.filter((d) => !found.some((j) => Math.abs(j.x - d.x) < 1 && Math.abs(j.y - d.y) < 1)).map((d) => `${d.x},${d.y}`);
  return { dots: dots.length, off };
}

/** Line segments that are neither horizontal nor vertical. */
export function slantedLines(svg: string): string[] {
  const found: string[] = [];
  for (const { id, pts } of streams(svg))
    for (let k = 0; k + 1 < pts.length; k++)
      if (Math.abs(pts[k]!.x - pts[k + 1]!.x) >= 0.5 && Math.abs(pts[k]!.y - pts[k + 1]!.y) >= 0.5) found.push(`${id}#${k}`);
  return found;
}

/** Number of arcs in stream paths. */
export function hopCount(svg: string): number {
  return streams(svg).reduce((n, s) => n + (s.d.match(/A/g) ?? []).length, 0);
}

/** Turns summed over all lines, and total length. Collinear pieces (split by a hop) count as one. */
export function bendsAndLength(svg: string): { bends: number; length: number } {
  let bends = 0;
  let length = 0;
  for (const { pts } of streams(svg)) {
    let last: boolean | undefined;
    for (let k = 0; k + 1 < pts.length; k++) {
      const [a, b] = [pts[k]!, pts[k + 1]!];
      length += Math.hypot(b.x - a.x, b.y - a.y);
      if (Math.hypot(b.x - a.x, b.y - a.y) < 0.5) continue;
      const v = Math.abs(a.x - b.x) < 0.5;
      if (last !== undefined && last !== v) bends++;
      last = v;
    }
  }
  return { bends, length };
}

interface TextBox {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Approximate boxes of the texts in `svg`, from position, font size and length. A line's own
 * number sitting on its label chip is left out: it is meant to be on the line.
 */
export function textBoxes(svg: string): TextBox[] {
  const boxes: TextBox[] = [];
  const add = (text: string, x: number, y: number, size: number, bold: boolean) => {
    const w = text.length * size * (bold ? 0.62 : 0.55);
    // Shrink a little: boxes only count when they clearly overlap.
    boxes.push({ text, x0: x - w / 2 + 1, x1: x + w / 2 - 1, y0: y - size * 0.7, y1: y + size * 0.15 });
  };
  const decode = (s: string) => s.replace(/&quot;|&amp;|&lt;|&gt;|&#\d+;/g, '_');
  for (const m of svg.matchAll(/(<rect class="stream-label"[^>]*\/>)?<text([^>]*?)(\/>|>(.*?)<\/text>)/gs)) {
    if (m[1] || m[3] === undefined || m[4] === undefined) continue; // on a label chip, or empty
    const attrs = m[2]!;
    const size = +(/font-size="([\d.]+)"/.exec(attrs)?.[1] ?? 11);
    const bold = /font-weight="bold"/.test(attrs);
    const own = /\bx="(-?[\d.]+)" y="(-?[\d.]+)"/.exec(attrs);
    if (own) {
      const t = decode(m[4]!.replace(/<[^>]*>/g, ''));
      if (t.trim()) add(t, +own[1]!, +own[2]!, size, bold);
      continue;
    }
    for (const t of m[4]!.matchAll(/<tspan([^>]*)>([^<]*)<\/tspan>/g)) {
      const pos = /\bx="(-?[\d.]+)" y="(-?[\d.]+)"/.exec(t[1]!);
      const text = decode(t[2]!);
      if (pos && text.trim()) add(text, +pos[1]!, +pos[2]!, size, bold || /font-weight="bold"/.test(t[1]!));
    }
  }
  return boxes;
}

/** What the overlapping text boxes touch, for reports: `"text"/"text"` or `"text"/edge`. */
export function labelHits(svg: string): string[] {
  return labelHitList(svg).map((h) => h.what);
}

/** The clutter of one rendered SVG. */
export function clutter(svg: string): Clutter {
  const view = /viewBox="[-\d.]+ [-\d.]+ ([\d.]+) ([\d.]+)"/.exec(svg);
  const area = view ? +view[1]! * +view[2]! : 0;
  const { bends, length } = bendsAndLength(svg);
  const hits = labelHitCount(svg);
  const c = {
    hops: hopCount(svg),
    bends,
    length: Math.round(length),
    area: Math.round(area),
    overlaps: overlappingLines(svg).length,
    near: nearLines(svg).length,
    bumps: bumps(svg).length,
    slanted: slantedLines(svg).length,
    labelHits: hits,
  };
  const total = c.hops * WEIGHTS.hops + c.bends * WEIGHTS.bends + c.length * WEIGHTS.length + c.labelHits * WEIGHTS.labelHits + c.area * WEIGHTS.area;
  return { ...c, total: Math.round(total * 100) / 100 };
}

/** Number of text boxes (not pairs) that overlap a line or another text box. */
export function labelHitCount(svg: string): number {
  return new Set(labelHitList(svg).flatMap((h) => h.boxes)).size;
}

function labelHitList(svg: string): { what: string; boxes: number[] }[] {
  const boxes = textBoxes(svg);
  const lines = streams(svg);
  const out: { what: string; boxes: number[] }[] = [];
  boxes.forEach((b, i) => {
    for (let j = i + 1; j < boxes.length; j++) {
      const o = boxes[j]!;
      if (b.x0 < o.x1 && o.x0 < b.x1 && b.y0 < o.y1 && o.y0 < b.y1) out.push({ what: `"${b.text}"/"${o.text}"`, boxes: [i, j] });
    }
    for (const { id, pts } of lines)
      for (let k = 0; k + 1 < pts.length; k++) {
        const [p, q] = [pts[k]!, pts[k + 1]!];
        if (Math.max(p.x, q.x) > b.x0 && Math.min(p.x, q.x) < b.x1 && Math.min(p.y, q.y) < b.y1 && Math.max(p.y, q.y) > b.y0) {
          out.push({ what: `"${b.text}"/${id}`, boxes: [i] });
          break;
        }
      }
  });
  return out;
}
