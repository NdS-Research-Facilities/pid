/**
 * Layout search: the choices the layout makes one at a time (which valves to mirror, the wall of
 * each coil nozzle, which coil nozzle is the inlet) are tried another way, one at a time, on the
 * real render, as is turning a line of a loop round for the layout (so another line of the loop
 * is the one going back), and a change is kept when the drawing's clutter score improves (hill climbing).
 * The order of tries is fixed, so the same text always gives the same drawing.
 */
import type { RenderContext } from '@mermaid-js/core';
import { streamWriter } from '@mermaid-js/core/svg';
import { planLayout, type Choice, type LayoutChoices, type LayoutPlan, type PidLayout } from './layout.js';
import type { PidModel } from './model.js';
import { renderPid, sharedSides } from './render.js';
import { clutter, streams } from './score.js';

/** Layout + render runs per diagram, today's choices included: keeps a large diagram fast. */
export const MAX_RUNS = 40;

/** Added per must-be-0 count (overlaps, near lines, bumps, slanted segments): never worth one. */
const BROKEN = 1000;


/**
 * The score a search minimises: the clutter total, and far more for anything that must be 0:
 * with the layout that was drawn, that includes lines through symbols. No example has one today.
 */
export function cost(svg: string, model?: PidModel, layout?: PidLayout): number {
  const c = clutter(svg);
  const through = model && layout ? symbolHits(svg, model, layout).length : 0;
  return c.total + BROKEN * (c.overlaps + c.near + c.bumps + c.slanted) + BROKEN * through;
}

/** How close a line may run past a symbol that is not one of its ends. */
const CLEAR = 3;

/**
 * Lines drawn through, or right along, a symbol: `stream/TAG` once per pair. A line's own first
 * run at its source and last run at its target are where it meets the symbol, and are left out.
 * The clutter score reads only the SVG, which does not say where symbols are: this reads the layout.
 */
export function symbolHits(svg: string, model: PidModel, layout: PidLayout): string[] {
  const byStream = new Map(model.streams.map((s) => [s.id, s]));
  const boxes = model.equipment.flatMap((eq) => {
    const node = layout.nodes.get(eq.id);
    const place = layout.placements.get(eq.id);
    if (eq.type === 'tee' || !node || !place) return [];
    const [w, h] = [place.width / 2 + CLEAR, place.height / 2 + CLEAR];
    return [{ id: eq.id, x0: node.x - w, x1: node.x + w, y0: node.y - h, y1: node.y + h }];
  });
  const found: string[] = [];
  for (const { id, pts } of streams(svg)) {
    const s = byStream.get(id);
    for (const b of boxes) {
      const hit = pts.slice(1).some((p, k) => {
        const q = pts[k]!;
        if (s?.source === b.id && k === 0) return false;
        if (s?.target === b.id && k === pts.length - 2) return false;
        const [xa, xb] = [Math.min(p.x, q.x), Math.max(p.x, q.x)];
        const [ya, yb] = [Math.min(p.y, q.y), Math.max(p.y, q.y)];
        return Math.min(xb, b.x1) - Math.max(xa, b.x0) > 0.5 - (xb - xa < 0.5 ? 1 : 0) && Math.min(yb, b.y1) - Math.max(ya, b.y0) > 0.5 - (yb - ya < 0.5 ? 1 : 0);
      });
      if (hit) found.push(`${id}/${b.id}`);
    }
  }
  return found;
}

/** The diagram's layout with the choices that score best within `MAX_RUNS` runs. */
export function searchLayout(model: PidModel, ctx: RenderContext, maxRuns = MAX_RUNS): PidLayout {
  const plan = planLayout(model, ctx);
  let best = plan.guess;
  let bestLayout = plan.layout(best);
  /** Swaps of neighbouring lines on the sides they share in a drawing. */
  const swaps = (layout: PidLayout): Choice[] =>
    sharedSides(model, layout).flatMap(({ id, size }) => Array.from({ length: size - 1 }, (_, n) => ({ kind: 'swap' as const, key: `${id}#${n}` })));
  if ((!plan.free.length && !swaps(bestLayout).length) || maxRuns < 2) return bestLayout;
  // Candidates are drawn without warnings: the final render gives them once.
  const quiet = new Proxy(ctx, {
    get(target, key) {
      if (key === 'warn') return () => {};
      const v = Reflect.get(target, key) as unknown;
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  });
  const score = (layout: PidLayout) => {
    const w = streamWriter({ gradient: ctx.theme.gradient(), idPrefix: () => ctx.idPrefix });
    renderPid(model, layout, quiet, w);
    return cost(w.finish(), model, layout);
  };
  let bestCost = score(bestLayout);
  let runs = 1;
  const seen = new Set([keyOf(best)]);
  const freeEnds = new Set(plan.free.flatMap((c) => (c.kind === 'coilSide' ? [c.key] : [])));
  // Pass over every choice until a whole pass keeps nothing, or the runs are used up. Swaps come
  // first: they only redraw, and the sides they swap on are those of the drawing so far.
  for (let improved = true; improved && runs < maxRuns; ) {
    improved = false;
    for (const choice of [...swaps(bestLayout), ...plan.free]) {
      for (const next of variants(best, choice, plan, freeEnds)) {
        if (runs >= maxRuns) break;
        const key = keyOf(next);
        if (seen.has(key)) continue;
        seen.add(key);
        // A swap needs no new layout.
        const layout = choice.kind === 'swap' ? { ...bestLayout, slotSwaps: next.slotSwaps } : plan.layout(next);
        const c = score(layout);
        runs++;
        if (c < bestCost - 1e-6) {
          [best, bestLayout, bestCost, improved] = [next, layout, c, true];
          break;
        }
      }
    }
  }
  return bestLayout;
}

/**
 * The choices with `choice` made the other way; a coil nozzle also with its coil's other end moved
 * along, when the diagram does not pin that one.
 */
function variants(from: LayoutChoices, choice: Choice, plan: LayoutPlan, freeEnds: ReadonlySet<string>): LayoutChoices[] {
  const coilOf = plan.coilOf;
  if (choice.kind === 'swap') {
    const slotSwaps = new Set(from.slotSwaps);
    if (!slotSwaps.delete(choice.key)) slotSwaps.add(choice.key);
    return [{ ...from, slotSwaps }];
  }
  if (choice.kind === 'reverse') {
    // The valves and coils guessed again for the new layout, as they were for the first.
    const reversed = new Set(from.reversed);
    if (!reversed.delete(choice.id)) reversed.add(choice.id);
    return [{ ...from, reversed }, plan.guessWith(reversed)];
  }
  if (choice.kind === 'mirror') {
    const mirrored = new Set(from.mirrored);
    if (!mirrored.delete(choice.id)) mirrored.add(choice.id);
    return [{ ...from, mirrored }];
  }
  if (choice.kind === 'inletLow') {
    // Only with both nozzles on one wall does it change anything.
    const [, id, i] = /^(.*)#(\d+)$/.exec(choice.key)!;
    const sideIn = from.coilSides.get(`${id}#${i}#in`);
    if (sideIn === undefined || sideIn !== from.coilSides.get(`${id}#${i}#out`)) return [];
    const coilInletLow = new Set(from.coilInletLow);
    if (!coilInletLow.delete(choice.key)) coilInletLow.add(choice.key);
    return [{ ...from, coilInletLow }];
  }
  const flip = (s: 'left' | 'right' | undefined) => (s === 'left' ? 'right' : 'left');
  const one = new Map(from.coilSides);
  one.set(choice.key, flip(from.coilSides.get(choice.key)));
  const out: LayoutChoices[] = [{ ...from, coilSides: one }];
  // The whole coil to the other wall, its inlet keeping the nozzle it has.
  const coil = coilOf.get(choice.key);
  const other = [...coilOf].find(([k, c]) => c === coil && k !== choice.key)?.[0];
  if (other !== undefined && freeEnds.has(other) && from.coilSides.get(other) === from.coilSides.get(choice.key)) {
    const both = new Map(one);
    both.set(other, flip(from.coilSides.get(other)));
    out.push({ ...from, coilSides: both });
  }
  return out;
}

const keyOf = (c: LayoutChoices) =>
  [[...c.mirrored].sort().join(','), [...c.coilSides].map(([k, v]) => `${k}=${v}`).sort().join(','), [...c.coilInletLow].sort().join(','), [...c.reversed].sort().join(','), [...c.slotSwaps].sort().join(',')].join('|');
