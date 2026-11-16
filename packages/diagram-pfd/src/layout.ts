import type { RenderContext } from '@mermaid-js/core';
import type { LayoutEdge, LayoutModel, LayoutNode } from '@mermaid-js/core/layout';
import { layoutLabel, Style, type FontKey, type MeasuredLabel } from '@mermaid-js/core/text';
import type { PfdModel } from './model.js';
import { SYMBOLS } from './symbols.js';

export const LABEL_GAP = 6;
export const ARROW = { length: 8, width: 7 };
const EDGE_PAD = 4;

export interface NodeLabels {
  tag: MeasuredLabel;
  name?: MeasuredLabel;
}

export interface EdgeLabel {
  box: MeasuredLabel;
  width: number;
  height: number;
}

export interface PfdLayout extends LayoutModel {
  labels: Map<string, NodeLabels>;
  edgeLabels: Map<string, EdgeLabel>;
  fontSize: number;
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

  const labels = new Map<string, NodeLabels>();
  const nodes: LayoutNode[] = model.equipment.map((eq) => {
    const sym = SYMBOLS[eq.type];
    const tag = measure(eq.id, font, Style.Bold);
    const name = eq.name ? measure(eq.name, small) : undefined;
    labels.set(eq.id, { tag, name });
    const textWidth = Math.max(tag.width, name?.width ?? 0);
    const textHeight = tag.height + (name?.height ?? 0);
    return {
      id: eq.id,
      width: Math.ceil(Math.max(sym.width, textWidth) + 8),
      // The symbol sits in the middle of the box so streams attach at its centre; the tag label
      // goes underneath, mirrored by the same space reserved above.
      height: Math.ceil(sym.height + 2 * (LABEL_GAP + textHeight)),
      shape: eq.type,
    };
  });

  const edgeLabels = new Map<string, EdgeLabel>();
  const edges: LayoutEdge[] = model.streams.map((s) => {
    const edge: LayoutEdge = { id: s.id, source: s.source, target: s.target, minLen: 1, endMarker: ARROW };
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
  return { ...laid, labels, edgeLabels, fontSize: size };
}
