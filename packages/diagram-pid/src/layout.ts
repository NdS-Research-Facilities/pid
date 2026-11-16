import type { RenderContext } from '@mermaid-js/core';
import type { Dir, LayoutEdge, LayoutModel, LayoutNode, Side } from '@mermaid-js/core/layout';
import { layoutLabel, Style, type FontKey, type MeasuredLabel } from '@mermaid-js/core/text';
import type { Equipment, PidModel, Port, Stream } from './model.js';
import { instrumentText, stateText } from './state.js';
import { splitTag, symbolFor } from './symbols.js';

export const LABEL_GAP = 6;
export const ARROW = { length: 8, width: 7 };
const EDGE_PAD = 4;
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
}

export interface EdgeLabel {
  box: MeasuredLabel;
  width: number;
  height: number;
}

export interface PidLayout extends LayoutModel {
  placements: Map<string, NodePlacement>;
  edgeLabels: Map<string, EdgeLabel>;
  fontSize: number;
}

/** A font size that fits `letters` across an instrument bubble. */
const size0 = (letters: string) => (letters.length <= 3 ? 11 : letters.length === 4 ? 9 : 8);

const vertical = (d: Dir) => d === 'TB' || d === 'BT';

/**
 * Labels go beside the symbol, never where streams come in: under it in a horizontal flow, to its
 * right in a vertical one.
 */
function labelSide(dir: Dir, eq: Equipment): LabelSide {
  // 3-way and relief valves have a branch outlet on the side the labels would otherwise take.
  const branch = eq.type === 'valve3' || (eq.type === 'valve' && eq.valveKind === 'relief');
  if (dir === 'BT' && branch) return 'left';
  if (vertical(dir)) return 'right';
  return branch ? 'above' : 'below';
}

/** The side a control valve's actuator faces: up, or the way a vertical flow turns it. */
export function actuatorSide(dir: Dir): Side {
  return dir === 'TB' ? 'right' : dir === 'BT' ? 'left' : 'top';
}

/**
 * The sides a line must leave and enter by, where the symbol decides: a 3-way valve port, a
 * relief valve's outlet (the same side as port C), a control valve's actuator.
 */
export function endSides(dir: Dir, s: Stream, byId: ReadonlyMap<string, Equipment>): { source?: Side; target?: Side } {
  const from = byId.get(s.source);
  const to = byId.get(s.target);
  const source = s.sourcePort
    ? portSide(dir, s.sourcePort)
    : from?.type === 'valve' && from.valveKind === 'relief'
      ? portSide(dir, 'C')
      : undefined;
  const target = s.kind === 'signal' && to?.actuated ? actuatorSide(dir) : s.targetPort ? portSide(dir, s.targetPort) : undefined;
  return { source, target };
}

/** The box side each 3-way valve port faces: A upstream, B downstream, C across the flow. */
export function portSide(dir: Dir, port: Port): Side {
  const sides: Record<Dir, Record<Port, Side>> = {
    LR: { A: 'left', B: 'right', C: 'bottom' },
    RL: { A: 'right', B: 'left', C: 'bottom' },
    TB: { A: 'top', B: 'bottom', C: 'left' },
    BT: { A: 'bottom', B: 'top', C: 'right' },
  };
  return sides[dir][port];
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
    const tag = instrument ? undefined : measure(eq.id, font, Style.Bold);
    const value = instrument && eq.state ? measure(instrumentText(eq.state), font, Style.Bold) : undefined;
    const name = eq.name ? measure(eq.name, small) : undefined;
    const state = !instrument && eq.state ? measure(stateText(eq.state), small, Style.Italic) : undefined;
    const lines = [tag, value, name, state].filter((l): l is MeasuredLabel => l !== undefined);
    let bubble: NodeLabels['bubble'];
    if (instrument) {
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
  const edges: LayoutEdge[] = model.streams.map((s) => {
    const edge: LayoutEdge = { id: s.id, source: s.source, target: s.target, minLen: 1 };
    if (s.arrow) edge.endMarker = ARROW;
    const sides = endSides(model.direction, s, byId);
    if (sides.source || sides.target) edge.sides = sides;
    if (s.label !== undefined) {
      const props = model.properties.get(s.label) ?? [];
      const text = [s.label, ...props.map((p) => (p.key ? `${p.key}: ${p.value}` : p.value))].join('\n');
      const box = measure(text, small);
      const width = Math.ceil(box.width + 2 * EDGE_PAD);
      const height = Math.ceil(box.height + 2 * EDGE_PAD);
      edgeLabels.set(s.id, { box, width, height });
      edge.label = { width, height };
    }
    return edge;
  });

  const laid = ctx.layout({
    direction: model.direction,
    nodes,
    edges,
    groups: [],
    spacing: { node: 50, rank: 70, edge: 20 },
    routing: 'stepped',
    diagramPadding: 12,
  });
  return { ...laid, placements, edgeLabels, fontSize: size };
}
