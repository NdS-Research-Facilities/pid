import type { RenderContext } from '@mermaid-js/core';
import type { Dir, LayoutEdge, LayoutModel, LayoutNode, Side } from '@mermaid-js/core/layout';
import { layoutLabel, Style, type FontKey, type MeasuredLabel } from '@mermaid-js/core/text';
import type { Equipment, PfdModel, Port } from './model.js';
import { stateText } from './state.js';
import { SYMBOLS } from './symbols.js';

export const LABEL_GAP = 6;
export const ARROW = { length: 8, width: 7 };
const EDGE_PAD = 4;
const BOX_PAD = 8;

export type LabelSide = 'below' | 'above' | 'left' | 'right';

export interface NodeLabels {
  tag: MeasuredLabel;
  name?: MeasuredLabel;
  state?: MeasuredLabel;
  /** The tag, name and state lines stacked. */
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

export interface PfdLayout extends LayoutModel {
  placements: Map<string, NodePlacement>;
  edgeLabels: Map<string, EdgeLabel>;
  fontSize: number;
}

const vertical = (d: Dir) => d === 'TB' || d === 'BT';

/**
 * Labels go beside the symbol, never where streams come in: under it in a horizontal flow, to its
 * right in a vertical one. A 3-way valve's branch port takes that side, so its labels go opposite.
 */
function labelSide(dir: Dir, eq: Equipment): LabelSide {
  if (dir === 'BT' && eq.type === 'valve3') return 'left';
  if (vertical(dir)) return 'right';
  return eq.type === 'valve3' ? 'above' : 'below';
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
export function layoutPfd(model: PfdModel, ctx: RenderContext): PfdLayout {
  const size = fontSizeOf(ctx);
  const family = ctx.theme.value('fontFamily');
  const font: FontKey = { family, size, weight: 400 };
  const small: FontKey = { family, size: size - 2, weight: 400 };
  const measure = (text: string, f: FontKey, style = 0) =>
    layoutLabel(text, f, Infinity, ctx.measurer, { style, keepWords: true });

  const placements = new Map<string, NodePlacement>();
  const nodes: LayoutNode[] = model.equipment.map((eq) => {
    const sym = SYMBOLS[eq.type];
    const tag = measure(eq.id, font, Style.Bold);
    const name = eq.name ? measure(eq.name, small) : undefined;
    const state = eq.state ? measure(stateText(eq.state), small, Style.Italic) : undefined;
    const lines = [tag, name, state].filter((l): l is MeasuredLabel => l !== undefined);
    const labels: NodeLabels = {
      tag,
      name,
      state,
      width: Math.max(...lines.map((l) => l.width)),
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
    const edge: LayoutEdge = { id: s.id, source: s.source, target: s.target, minLen: 1, endMarker: ARROW };
    if (s.sourcePort || s.targetPort)
      edge.sides = {
        source: s.sourcePort && portSide(model.direction, s.sourcePort),
        target: s.targetPort && portSide(model.direction, s.targetPort),
      };
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
