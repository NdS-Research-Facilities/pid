import type { RenderContext } from '@mermaid-js/core';
import type { Dir, LayoutEdge, LayoutModel, LayoutNode, Side } from '@mermaid-js/core/layout';
import { layoutLabel, Style, type FontKey, type MeasuredLabel } from '@mermaid-js/core/text';
import type { Equipment, PidModel, Port, Stream } from './model.js';
import { equipmentStateText, instrumentText } from './state.js';
import { splitTag, symbolFor } from './symbols.js';

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
  /**
   * A 3-way or relief valve flipped across the flow, so its branch (port C, the relief outlet)
   * faces the side its line goes to: up instead of down, right instead of left.
   */
  mirror?: boolean;
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
  fontSize: number;
}

/** A font size that fits `letters` across an instrument bubble. */
const size0 = (letters: string) => (letters.length <= 3 ? 11 : letters.length === 4 ? 9 : 8);

const vertical = (d: Dir) => d === 'TB' || d === 'BT';

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

/**
 * The sides a line must leave and enter by, where the symbol decides: a 3-way valve port, a
 * relief valve's outlet (the same side as port C), a control valve's actuator.
 */
export function endSides(
  dir: Dir,
  s: Stream,
  byId: ReadonlyMap<string, Equipment>,
  mirrored: ReadonlySet<string> = new Set(),
): { source?: Side; target?: Side } {
  const from = byId.get(s.source);
  const to = byId.get(s.target);
  const source = s.sourcePort
    ? portSide(dir, s.sourcePort, mirrored.has(s.source))
    : from?.type === 'valve' && from.valveKind === 'relief'
      ? portSide(dir, 'C', mirrored.has(s.source))
      : undefined;
  const target =
    s.kind === 'signal' && to?.actuated
      ? actuatorSide(dir)
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
      placements.set(eq.id, { labels: { width: 0, height: 0 }, side: 'below', width: sym.width, height: sym.height, turn: 0 });
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
    const w = turn ? sym.height : sym.width;
    const h = turn ? sym.width : sym.height;
    const side = labelSide(model.direction, eq);
    placements.set(eq.id, { labels, side, width: w, height: h, turn });
    // The symbol sits in the middle of the box, so streams attach at its centre line; the space
    // the labels take on one side is mirrored on the other.
    const across = side === 'left' || side === 'right';
    return {
      id: eq.id,
      width: Math.ceil(across ? w + 2 * (LABEL_GAP + labels.width) : Math.max(w, labels.width) + BOX_PAD),
      height: Math.ceil(across ? Math.max(h, labels.height) + BOX_PAD : h + 2 * (LABEL_GAP + labels.height)),
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
  if (mirrored.size) {
    for (const id of mirrored) {
      const place = placements.get(id)!;
      place.mirror = true;
      place.side = labelSide(model.direction, byId.get(id)!, true);
    }
    model.streams.forEach((s, k) => {
      const sides = endSides(model.direction, s, byId, mirrored);
      edges[k]!.sides = sides.source || sides.target ? sides : undefined;
    });
    laid = run();
  }
  return { ...laid, placements, edgeLabels, lineNumbers, fontSize: size };
}
