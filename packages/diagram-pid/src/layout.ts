import type { RenderContext } from '@mermaid-js/core';
import type { Dir, LayoutEdge, LayoutModel, LayoutNode, Side } from '@mermaid-js/core/layout';
import { layoutLabel, Style, type FontKey, type MeasuredLabel } from '@mermaid-js/core/text';
import type { Equipment, NozzleSide, PidModel, Port, Stream } from './model.js';
import { equipmentStateText, instrumentText } from './state.js';
import { coilShape, scaleOf, splitTag, symbolFor } from './symbols.js';

export const LABEL_GAP = 6;
export const ARROW = { length: 8, width: 7 };
const EDGE_PAD = 4;
/** Between a line number and the line (or the stream tag box) it labels. */
export const LINE_NUMBER_GAP = 3;
const BOX_PAD = 8;

export type LabelSide = 'below' | 'above' | 'left' | 'right';

export interface NodeLabels {
  /** Absent for instruments: their tag is inside the bubble. */
  tag?: MeasuredLabel;
  name?: MeasuredLabel;
  state?: MeasuredLabel;
  /** An instrument's measured value: shown first, larger than the name. */
  value?: MeasuredLabel;
  /** An instrument's function letters and loop number, inside the bubble. */
  bubble?: { letters: MeasuredLabel; loop: MeasuredLabel; size: number };
  /** The tag, value, name and state lines stacked. */
  width: number;
  height: number;
}

/** Where a node's symbol and labels go inside its layout box. */
export interface NodePlacement {
  labels: NodeLabels;
  side: LabelSide;
  /** The symbol's size as drawn, after `turn`. */
  width: number;
  height: number;
  /**
   * Valves follow the flow: a quarter turn clockwise top to bottom (A up, C left), anticlockwise
   * bottom to top (A down, C right). Right to left needs none: the symbols are mirror-symmetric.
   */
  turn: 0 | 90 | -90;
  /** The symbol's scale (`size`, or grown for coils); `width` and `height` include it. */
  scale: number;
  /**
   * A 3-way or relief valve flipped across the flow, so its branch (port C, the relief outlet)
   * faces the side its line goes to: up instead of down, right instead of left.
   */
  mirror?: boolean;
  /** Room beyond the symbol for nozzle stubs and descriptions, either side, across and down. */
  margin: { x: number; y: number };
  /** Nozzle descriptions, measured, by nozzle id. */
  nozzleLabels: Map<string, MeasuredLabel>;
  /** An image or icon drawn inside a larger outline, to carry its nozzles. */
  framed?: boolean;
}

/** Length of a nozzle's stub, and the least room per nozzle along a side. */
export const NOZZLE_STUB = 8;
export const NOZZLE_PITCH = 18;

export interface NozzlePoint {
  /** On the symbol's edge, where the stub starts. */
  edge: { x: number; y: number };
  /** The stub's outer end, where the line starts or ends. */
  outer: { x: number; y: number };
  side: NozzleSide;
}

/**
 * Where each nozzle of `eq` is: nozzles on one side spread evenly along it, in the order written
 * (top to bottom on the left and right, left to right on the top and bottom). On a round symbol
 * the stub starts on the circle.
 */
export function nozzlePoints(eq: Equipment, place: NodePlacement, node: { x: number; y: number }): Map<string, NozzlePoint> {
  const out = new Map<string, NozzlePoint>();
  const radius = place.framed ? undefined : symbolFor(eq).round;
  const round = radius === undefined ? undefined : radius * place.scale;
  for (const side of ['left', 'right', 'top', 'bottom'] as const) {
    const list = (eq.nozzles ?? []).filter((z) => z.side === side);
    const across = side === 'left' || side === 'right';
    const length = across ? place.height : place.width;
    const pitch = length / (list.length + 1);
    const sign = side === 'right' || side === 'bottom' ? 1 : -1;
    list.forEach((z, k) => {
      const offset = -length / 2 + pitch * (k + 1);
      const reach = (across ? place.width : place.height) / 2;
      const depth = round !== undefined && Math.abs(offset) < round ? Math.sqrt(round * round - offset * offset) : reach;
      const edge = across ? { x: node.x + sign * depth, y: node.y + offset } : { x: node.x + offset, y: node.y + sign * depth };
      const outer = across ? { x: node.x + sign * (reach + NOZZLE_STUB), y: edge.y } : { x: edge.x, y: node.y + sign * (reach + NOZZLE_STUB) };
      out.set(z.id, { edge, outer, side });
    });
  }
  return out;
}

export interface EdgeLabel {
  box: MeasuredLabel;
  width: number;
  height: number;
}

export interface PidLayout extends LayoutModel {
  placements: Map<string, NodePlacement>;
  edgeLabels: Map<string, EdgeLabel>;
  /** Line numbers (`pipe 1 2"-CW-101-A1`) by stream id. */
  lineNumbers: Map<string, MeasuredLabel>;
  /** Readings drawn inside vessels: per gradient stop (none for a colour stop), and the level. */
  fillMarks: Map<string, { stops: (MeasuredLabel | undefined)[]; level?: MeasuredLabel }>;
  /** The font size of those readings. */
  markSize: number;
  /** The wall each coil's nozzles are on, by `coilKey`. */
  coilSides: Map<string, 'left' | 'right'>;
  /** Coils (`TAG#index`) with both nozzles on one wall whose inlet is the lower one. */
  coilInletLow: Set<string>;
  fontSize: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** A font size that fits `letters` across an instrument bubble. */
const size0 = (letters: string) => (letters.length <= 3 ? 11 : letters.length === 4 ? 9 : 8);

const vertical = (d: Dir) => d === 'TB' || d === 'BT';

/** How far a tee may slide to line up with a neighbour's fixed connection point. */
const TEE_ALIGN = 24;
/** Equipment whose lines meet it on its centre line. */
const ON_CENTRE = new Set(['pump', 'compressor', 'exchanger', 'valve', 'valve3', 'instrument', 'inverter', 'breaker', 'meter', 'grid', 'consumer']);

/**
 * A tee has no body, so the layout puts it wherever suits it, often a few pixels off the fixed
 * point a straight line from it must reach (a valve port, a pump's centre line, a coil or named
 * nozzle). The line would then need a small step right at that point. Slides each such tee into
 * line, with the straight runs through it, when it is only slightly off.
 */
function alignTees(
  model: PidModel,
  laid: LayoutModel,
  placements: Map<string, NodePlacement>,
  byId: ReadonlyMap<string, Equipment>,
  coilSides: ReadonlyMap<string, 'left' | 'right'>,
  coilInletLow: ReadonlySet<string>,
): void {
  /** Where line `s` meets `eq` at that end, on the axis across the line's run, if that is fixed. */
  const fixedAt = (s: Stream, atSource: boolean, horizontal: boolean): number | undefined => {
    const id = atSource ? s.source : s.target;
    const eq = byId.get(id);
    const node = laid.nodes.get(id);
    const place = placements.get(id);
    if (!eq || !node || !place) return undefined;
    const pick = (p: { x: number; y: number }) => (horizontal ? p.y : p.x);
    const nozzle = atSource ? s.sourceNozzle : s.targetNozzle;
    if (nozzle) {
      const p = nozzlePoints(eq, place, node).get(nozzle);
      return p && pick(p.outer);
    }
    const coil = atSource ? s.sourceCoil : s.targetCoil;
    if (coil !== undefined && eq.coils?.[coil]) {
      const sideIn = coilSides.get(coilKey(id, coil, 'in')) ?? 'left';
      const sideOut = coilSides.get(coilKey(id, coil, 'out')) ?? sideIn;
      const shape = coilShape(eq.type, eq.coils[coil], sideIn, sideOut, coilInletLow.has(`${id}#${coil}`));
      if (!shape) return undefined;
      const local = atSource ? shape.outlet : shape.inlet;
      return pick({ x: node.x - place.width / 2 + local.x * place.scale, y: node.y - place.height / 2 + local.y * place.scale });
    }
    if ((atSource ? s.sourcePort : s.targetPort) === 'C') return undefined;
    return ON_CENTRE.has(eq.type) ? pick(node) : undefined;
  };
  for (const tee of model.equipment) {
    if (tee.type !== 'tee') continue;
    const node = laid.nodes.get(tee.id);
    if (!node) continue;
    let best: { horizontal: boolean; delta: number } | undefined;
    for (const s of model.streams) {
      const fromTee = s.source === tee.id;
      if (!fromTee && s.target !== tee.id) continue;
      const pts = laid.edges.get(s.id)?.points;
      if (!pts || pts.length < 2) continue;
      // Only a line that runs straight from the tee to the fixed point.
      const horizontal = pts.every((p) => Math.abs(p.y - pts[0]!.y) < 0.5);
      const straight = horizontal || pts.every((p) => Math.abs(p.x - pts[0]!.x) < 0.5);
      if (!straight) continue;
      const target = fixedAt(s, !fromTee, horizontal);
      if (target === undefined) continue;
      const delta = target - (horizontal ? node.y : node.x);
      if (Math.abs(delta) > 0.5 && Math.abs(delta) <= TEE_ALIGN && (!best || Math.abs(delta) < Math.abs(best.delta)))
        best = { horizontal, delta };
    }
    if (!best) continue;
    const { horizontal, delta } = best;
    const axis = horizontal ? 'y' : 'x';
    const old = node[axis];
    node[axis] = old + delta;
    // Move the tee's end of each of its lines, and the straight run from it on that axis.
    for (const s of model.streams) {
      if (s.source !== tee.id && s.target !== tee.id) continue;
      const pts = laid.edges.get(s.id)?.points;
      if (!pts?.length) continue;
      const order = s.source === tee.id ? pts : [...pts].reverse();
      for (const p of order) {
        if (Math.abs(p[axis] - old) >= 0.5) break;
        p[axis] = old + delta;
      }
    }
  }
}

/**
 * Labels go beside the symbol, never where streams come in: under it in a horizontal flow, to its
 * right in a vertical one.
 */
/** A valve with a branch outlet across the flow: 3-way valves' port C, a relief valve's outlet. */
export const hasBranch = (eq: Equipment) => eq.type === 'valve3' || (eq.type === 'valve' && eq.valveKind === 'relief');

const OPPOSITE: Record<Side, LabelSide> = { top: 'below', bottom: 'above', left: 'right', right: 'left' };

function labelSide(dir: Dir, eq: Equipment, mirror = false): LabelSide {
  // Labels go opposite a branch outlet, which takes the side they would otherwise use.
  if (hasBranch(eq)) return OPPOSITE[portSide(dir, 'C', mirror)];
  return vertical(dir) ? 'right' : 'below';
}

/** The side a control valve's actuator faces: up, or the way a vertical flow turns it. */
export function actuatorSide(dir: Dir): Side {
  return dir === 'TB' ? 'right' : dir === 'BT' ? 'left' : 'top';
}

const OPPOSITE_SIDE: Record<Side, Side> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };

/** A coil nozzle's key in `PidLayout.coilSides`. */
export const coilKey = (id: string, i: number, end: 'in' | 'out') => `${id}#${i}#${end}`;

/**
 * The sides a line must leave and enter by, where the symbol decides: a 3-way valve port, a
 * relief valve's outlet (the same side as port C), a control valve's actuator.
 */
export function endSides(
  dir: Dir,
  s: Stream,
  byId: ReadonlyMap<string, Equipment>,
  mirrored: ReadonlySet<string> = new Set(),
  coilSides: ReadonlyMap<string, 'left' | 'right'> = new Map(),
): { source?: Side; target?: Side } {
  const from = byId.get(s.source);
  const to = byId.get(s.target);
  // A nozzle decides its line's side.
  const nozzleSide = (id: string, n: string | undefined) => (n ? byId.get(id)?.nozzles?.find((z) => z.id === n)?.side : undefined);
  const srcNozzle = nozzleSide(s.source, s.sourceNozzle);
  const tgtNozzle = nozzleSide(s.target, s.targetNozzle);
  if (srcNozzle || tgtNozzle) {
    const rest = endSides(dir, { ...s, sourceNozzle: undefined, targetNozzle: undefined }, byId, mirrored, coilSides);
    return { source: srcNozzle ?? rest.source, target: tgtNozzle ?? rest.target };
  }
  const coil = (id: string, i: number | undefined, end: 'in' | 'out') =>
    i === undefined ? undefined : (coilSides.get(coilKey(id, i, end)) ?? byId.get(id)?.coils?.[i]?.side);
  // A line leaves a coil by its outlet and reaches it by its inlet.
  const sourceCoil = coil(s.source, s.sourceCoil, 'out');
  const targetCoil = coil(s.target, s.targetCoil, 'in');
  if (sourceCoil || targetCoil || s.sourceCoil !== undefined || s.targetCoil !== undefined) {
    const rest = endSides(dir, { ...s, sourceCoil: undefined, targetCoil: undefined }, byId, mirrored);
    return { source: s.sourceCoil !== undefined ? sourceCoil : rest.source, target: s.targetCoil !== undefined ? targetCoil : rest.target };
  }
  const source = s.sourcePort
    ? portSide(dir, s.sourcePort, mirrored.has(s.source))
    : from?.type === 'valve' && from.valveKind === 'relief'
      ? portSide(dir, 'C', mirrored.has(s.source))
      : undefined;
  const target =
    s.kind === 'signal' && to?.actuated
      ? to.type === 'valve3'
        ? OPPOSITE_SIDE[portSide(dir, 'C', mirrored.has(s.target))]
        : actuatorSide(dir)
      : s.targetPort
        ? portSide(dir, s.targetPort, mirrored.has(s.target))
        : undefined;
  return { source, target };
}

/**
 * The lines on a valve's branch (those at its port C, or all lines leaving a relief valve), with
 * whether the valve is the line's source.
 */
function branchLines(model: PidModel, eq: Equipment): { id: string; fromValve: boolean }[] {
  return model.streams.flatMap((s): { id: string; fromValve: boolean }[] => {
    if (s.source === eq.id && (s.sourcePort === 'C' || eq.type === 'valve')) return [{ id: s.id, fromValve: true }];
    if (s.target === eq.id && s.targetPort === 'C') return [{ id: s.id, fromValve: false }];
    return [];
  });
}

/** Lines end in an arrowhead unless they run into a tee, where the pipe just continues. */
export function drawsArrow(s: Stream, byId: ReadonlyMap<string, Equipment>): boolean {
  return s.arrow && byId.get(s.target)?.type !== 'tee';
}

/**
 * The box side each 3-way valve port faces: A upstream, B downstream, C across the flow, on the
 * side the symbol's turn puts it, or the other side when the valve is mirrored.
 */
export function portSide(dir: Dir, port: Port, mirror = false): Side {
  const sides: Record<Dir, Record<Port, Side>> = {
    LR: { A: 'left', B: 'right', C: 'bottom' },
    RL: { A: 'right', B: 'left', C: 'bottom' },
    TB: { A: 'top', B: 'bottom', C: 'left' },
    BT: { A: 'bottom', B: 'top', C: 'right' },
  };
  const side = sides[dir][port];
  if (!mirror || port !== 'C') return side;
  return ({ top: 'bottom', bottom: 'top', left: 'right', right: 'left' } as const)[side];
}

function fontSizeOf(ctx: RenderContext): number {
  try {
    const n = ctx.theme.number('fontSize');
    if (Number.isFinite(n) && n > 0) return Math.min(n, 13);
  } catch {
    /* theme without a numeric fontSize */
  }
  return 13;
}

/** Measures every label, then hands boxes and streams to the configured graph layout engine. */
export function layoutPid(model: PidModel, ctx: RenderContext): PidLayout {
  const size = fontSizeOf(ctx);
  const family = ctx.theme.value('fontFamily');
  const font: FontKey = { family, size, weight: 400 };
  const small: FontKey = { family, size: size - 2, weight: 400 };
  const measure = (text: string, f: FontKey, style = 0) =>
    layoutLabel(text, f, Infinity, ctx.measurer, { style, keepWords: true });

  const byId = new Map(model.equipment.map((e) => [e.id, e]));
  const placements = new Map<string, NodePlacement>();
  const nodes: LayoutNode[] = model.equipment.map((eq) => {
    const sym = symbolFor(eq);
    const instrument = eq.type === 'instrument';
    // An instrument drawn as its own image or icon has no bubble: its tag goes with the labels.
    const inBubble = instrument && !eq.image && !eq.icon;
    const tee = eq.type === 'tee';
    if (tee) {
      // A tee is a point on the pipe: no labels, and a box no larger than its dot.
      placements.set(eq.id, { labels: { width: 0, height: 0 }, side: 'below', width: sym.width, height: sym.height, turn: 0, scale: 1, margin: { x: 0, y: 0 }, nozzleLabels: new Map() });
      return { id: eq.id, width: sym.width, height: sym.height, shape: eq.type };
    }
    const tag = inBubble ? undefined : measure(eq.id, font, Style.Bold);
    const value = instrument && eq.state ? measure(instrumentText(eq.state), font, Style.Bold) : undefined;
    const name = eq.name ? measure(eq.name, small) : undefined;
    const state = !instrument && eq.state ? measure(equipmentStateText(eq), small, Style.Italic) : undefined;
    const lines = [tag, value, name, state].filter((l): l is MeasuredLabel => l !== undefined);
    let bubble: NodeLabels['bubble'];
    if (inBubble) {
      const [letters, loop] = splitTag(eq.id);
      // ISA-5.1 bubbles hold up to four letters; a smaller face keeps longer ones inside.
      const fs = Math.max(7, Math.min(size0(letters), size - 2));
      const f = { ...font, size: fs };
      bubble = { letters: measure(letters, f, Style.Bold), loop: measure(loop, f), size: fs };
    }
    const labels: NodeLabels = {
      tag,
      value,
      name,
      state,
      bubble,
      width: Math.max(0, ...lines.map((l) => l.width)),
      height: lines.reduce((h, l) => h + l.height, 0),
    };
    const turn = !sym.turns || !vertical(model.direction) ? 0 : model.direction === 'TB' ? 90 : -90;
    let f = scaleOf(eq);
    let w = (turn ? sym.height : sym.width) * f;
    let h = (turn ? sym.width : sym.height) * f;
    // Nozzles need room along their side: a symbol grows to give each its pitch; an image or icon
    // keeps its size and is drawn inside a larger outline instead.
    const nozzles = eq.nozzles ?? [];
    const count = (sides: string[]) => Math.max(0, ...sides.map((sd) => nozzles.filter((z) => z.side === sd).length));
    const needH = (count(['left', 'right']) + 1) * NOZZLE_PITCH;
    const needW = (count(['top', 'bottom']) + 1) * NOZZLE_PITCH;
    const framed = nozzles.length > 0 && !!(eq.image || eq.icon);
    if (nozzles.length && !framed) {
      const g = Math.max(1, nozzles.some((z) => z.side === 'left' || z.side === 'right') ? needH / h : 1, nozzles.some((z) => z.side === 'top' || z.side === 'bottom') ? needW / w : 1);
      [f, w, h] = [f * g, w * g, h * g];
    } else if (framed) {
      w = Math.max(w + 12, needW);
      h = Math.max(h + 12, needH);
    }
    // Room beyond the symbol for each nozzle's stub and its description, mirrored either side.
    const nozzleLabels = new Map<string, MeasuredLabel>();
    for (const z of nozzles) if (z.label) nozzleLabels.set(z.id, measure(z.label, { ...small, size: size - 3 }));
    const room = (sides: string[]) =>
      Math.max(0, ...nozzles.filter((z) => sides.includes(z.side)).map((z) => NOZZLE_STUB + (nozzleLabels.get(z.id)?.width ?? 0) + 4));
    const margin = { x: room(['left', 'right']), y: room(['top', 'bottom']) };
    const side = labelSide(model.direction, eq);
    placements.set(eq.id, { labels, side, width: w, height: h, turn, scale: f, margin, nozzleLabels, ...(framed ? { framed } : {}) });
    // The symbol sits in the middle of the box, so streams attach at its centre line; the space
    // the labels take on one side is mirrored on the other.
    const across = side === 'left' || side === 'right';
    const W = w + 2 * margin.x;
    const H = h + 2 * margin.y;
    return {
      id: eq.id,
      width: Math.ceil(across ? W + 2 * (LABEL_GAP + labels.width) : Math.max(W, labels.width) + BOX_PAD),
      height: Math.ceil(across ? Math.max(H, labels.height) + BOX_PAD : H + 2 * (LABEL_GAP + labels.height)),
      shape: eq.type,
    };
  });

  const edgeLabels = new Map<string, EdgeLabel>();
  const lineNumbers = new Map<string, MeasuredLabel>();
  const edges: LayoutEdge[] = model.streams.map((s) => {
    const edge: LayoutEdge = { id: s.id, source: s.source, target: s.target, minLen: 1 };
    if (drawsArrow(s, byId)) edge.endMarker = ARROW;
    const sides = endSides(model.direction, s, byId);
    if (sides.source || sides.target) edge.sides = sides;
    let tag: EdgeLabel | undefined;
    if (s.label !== undefined) {
      const props = model.properties.get(s.label) ?? [];
      const text = [s.label, ...props.map((p) => (p.key ? `${p.key}: ${p.value}` : p.value))].join('\n');
      const box = measure(text, small);
      tag = { box, width: Math.ceil(box.width + 2 * EDGE_PAD), height: Math.ceil(box.height + 2 * EDGE_PAD) };
      edgeLabels.set(s.id, tag);
    }
    const number = s.lineNumber ? measure(s.lineNumber, { ...small, size: size - 3 }) : undefined;
    if (number) lineNumbers.set(s.id, number);
    // The layout keeps the label area clear on the line: the stream tag box centred on it, and
    // the line number above it, mirrored below so the area stays centred on the line.
    if (tag || number) {
      const lift = number ? 2 * (number.height + LINE_NUMBER_GAP) : 0;
      edge.label = {
        width: Math.ceil(Math.max(tag?.width ?? 0, (number?.width ?? 0) + 4)),
        height: Math.ceil((tag?.height ?? 0) + lift),
      };
    }
    return edge;
  });

  const run = () =>
    ctx.layout({
      direction: model.direction,
      nodes,
      edges,
      groups: [],
      spacing: { node: 50, rank: 70, edge: 20 },
      routing: 'stepped',
      diagramPadding: 12,
    });
  let laid = run();

  // The layout orders nodes without regard to which side a branch must leave by, so a branch
  // line can have to cross the valve's other lines. Mirror each valve whose branch heads the
  // other way, and lay out again with the new sides. Boxes are symmetric: sizes do not change.
  const mirrored = new Set<string>();
  const across = (p: { x: number; y: number }) => (vertical(model.direction) ? p.x : p.y);
  for (const eq of model.equipment.filter(hasBranch)) {
    const node = laid.nodes.get(eq.id);
    // Where each branch line meets its other end: the side of the valve it has to get to.
    const ends = branchLines(model, eq).flatMap(({ id, fromValve }) => {
      const pts = laid.edges.get(id)?.points;
      return pts?.length ? [fromValve ? pts[pts.length - 1]! : pts[0]!] : [];
    });
    if (!node || !ends.length) continue;
    const pull = ends.reduce((sum, n) => sum + across(n) - across(node), 0) / ends.length;
    const side = portSide(model.direction, 'C');
    const sign = side === 'bottom' || side === 'right' ? 1 : -1;
    if (pull * sign < 0) mirrored.add(eq.id);
  }
  // Each coil nozzle goes on the wall facing the line it carries (inlet: the line coming in,
  // outlet: the line going out), unless the diagram names the walls. With both on one wall, the
  // inlet takes the upper or lower nozzle, whichever its line comes from, so the two don't cross.
  const coilSides = new Map<string, 'left' | 'right'>();
  const coilInletLow = new Set<string>();
  for (const eq of model.equipment) {
    const node = laid.nodes.get(eq.id);
    eq.coils?.forEach((coil, i) => {
      const otherY = (end: 'in' | 'out') => {
        const ys = model.streams.flatMap((s) => {
          if (end === 'out' && s.source === eq.id && s.sourceCoil === i) return [laid.nodes.get(s.target)?.y ?? NaN];
          if (end === 'in' && s.target === eq.id && s.targetCoil === i) return [laid.nodes.get(s.source)?.y ?? NaN];
          return [];
        }).filter((y) => !Number.isNaN(y));
        return ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : undefined;
      };
      const sideOf = (end: 'in' | 'out') => {
        const ends = model.streams.flatMap((s) => {
          const pts = laid.edges.get(s.id)?.points;
          if (!pts?.length) return [];
          if (end === 'out' && s.source === eq.id && s.sourceCoil === i) return [pts[pts.length - 1]!];
          if (end === 'in' && s.target === eq.id && s.targetCoil === i) return [pts[0]!];
          return [];
        });
        if (!node || !ends.length) return undefined;
        return ends.reduce((sum, p) => sum + p.x - node.x, 0) / ends.length > 0 ? ('right' as const) : ('left' as const);
      };
      // Named walls win; a nozzle without a line goes on the other one's wall.
      const autoIn = sideOf('in');
      const autoOut = sideOf('out');
      const inlet = coil.side ?? autoIn ?? autoOut ?? 'left';
      const outlet = coil.sideOut ?? coil.side ?? autoOut ?? inlet;
      coilSides.set(coilKey(eq.id, i, 'in'), inlet);
      coilSides.set(coilKey(eq.id, i, 'out'), outlet);
      if (inlet === outlet && node) {
        const yIn = otherY('in');
        const yOut = otherY('out');
        const low = yIn !== undefined && yOut !== undefined ? yIn > yOut : yIn !== undefined ? yIn > node.y : yOut !== undefined && yOut < node.y;
        if (low) coilInletLow.add(`${eq.id}#${i}`);
      }
    });
  }
  const coilLines = model.streams.some((s) => s.sourceCoil !== undefined || s.targetCoil !== undefined);
  if (mirrored.size || coilLines) {
    for (const id of mirrored) {
      const place = placements.get(id)!;
      place.mirror = true;
      place.side = labelSide(model.direction, byId.get(id)!, true);
    }
    model.streams.forEach((s, k) => {
      const sides = endSides(model.direction, s, byId, mirrored, coilSides);
      edges[k]!.sides = sides.source || sides.target ? sides : undefined;
    });
    laid = run();
  }
  alignTees(model, laid, placements, byId, coilSides, coilInletLow);
  const markSize = Math.max(8, size - 4);
  const markFont: FontKey = { family, size: markSize, weight: 400 };
  const fillMarks: PidLayout['fillMarks'] = new Map();
  if (model.gradientMarks)
    for (const eq of model.equipment) {
      if (!eq.gradient && !eq.level) continue;
      fillMarks.set(eq.id, {
        stops: (eq.gradient ?? []).map((st) => (st.color ? undefined : measure(st.value === undefined ? '?' : st.raw, markFont))),
        level: eq.level ? measure(eq.level.percent === undefined ? '?' : `${round1(eq.level.percent)} %`, markFont) : undefined,
      });
    }
  return { ...laid, placements, edgeLabels, lineNumbers, fillMarks, markSize, coilSides, coilInletLow, fontSize: size };
}
