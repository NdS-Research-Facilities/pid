import type { RenderContext } from '@mermaid-js/core';
import type { SvgWriter } from '@mermaid-js/core/svg';
import { pathBuilder, px, styleScope, styleText, themeStyleSheet, translate } from '@mermaid-js/core/svg';
import type { PathData } from '@mermaid-js/core/svg';
import type { Point } from '@mermaid-js/core/layout';
import { ARROW, LABEL_GAP, type PfdLayout } from './layout.js';
import type { PfdModel } from './model.js';
import { SYMBOLS } from './symbols.js';

/** Writes the whole `<svg>` document for a laid-out PFD. */
export function renderPfd(model: PfdModel, layout: PfdLayout, ctx: RenderContext, w: SvgWriter): void {
  const { theme, idPrefix } = ctx;
  const stroke = theme.color('lineColor');
  const border = theme.color('nodeBorder');
  const bg = theme.color('mainBkg');
  const text = theme.color('primaryTextColor');
  const labelBg = theme.color('edgeLabelBackground');

  const width = Math.max(1, Math.ceil(layout.width));
  const height = Math.max(1, Math.ceil(layout.height));
  const font = theme.font();
  const auto = theme.autoDeclarations();
  w.open('svg', {
    xmlns: 'http://www.w3.org/2000/svg',
    class: 'mermaid mermaid-pfd',
    viewBox: [0, 0, width, height],
    width: '100%',
    role: 'img',
    'aria-roledescription': 'pfd',
    'aria-labelledby': model.title ? `${idPrefix}-title` : undefined,
    'data-mermaid-version': ctx.version,
    'data-p': auto ? styleScope(idPrefix) : undefined,
    style: styleText({ 'max-width': px(width) }, theme.rootStyleText()),
    'font-family': font,
  });
  if (auto) w.styleSheet(themeStyleSheet(styleScope(idPrefix), auto.light, auto.dark));
  if (model.title) {
    w.open('title', { id: `${idPrefix}-title` });
    w.text(model.title);
    w.close();
  }

  // Streams first, so equipment sits on top of line ends.
  w.open('g', { class: 'streams' });
  for (const s of model.streams) {
    const edge = layout.edges.get(s.id);
    if (!edge || edge.points.length < 2) continue;
    const pts = edge.points;
    w.open('g', { class: 'stream', 'data-id': s.ast });
    w.leaf('path', {
      d: polyline(pts),
      fill: 'none',
      stroke,
      'stroke-width': 1.6,
    });
    w.leaf('path', { d: arrowHead(pts[pts.length - 2]!, pts[pts.length - 1]!), fill: stroke, stroke: 'none' });
    const lbl = layout.edgeLabels.get(s.id);
    if (lbl && edge.label) {
      w.leaf('rect', {
        class: 'stream-label',
        x: r(edge.label.x - lbl.width / 2),
        y: r(edge.label.y - lbl.height / 2),
        width: lbl.width,
        height: lbl.height,
        rx: 3,
        fill: labelBg,
        stroke: border,
        'stroke-width': 0.8,
      });
      w.label(lbl.box, edge.label.x, edge.label.y, { fill: text, 'font-size': layout.fontSize - 2 });
    }
    w.close();
  }
  w.close();

  w.open('g', { class: 'equipment' });
  for (const eq of model.equipment) {
    const node = layout.nodes.get(eq.id);
    if (!node) continue;
    const sym = SYMBOLS[eq.type];
    const top = node.y - sym.height / 2;
    w.open('g', { class: `equipment ${eq.type}`, 'data-id': eq.ast });
    w.open('g', { transform: translate(r(node.x - sym.width / 2), r(top)) });
    for (const part of sym.parts)
      w.leaf(part.tag, { ...part.attrs, ...(part.tag === 'path' ? { d: toPath(String(part.attrs.d)) } : {}), fill: part.fill ? bg : 'none', stroke: border, 'stroke-width': 1.4 });
    w.close();
    const labels = layout.labels.get(eq.id)!;
    let y = top + sym.height + LABEL_GAP;
    w.label(labels.tag, node.x, y + labels.tag.height / 2, { fill: text, 'font-size': layout.fontSize, 'font-weight': 'bold' });
    y += labels.tag.height;
    if (labels.name)
      w.label(labels.name, node.x, y + labels.name.height / 2, { fill: text, 'font-size': layout.fontSize - 2 });
    w.close();
  }
  w.close();
  w.close();
}

const r = (n: number) => Math.round(n * 100) / 100;

function polyline(pts: readonly Point[]): PathData {
  const b = pathBuilder();
  pts.forEach((p, i) => (i ? b.lineTo(r(p.x), r(p.y)) : b.moveTo(r(p.x), r(p.y))));
  return b.done();
}

/** Turns a symbol's absolute path string (M, L, H, V, A, Z only) into checked path data. */
export function toPath(d: string): PathData {
  const b = pathBuilder();
  const tokens = d.match(/[MLHVAZ]|-?\d*\.?\d+/g) ?? [];
  let i = 0;
  let x = 0;
  let y = 0;
  let cmd = '';
  const num = () => Number(tokens[i++]);
  while (i < tokens.length) {
    if (/[MLHVAZ]/.test(tokens[i]!)) cmd = tokens[i++]!;
    switch (cmd) {
      case 'M': x = num(); y = num(); b.moveTo(x, y); cmd = 'L'; break;
      case 'L': x = num(); y = num(); b.lineTo(x, y); break;
      case 'H': x = num(); b.lineTo(x, y); break;
      case 'V': y = num(); b.lineTo(x, y); break;
      case 'A': {
        const rx = num(), ry = num(), rot = num(), large = num() === 1, sweep = num() === 1;
        x = num(); y = num();
        b.arcTo(rx, ry, rot, large, sweep, x, y);
        break;
      }
      case 'Z': b.close(); break;
      default: throw new Error(`Unsupported path command in "${d}"`);
    }
  }
  return b.done();
}

function arrowHead(from: Point, to: Point): PathData {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const bx = to.x - ux * ARROW.length;
  const by = to.y - uy * ARROW.length;
  const hw = ARROW.width / 2;
  return pathBuilder().moveTo(r(to.x), r(to.y)).lineTo(r(bx - uy * hw), r(by + ux * hw)).lineTo(r(bx + uy * hw), r(by - ux * hw)).close().done();
}
