import type { RenderContext } from '@mermaid-js/core';
import type { Point } from '@mermaid-js/core/layout';
import type { PathData, SafeValue, SvgWriter } from '@mermaid-js/core/svg';
import { pathBuilder, px, rotate, styleScope, styleText, themeStyleSheet, transforms, translate } from '@mermaid-js/core/svg';
import type { MeasuredLabel } from '@mermaid-js/core/text';
import type { LayoutModelNode, Side } from '@mermaid-js/core/layout';
import { hopPaths } from '@mermaid-js/core/layout/hops';
import { ARROW, drawsArrow, endSides, LABEL_GAP, type NodePlacement, type PidLayout } from './layout.js';
import { PORTS, type Equipment, type EquipmentType, type PidModel, type Port, type Stream } from './model.js';
import { boreProblem, connectedPorts, portOpen } from './state.js';
import { symbolFor, type SymbolPart } from './symbols.js';

const DASH = '4 3' as SafeValue;
const SIGNAL_DASH = '7 3' as SafeValue;

/** Line weights: process piping heavy, instrument connections and signals light. */
const WEIGHT = { process: 1.6, connection: 1, signal: 1 } as const;

/** Writes the whole `<svg>` document for a laid-out P&ID. */
export function renderPid(model: PidModel, layout: PidLayout, ctx: RenderContext, w: SvgWriter): void {
  const { theme, idPrefix } = ctx;
  const paint = {
    line: theme.color('lineColor'),
    border: theme.color('nodeBorder'),
    bg: theme.color('mainBkg'),
    text: theme.color('primaryTextColor'),
    labelBg: theme.color('edgeLabelBackground'),
  };

  const width = Math.max(1, Math.ceil(layout.width));
  const height = Math.max(1, Math.ceil(layout.height));
  const auto = theme.autoDeclarations();
  w.open('svg', {
    xmlns: 'http://www.w3.org/2000/svg',
    class: 'mermaid mermaid-pid',
    viewBox: [0, 0, width, height],
    width: '100%',
    role: 'img',
    'aria-roledescription': 'pid',
    'aria-labelledby': model.title ? `${idPrefix}-title` : undefined,
    'data-mermaid-version': ctx.version,
    'data-p': auto ? styleScope(idPrefix) : undefined,
    style: styleText({ 'max-width': px(width) }, theme.rootStyleText()),
    'font-family': theme.font(),
  });
  if (auto) w.styleSheet(themeStyleSheet(styleScope(idPrefix), auto.light, auto.dark));
  if (model.title) {
    w.open('title', { id: `${idPrefix}-title` });
    w.text(model.title);
    w.close();
  }

  const byId = new Map(model.equipment.map((e) => [e.id, e]));

  // Streams first, so equipment sits on top of line ends. Their routes are settled before any is
  // drawn, so lines that cross without joining can hop over each other.
  const routes = model.streams.flatMap((s) => {
    const edge = layout.edges.get(s.id);
    if (!edge || edge.points.length < 2) return [];
    const pts = edge.points.map((p) => ({ x: p.x, y: p.y }));
    const sides = endSides(model.direction, s, byId);
    attach(pts, false, layout, byId.get(s.source), sides.source);
    attach(pts, true, layout, byId.get(s.target), sides.target);
    if (byId.get(s.source)?.type === 'tee') bendAtTee(pts, false);
    if (byId.get(s.target)?.type === 'tee') bendAtTee(pts, true);
    return [{ s, edge, pts, d: polyline(dedupe(pts)) }];
  });
  const hopped = hopPaths(
    routes.map((r) => r.d),
    'arc',
  );

  w.open('g', { class: 'streams' });
  routes.forEach(({ s, edge, pts, d }, i) => {
    const blocked = s.kind === 'process' && isBlocked(s, byId);
    w.open('g', { class: `stream ${s.kind}${blocked ? ' stream-blocked' : ''}`, 'data-id': s.ast });
    w.leaf('path', {
      d: hopped[i] ?? d,
      fill: 'none',
      stroke: paint.line,
      'stroke-width': WEIGHT[s.kind],
      'stroke-dasharray': s.kind === 'signal' ? SIGNAL_DASH : blocked ? DASH : undefined,
      'stroke-opacity': blocked ? 0.55 : undefined,
    });
    if (drawsArrow(s, byId))
      w.leaf('path', { d: arrowHead(pts[pts.length - 2]!, pts[pts.length - 1]!), fill: paint.line, stroke: 'none' });
    const lbl = layout.edgeLabels.get(s.id);
    if (lbl && edge.label) {
      w.leaf('rect', {
        class: 'stream-label',
        x: r(edge.label.x - lbl.width / 2),
        y: r(edge.label.y - lbl.height / 2),
        width: lbl.width,
        height: lbl.height,
        rx: 3,
        fill: paint.labelBg,
        stroke: paint.border,
        'stroke-width': 0.8,
      });
      w.label(lbl.box, edge.label.x, edge.label.y, { fill: paint.text, 'font-size': layout.fontSize - 2 });
    }
    w.close();
  });
  w.close();

  w.open('g', { class: 'equipment' });
  for (const eq of model.equipment) {
    const node = layout.nodes.get(eq.id);
    const place = layout.placements.get(eq.id);
    if (!node || !place) continue;
    const sym = symbolFor(eq);
    const left = node.x - place.width / 2;
    const top = node.y - place.height / 2;
    const look = stateLook(eq);
    w.open('g', { class: ['equipment', eq.type, ...look.classes].join(' '), 'data-id': eq.ast });
    w.open('g', {
      transform:
        place.turn === 90
          ? transforms(translate(r(left + place.width), r(top)), rotate(90))
          : place.turn === -90
            ? transforms(translate(r(left), r(top + place.height)), rotate(-90))
            : translate(r(left), r(top)),
    });
    for (const part of sym.parts) drawPart(w, part, eq, look, paint);
    if (eq.type === 'valve3') drawBore(w, eq, paint);
    w.close();
    if (place.labels.bubble) drawBubble(w, place.labels.bubble, node, paint.text);
    drawLabels(w, layout, node, place, paint.text);
    w.close();
  }
  w.close();
  w.close();
}

type Paint = Record<'line' | 'border' | 'bg' | 'text' | 'labelBg', ReturnType<RenderContext['theme']['color']>>;

function drawPart(w: SvgWriter, part: SymbolPart, eq: Equipment, look: StateLook, paint: Paint): void {
  const d = part.tag === 'path' ? { d: toPath(String(part.attrs.d)) } : {};
  if (part.ink) {
    w.leaf(part.tag, { ...part.attrs, ...d, fill: paint.border, stroke: 'none' });
    return;
  }
  // A 3-way valve port is solid when shut; otherwise the whole symbol follows the state look.
  const shut = part.port !== undefined && portOpen(eq, part.port) === false;
  const opacity = !part.fill ? 0 : part.port !== undefined ? (shut ? 1 : 0) : look.fillOpacity;
  if (opacity > 0 && opacity < 1) w.leaf(part.tag, { ...part.attrs, ...d, fill: paint.bg, stroke: 'none' });
  w.leaf(part.tag, {
    ...part.attrs,
    ...d,
    class: part.port ? `port port-${part.port}${shut ? ' port-shut' : ''}` : undefined,
    fill: !part.fill ? 'none' : opacity > 0 ? paint.border : paint.bg,
    'fill-opacity': opacity > 0 && opacity < 1 ? r(opacity) : undefined,
    stroke: paint.border,
    'stroke-width': 1.4,
    'stroke-dasharray': look.dashed ? DASH : undefined,
  });
}

/** The 3-way valve body's centre and where each port's bore line ends, in symbol coordinates. */
const BORE_CENTRE: Point = { x: 27, y: 33 };
const BORE_ENDS: Record<Port, Point> = { A: { x: 6, y: 33 }, B: { x: 48, y: 33 }, C: { x: 27, y: 58 } };
const BALL_RADIUS = 9;
const BORE_WIDTH = 4;

/**
 * An L- or T-port 3-way valve's ball, with its bore as a heavy line from the centre to each port
 * the state connects, so the bore's shape shows which way the ball is turned. The bore is left
 * out when the state is unknown or impossible for the bore.
 */
function drawBore(w: SvgWriter, eq: Equipment, paint: Paint): void {
  if (!eq.bore) return;
  w.leaf('circle', {
    class: 'ball',
    cx: BORE_CENTRE.x,
    cy: BORE_CENTRE.y,
    r: BALL_RADIUS,
    fill: paint.bg,
    stroke: paint.border,
    'stroke-width': 1.4,
  });
  const ports = connectedPorts(eq.state);
  if (!ports || ports.size < 2 || boreProblem(eq)) return;
  const b = pathBuilder();
  for (const port of PORTS) if (ports.has(port)) b.moveTo(BORE_CENTRE.x, BORE_CENTRE.y).lineTo(BORE_ENDS[port].x, BORE_ENDS[port].y);
  w.leaf('path', { class: `bore bore-${eq.bore}`, d: b.done(), fill: 'none', stroke: paint.line, 'stroke-width': BORE_WIDTH });
}

/** ISA-5.1: function letters in the bubble's upper half, the loop number in the lower half. */
function drawBubble(w: SvgWriter, b: NonNullable<NodePlacement['labels']['bubble']>, node: Point, text: Paint['text']): void {
  const shift = b.size * 0.6;
  w.label(b.letters, node.x, node.y - shift, { class: 'instrument-letters', fill: text, 'font-size': b.size, 'font-weight': 'bold' });
  if (b.loop.width > 0) w.label(b.loop, node.x, node.y + shift, { class: 'instrument-loop', fill: text, 'font-size': b.size });
}

/** Tag (bold), name and state (italic), centred in a column on the placement's label side. */
function drawLabels(w: SvgWriter, layout: PidLayout, node: Point, place: NodePlacement, text: Paint['text']): void {
  const { labels, side } = place;
  const fs = layout.fontSize;
  let cx = node.x;
  let y = node.y - labels.height / 2;
  if (side === 'below') y = node.y + place.height / 2 + LABEL_GAP;
  else if (side === 'above') y = node.y - place.height / 2 - LABEL_GAP - labels.height;
  else cx = node.x + (side === 'right' ? 1 : -1) * (place.width / 2 + LABEL_GAP + labels.width / 2);
  const line = (l: MeasuredLabel | undefined, attrs: Parameters<SvgWriter['label']>[3]) => {
    if (!l) return;
    w.label(l, cx, y + l.height / 2, { fill: text, ...attrs });
    y += l.height;
  };
  line(labels.tag, { 'font-size': fs, 'font-weight': 'bold' });
  line(labels.value, { class: 'instrument-value', 'font-size': fs, 'font-weight': 'bold' });
  line(labels.name, { 'font-size': fs - 2 });
  line(labels.state, { class: 'equipment-state', 'font-size': fs - 2, 'font-style': 'italic' });
}

/** Compact symbols are met on their centre line; tall or wide ones anywhere near it. */
const CENTRED: ReadonlySet<EquipmentType> = new Set(['pump', 'compressor', 'exchanger', 'valve', 'valve3', 'feed', 'product', 'instrument', 'tee']);
/** Keep stream ends this far from a symbol's corners. */
const CORNER = 20;
/** How far outside the box a stream turns to line up with the symbol. */
const STUB = 10;

/**
 * The layout ends a stream anywhere on the node's box, which is larger than the symbol so it can
 * hold the labels. Moves the end (`atEnd`) or the start of `pts` onto the symbol: straight on
 * when it already lines up, else with a jog just outside the box. A port end meets its port.
 */
function attach(pts: Point[], atEnd: boolean, layout: PidLayout, eq: Equipment | undefined, side: Side | undefined): void {
  const node = eq && layout.nodes.get(eq.id);
  const place = eq && layout.placements.get(eq.id);
  if (!eq || !node || !place || pts.length < 2) return;
  const i = atEnd ? pts.length - 1 : 0;
  const E = pts[i]!;
  const P = pts[atEnd ? i - 1 : 1]!;
  const across = side ? side === 'left' || side === 'right' : Math.abs(E.y - P.y) < 0.5;
  // u runs along the stream's way in, v across it.
  const U = (p: Point) => (across ? p.x : p.y);
  const V = (p: Point) => (across ? p.y : p.x);
  const at = (u: number, v: number): Point => (across ? { x: u, y: v } : { x: v, y: u });
  const sign = side ? (side === 'right' || side === 'bottom' ? 1 : -1) : Math.sign(U(P) - U(node)) || 1;
  const symU = (across ? place.width : place.height) / 2;
  const symV = (across ? place.height : place.width) / 2;
  const boxU = (across ? (node as LayoutModelNode).width : (node as LayoutModelNode).height) / 2;
  const round = side ? undefined : symbolFor(eq).round;
  const squareInstrument = eq.type === 'instrument' && !round;
  const reach = round ? round * 0.6 : side ? 0 : squareInstrument ? symV / 2 : CENTRED.has(eq.type) ? 0 : Math.max(0, symV - CORNER);
  const v = Math.min(V(node) + reach, Math.max(V(node) - reach, V(E)));
  // A round symbol is met on its circle; anything else on its bounding box.
  // Lines run into a tee's centre; a round symbol is met on its circle; anything else on its box.
  const depth = eq.type === 'tee' ? 0 : round ? Math.sqrt(round * round - (v - V(node)) ** 2) : symU;
  const end = at(U(node) + sign * depth, v);
  let tail: Point[];
  if (Math.abs(V(E) - v) < 0.5 && Math.abs(V(P) - v) < 0.5) tail = [end];
  else {
    const stub = at(U(node) + sign * (boxU + STUB), v);
    tail = [at(U(stub), V(P)), stub, end];
  }
  pts.splice(i, 1, ...(atEnd ? tail : tail.reverse()));
}

/**
 * The layout leaves a node straight before it turns, which puts a branch's fork somewhere along
 * the pipe rather than at its tee. Moves the first turn after the tee (or the last before it,
 * `atEnd`) back to the tee, so lines split and join at the dot. Only an orthogonal run of at
 * least four points is moved, keeping every segment straight.
 */
function bendAtTee(pts: Point[], atEnd: boolean): void {
  if (pts.length < 4) return;
  const at = (k: number) => pts[atEnd ? pts.length - 1 - k : k]!;
  const [tee, b, c, d] = [at(0), at(1), at(2), at(3)];
  const near = (p: number, q: number) => Math.abs(p - q) < 0.5;
  if (near(tee.y, b.y) && near(b.x, c.x) && near(c.y, d.y)) {
    b.x = tee.x;
    c.x = tee.x;
  } else if (near(tee.x, b.x) && near(b.y, c.y) && near(c.x, d.x)) {
    b.y = tee.y;
    c.y = tee.y;
  }
}

/** Drops points that repeat the one before them. */
function dedupe(pts: readonly Point[]): Point[] {
  return pts.filter((p, i) => i === 0 || Math.abs(p.x - pts[i - 1]!.x) > 0.01 || Math.abs(p.y - pts[i - 1]!.y) > 0.01);
}

/** A stream is blocked when either end is a valve port that is shut. */
function isBlocked(s: Stream, byId: Map<string, Equipment>): boolean {
  const at = (id: string, port: Stream['sourcePort']) => {
    const eq = byId.get(id);
    return !!eq && portOpen(eq, port) === false;
  };
  return at(s.source, s.sourcePort) || at(s.target, s.targetPort);
}

interface StateLook {
  classes: string[];
  /** 0 = drawn hollow, 1 = filled solid, between = shaded. */
  fillOpacity: number;
  dashed: boolean;
}

/**
 * How a state is drawn, after high-performance HMI practice (ISA-101): a closed valve is solid,
 * an open one hollow, a partly open one shaded by how far it is closed. Travelling and unknown
 * states are dashed; `on` shades pumps and compressors. Classes allow restyling via theme CSS.
 */
export function stateLook(eq: Equipment): StateLook {
  const s = eq.state;
  const valve = eq.type === 'valve';
  if (!s) return { classes: [], fillOpacity: 0, dashed: false };
  // An instrument shows a reading, not a position: only a missing reading changes the drawing.
  if (eq.type === 'instrument')
    return s.kind === 'unknown'
      ? { classes: ['state-unknown'], fillOpacity: 0, dashed: true }
      : { classes: ['state-value'], fillOpacity: 0, dashed: false };
  switch (s.kind) {
    case 'position': {
      const pos = s.position!;
      const cls = pos === 0 ? 'state-closed' : pos === 100 ? 'state-open' : 'state-partial';
      return { classes: [cls], fillOpacity: valve ? 1 - pos / 100 : 0, dashed: false };
    }
    case 'ports':
      if (boreProblem(eq)) return { classes: ['state-invalid'], fillOpacity: 0, dashed: true };
      return { classes: [`state-${[...s.open!].sort().join('').toLowerCase() || 'closed'}`], fillOpacity: 0, dashed: false };
    case 'opening':
    case 'closing':
      return { classes: [`state-${s.kind}`], fillOpacity: 0, dashed: true };
    case 'on':
      return { classes: ['state-on'], fillOpacity: eq.type === 'pump' || eq.type === 'compressor' ? 0.35 : 0, dashed: false };
    case 'off':
      return { classes: ['state-off'], fillOpacity: valve ? 1 : 0, dashed: false };
    case 'unknown':
      return { classes: ['state-unknown'], fillOpacity: 0, dashed: true };
    default:
      return { classes: ['state-text'], fillOpacity: 0, dashed: false };
  }
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
