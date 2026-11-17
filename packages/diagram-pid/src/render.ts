import type { RenderContext } from '@mermaid-js/core';
import type { Point } from '@mermaid-js/core/layout';
import type { PathData, SafeValue, SvgWriter } from '@mermaid-js/core/svg';
import {
  checkColor,
  checkImageUrl,
  checkStyle,
  pathBuilder,
  px,
  rotate,
  scale,
  styleScope,
  styleText,
  themeStyleSheet,
  transforms,
  translate,
  writeFragment,
  type Attrs,
} from '@mermaid-js/core/svg';
import type { MeasuredLabel } from '@mermaid-js/core/text';
import type { LayoutModelNode, Side } from '@mermaid-js/core/layout';
import { hopPaths } from '@mermaid-js/core/layout/hops';
import { ARROW, coilKey, drawsArrow, endSides, LABEL_GAP, LINE_NUMBER_GAP, type NodePlacement, type PidLayout } from './layout.js';
import { PORTS, type Equipment, type EquipmentType, type PidModel, type Port, type Stream } from './model.js';
import { boreProblem, breakerClosed, connectedPorts, portOpen } from './state.js';
import { coilShape, interiorOf, symbolFor, VALVE3_ACTUATOR_DROP, type Interior, type SymbolDef, type SymbolPart } from './symbols.js';

const DASH = '4 3' as SafeValue;
const SIGNAL_DASH = '7 3' as SafeValue;

/** Line weights: process piping heavy, instrument connections and signals light. */
const WEIGHT = { process: 1.6, connection: 1, signal: 1, electric: 1.8 } as const;
/** Power wiring's own colour, so cables stand apart from pipes and signals; `linkStyle` overrides. */
const CABLE = '#ef6c00';

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

  const mirrored = new Set([...layout.placements].flatMap(([id, p]) => (p.mirror ? [id] : [])));
  // Streams first, so equipment sits on top of line ends. Their routes are settled before any is
  // drawn, so lines that cross without joining can hop over each other.
  const slots = planSlots(model, layout, byId, mirrored);
  const routes = model.streams.flatMap((s) => {
    const edge = layout.edges.get(s.id);
    if (!edge || edge.points.length < 2) return [];
    const pts = edge.points.map((p) => ({ x: p.x, y: p.y }));
    const sides = endSides(model.direction, s, byId, mirrored, layout.coilSides);
    attach(pts, false, layout, byId.get(s.source), sides.source, coilNozzle(layout, byId.get(s.source), s.sourceCoil, 'outlet'), portDepth(layout, s.source, s.sourcePort), slots.get(`${s.id}:source`));
    attach(pts, true, layout, byId.get(s.target), sides.target, coilNozzle(layout, byId.get(s.target), s.targetCoil, 'inlet'), portDepth(layout, s.target, s.targetPort), slots.get(`${s.id}:target`));
    const others = [...layout.nodes].filter(([id]) => id !== s.source && id !== s.target).map(([, n]) => n);
    if (byId.get(s.source)?.type === 'tee') bendAtTee(pts, false, others);
    if (byId.get(s.target)?.type === 'tee') bendAtTee(pts, true, others);
    const drawn = dedupe(pts);
    return [{ s, edge, pts, drawn, d: polyline(drawn) }];
  });
  separateOverlaps(routes, byId);
  // Where each tee's lines actually join, as drawn: its dots go there.
  const teeDots = new Map<string, Point[]>();
  for (const eq of model.equipment) {
    if (eq.type !== 'tee') continue;
    const paths = routes.filter((r) => r.s.source === eq.id || r.s.target === eq.id).map((r) => r.drawn);
    const node = layout.nodes.get(eq.id);
    const found = junctions(paths);
    teeDots.set(eq.id, found.length || !node ? found : [{ x: node.x, y: node.y }]);
    // With one junction, the tee's lines all start or end there, so each is drawn up to the dot
    // and not along a stub to the tee's layout position (where colours would change instead).
    if (found.length === 1) meetAt(routes.filter((r) => r.s.source === eq.id || r.s.target === eq.id), eq.id, found[0]!);
  }
  const hopped = hopPaths(
    routes.map((r) => r.d),
    'arc',
  );

  w.open('g', { class: 'streams' });
  routes.forEach(({ s, edge, pts, d }, i) => {
    const blocked = (s.kind === 'process' || s.kind === 'electric') && isBlocked(s, byId);
    // linkStyle: `default` first, then the line's own; Mermaid checks every declaration.
    // `linkStyle default`, then the line's classes, then its own `linkStyle` / `style`.
    const decls = [
      ...(model.linkStyleDefault ?? []),
      ...(s.classes ?? []).flatMap((c) => model.classDefs.get(c) ?? []),
      ...(s.style ?? []),
    ];
    const { fill: _fill, stroke, ...lineStyle } = decls.length ? checkStyle(decls, (wn) => ctx.warn(wn)).shape : ({} as Attrs);
    const ink = (stroke as Paint['line'] | undefined) ?? (s.kind === 'electric' ? checkColor(CABLE)! : paint.line);
    const lineClasses = (s.classes ?? []).map((c) => ` class-${c}`).join('');
    w.open('g', { class: `stream ${s.kind}${blocked ? ' stream-blocked' : ''}${lineClasses}`, 'data-id': s.ast });
    w.leaf('path', {
      d: hopped[i] ?? d,
      fill: 'none',
      stroke: ink,
      'stroke-width': WEIGHT[s.kind],
      'stroke-dasharray': s.kind === 'signal' ? SIGNAL_DASH : undefined,
      ...lineStyle,
      // A blocked line stays dashed and faded whatever its style says: that is live state.
      ...(blocked ? { 'stroke-dasharray': DASH, 'stroke-opacity': 0.55 } : {}),
    });
    if (drawsArrow(s, byId))
      w.leaf('path', { d: arrowHead(pts[pts.length - 2]!, pts[pts.length - 1]!), fill: ink, stroke: 'none' });
    const number = layout.lineNumbers.get(s.id);
    if (number) {
      const at = edge.label ? onRoute(edge.label, pts) : longestMiddle(pts);
      drawLineNumber(w, number, pts, at, layout.edgeLabels.get(s.id), ink, layout.fontSize - 3);
    }
    const lbl = layout.edgeLabels.get(s.id);
    if (lbl && edge.label) {
      const at = onRoute(edge.label, pts);
      w.leaf('rect', {
        class: 'stream-label',
        x: r(at.x - lbl.width / 2),
        y: r(at.y - lbl.height / 2),
        width: lbl.width,
        height: lbl.height,
        rx: 3,
        fill: paint.labelBg,
        stroke: paint.border,
        'stroke-width': 0.8,
      });
      w.label(lbl.box, at.x, at.y, { fill: paint.text, 'font-size': layout.fontSize - 2 });
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
    const styled = styleFor(eq, model, paint, ctx);
    const classes = [
      'equipment',
      eq.type,
      ...look.classes,
      ...(eq.gradient ? ['has-gradient'] : []),
      ...(eq.level ? ['has-level'] : []),
      ...(eq.classes ?? []).map((c) => `class-${c}`),
    ];
    w.open('g', { class: classes.join(' '), 'data-id': eq.ast });
    const turned =
      place.turn === 90
        ? transforms(translate(r(left + place.width), r(top)), rotate(90))
        : place.turn === -90
          ? transforms(translate(r(left), r(top + place.height)), rotate(-90))
          : translate(r(left), r(top));
    // Then the symbol's scale, and mirroring across the flow, both in its own coordinates.
    const scaled = place.scale !== 1 ? transforms(turned, scale(place.scale)) : turned;
    w.open('g', { transform: place.mirror ? transforms(scaled, translate(0, sym.height), scale(1, -1)) : scaled });
    if (eq.image || eq.icon) drawCustom(w, eq, place, look, styled, ctx);
    // A tee's dots are drawn where its lines join (below), not at its own position.
    for (const part of eq.type === 'tee' ? [] : sym.parts) {
      // Lettering stays readable: undo the symbol's turn and mirror around the letter's centre.
      const keep = part.upright && (place.turn || place.mirror) ? part.upright : undefined;
      if (keep) {
        const unturn = place.turn ? rotate(-place.turn, keep.x, keep.y) : undefined;
        const unmirror = place.mirror ? transforms(translate(0, 2 * keep.y), scale(1, -1)) : undefined;
        const parts = [unmirror, unturn].filter((t): t is NonNullable<typeof t> => t !== undefined);
        w.open('g', { transform: parts.length === 1 ? parts[0]! : transforms(...parts) });
      }
      drawPart(w, part, eq, look, styled.paint, styled.shape, place.scale);
      if (keep) w.close();
    }
    const inside = (eq.gradient || eq.level) && interiorOf(eq.type);
    const fillMarks = inside ? drawFill(w, eq, inside, sym, model, layout, styled, ctx, { x: left, y: top }, place.scale) : undefined;
    if (eq.coils) drawCoils(w, eq, layout, styled.paint, place.scale);
    if (eq.type === 'valve3') drawBore(w, eq, styled.paint);
    if (eq.type === 'breaker') drawBlade(w, eq, styled.paint);
    w.close();
    fillMarks?.();
    for (const p of teeDots.get(eq.id) ?? []) w.leaf('circle', { class: 'tee-dot', cx: r(p.x), cy: r(p.y), r: 3.5, fill: styled.paint.border, stroke: 'none' });
    if (place.labels.bubble) drawBubble(w, place.labels.bubble, node, styled.text);
    drawLabels(w, layout, node, place, styled.text);
    w.close();
  }
  w.close();
  w.close();
}

type Paint = Record<'line' | 'border' | 'bg' | 'text' | 'labelBg', ReturnType<RenderContext['theme']['color']>>;

interface Styled {
  /** The theme paint with the user's `fill` (background) and `stroke` (outline) in it. */
  paint: Paint;
  /** Other checked outline attributes: stroke-width, opacity, stroke-dasharray, … */
  shape: Attrs;
  /** Label attributes: `color` as `fill`, font weight and style. */
  text: Attrs;
  /** The styles set a fill or stroke: a custom image gets a backing card in them. */
  painted: boolean;
}

/**
 * The look `classDef` / `class` / `style` give a piece of equipment: class declarations in the
 * order the classes were applied, then its own `style` on top. Mermaid checks every declaration;
 * unknown properties and unsafe values are dropped with a render warning.
 */
function styleFor(eq: Equipment, model: PidModel, paint: Paint, ctx: RenderContext): Styled {
  const decls = [...(eq.classes ?? []).flatMap((c) => model.classDefs.get(c) ?? []), ...(eq.style ?? [])];
  if (!decls.length) return { paint, shape: {}, text: { fill: paint.text }, painted: false };
  const checked = checkStyle(decls, (w) => ctx.warn(w));
  const { fill, stroke, ...shape } = checked.shape;
  return {
    paint: {
      ...paint,
      bg: (fill as Paint['bg'] | undefined) ?? paint.bg,
      border: (stroke as Paint['border'] | undefined) ?? paint.border,
    },
    shape,
    text: { fill: paint.text, ...checked.text },
    painted: fill !== undefined || stroke !== undefined,
  };
}

/**
 * An image or icon in place of the symbol. A `fill` or `stroke` from the styles draws a backing
 * card behind it; an unknown or travelling state frames it dashed. An image URL Mermaid refuses,
 * or an icon whose pack is not loaded, leaves a dashed placeholder.
 */
function drawCustom(w: SvgWriter, eq: Equipment, place: NodePlacement, look: StateLook, styled: Styled, ctx: RenderContext): void {
  const { width, height } = place;
  const frame = (attrs: Attrs) => w.leaf('rect', { x: -3, y: -3, width: width + 6, height: height + 6, rx: 4, ...attrs });
  if (styled.painted) frame({ fill: styled.paint.bg, stroke: styled.paint.border, 'stroke-width': 1.2, ...styled.shape });
  let drawn = false;
  if (eq.image) {
    const href = checkImageUrl(imageUrl(eq.image.url, ctx), { securityLevel: ctx.securityLevel, warn: (w) => ctx.warn(w) });
    if (href) {
      w.leaf('image', { class: 'custom-image', href, x: 0, y: 0, width, height, preserveAspectRatio: 'xMidYMid meet' });
      drawn = true;
    }
  } else if (eq.icon) {
    const glyph = ctx.icon?.(eq.icon.name, eq.icon.size, { paint: styled.paint.border });
    if (glyph) {
      w.open('g', { class: 'custom-icon' });
      writeFragment(w, glyph);
      w.close();
      drawn = true;
    } else {
      ctx.warn({ code: 'PID_ICON_MISSING', message: `Icon "${eq.icon.name}" for ${eq.id} is not available: is its icon pack registered?` });
    }
  }
  if (!drawn || look.dashed) frame({ fill: 'none', stroke: styled.paint.border, 'stroke-width': 1.2, 'stroke-dasharray': DASH });
}

/**
 * An image path as the browser should load it: a relative one (no scheme, not starting with `/`)
 * is joined to the `pid.imageBase` config, so `heat-pump.png` in a Home Assistant card loads
 * `/local/heat-pump.png` rather than a path under the dashboard's own URL.
 */
export function imageUrl(url: string, ctx: Pick<RenderContext, 'config'>): string {
  if (/^([a-z][a-z0-9+.-]*:|\/)/i.test(url)) return url;
  const base = String((ctx.config as { pid?: { imageBase?: unknown } }).pid?.imageBase ?? '');
  if (!base) return url;
  return base.replace(/\/*$/, '/') + url.replace(/^\.\//, '');
}

/** The colour scale for readings, cold to hot. */
const SCALE: readonly Rgb[] = ['#1565c0', '#29b6f6', '#fdd835', '#fb8c00', '#c62828'].map((h) => parseRgb(h)!);
/** A level's liquid without a gradient. */
const LIQUID = '#90caf9';
/** A battery's charge without a gradient. */
const CHARGE = '#66bb6a';
/** Band height of a fill, px: thin enough to read as a smooth gradient. */
const BAND = 2;

type Rgb = [number, number, number];

/** `#rgb`, `#rrggbb` or `rgb(r, g, b)` as numbers; undefined for anything else. */
function parseRgb(text: string): Rgb | undefined {
  const t = text.trim();
  let m = /^#([0-9a-f]{3})$/i.exec(t);
  if (m) return [...m[1]!].map((c) => parseInt(c + c, 16)) as Rgb;
  m = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec(t);
  if (m) return [0, 2, 4].map((i) => parseInt(m![1]!.slice(i, i + 2), 16)) as Rgb;
  m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(t);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])].map((v) => Math.min(255, v)) as Rgb;
  return undefined;
}

const mix = (a: Rgb, b: Rgb, t: number): Rgb => [0, 1, 2].map((i) => Math.round(a[i]! + (b[i]! - a[i]!) * t)) as Rgb;
const hex = (c: Rgb) => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;

/** Where `value` falls on the colour scale over `range` (either way round). */
export function scaleColour(value: number, [lo, hi]: readonly [number, number]): Rgb {
  const t = Math.min(1, Math.max(0, (value - lo) / (hi - lo)));
  const x = t * (SCALE.length - 1);
  const i = Math.min(SCALE.length - 2, Math.floor(x));
  return mix(SCALE[i]!, SCALE[i + 1]!, x - i);
}

/** Black or white, whichever reads better on `bg`. */
const ink = (bg: Rgb): string => (0.2126 * bg[0] + 0.7152 * bg[1] + 0.0722 * bg[2] > 140 ? '#000000' : '#ffffff');

/**
 * A vessel's contents: a gradient through its stops (readings on the colour scale, or colours),
 * up to the level when there is one; then the level line with its ▽, the readings on the wall,
 * and the outline again on top. Built from horizontal bands that follow the inner wall.
 */
function drawFill(
  w: SvgWriter,
  eq: Equipment,
  inside: Interior,
  sym: SymbolDef,
  model: PidModel,
  layout: PidLayout,
  styled: Styled,
  ctx: RenderContext,
  /** Where the symbol's (0, 0) is in the diagram, and its scale. */
  origin: Point,
  f: number,
): () => void {
  const { top, bottom } = inside;
  const height = bottom - top;
  const range = eq.gradientRange ?? model.gradientRange;
  const colour = (c: Rgb) => checkColor(hex(c));

  // Gradient stops with a colour, bottom to top; a reading Home Assistant does not have is skipped.
  const stops = (eq.gradient ?? [])
    .flatMap((st) => {
      const c = st.color !== undefined ? parseRgb(st.color) : st.value !== undefined ? scaleColour(st.value, range) : undefined;
      if (st.color !== undefined && !c)
        ctx.warn({ code: 'PID_GRADIENT_COLOUR', message: `${eq.id}: gradient colour "${st.color}" is not #hex or rgb()` });
      return c ? [{ h: st.height, c }] : [];
    })
    .sort((a, b) => a.h - b.h);
  const levelPercent = eq.level?.percent;
  const liquid = eq.type === 'battery' ? CHARGE : LIQUID;
  const plain = parseRgb(eq.level?.color ?? liquid) ?? parseRgb(liquid)!;
  const colourAt = (h: number): Rgb | undefined => {
    if (!stops.length) return eq.level && levelPercent !== undefined ? plain : undefined;
    if (h <= stops[0]!.h) return stops[0]!.c;
    const last = stops[stops.length - 1]!;
    if (h >= last.h) return last.c;
    const k = stops.findIndex((st) => st.h >= h);
    const a = stops[k - 1]!;
    const b = stops[k]!;
    return mix(a.c, b.c, (h - a.h) / (b.h - a.h || 1));
  };

  w.open('g', { class: 'fill' });
  for (let y = top; y < bottom; y += BAND) {
    const h = (bottom - (y + BAND / 2)) / height;
    if (levelPercent !== undefined && h > levelPercent / 100) continue;
    const span = inside.span(y + BAND / 2);
    const c = colourAt(h);
    if (!span || !c) continue;
    const [x0, x1] = [span[0] + 0.8, span[1] - 0.8];
    if (x1 <= x0) continue;
    w.leaf('rect', { x: r(x0), y: r(y), width: r(x1 - x0), height: BAND + 0.4, fill: colour(c), stroke: 'none' });
  }
  w.close();

  // The outline again, over the fill, at its usual thickness whatever the scale.
  for (const part of sym.parts) {
    const d = part.tag === 'path' ? { d: toPath(String(part.attrs.d)) } : {};
    w.leaf(part.tag, { ...part.attrs, ...d, fill: 'none', stroke: styled.paint.border, 'stroke-width': 1.4 / f, ...styled.shape });
  }

  // Readings, ticks and the level line are drawn after the symbol, in diagram coordinates, so
  // they keep their size when the vessel is scaled.
  const marks = layout.fillMarks.get(eq.id);
  const markSize = layout.markSize;
  const X = (x: number) => origin.x + x * f;
  const topA = origin.y + top * f;
  const bottomA = origin.y + bottom * f;
  const heightA = bottomA - topA;
  const yAt = (h: number) => bottomA - h * heightA;
  const wallAt = (y: number): [number, number] | undefined => {
    const span = inside.span(Math.min(bottom - 1, Math.max(top + 1, (y - origin.y) / f)));
    return span && [X(span[0]), X(span[1])];
  };
  // Text colour for whatever is behind it at height `y`: the fill there, or the empty vessel.
  const textOn = (y: number): Attrs => {
    const h = (bottomA - y) / heightA;
    const filled = levelPercent === undefined || h <= levelPercent / 100;
    const c = filled ? colourAt(h) : undefined;
    return { fill: c ? colour(parseRgb(ink(c))!) : styled.text.fill, 'font-size': markSize };
  };

  return () => {
    // The level: a line across the surface, the P&ID ▽ above it, and its value. A battery's
    // charge is not a liquid: no surface line or ▽, just the fill and the value.
    if (eq.level && levelPercent !== undefined && eq.type !== 'battery') {
      const y = yAt(levelPercent / 100);
      const span = wallAt(y);
      if (span) {
        w.leaf('path', { class: 'level', d: pathBuilder().moveTo(r(span[0]), r(y)).lineTo(r(span[1]), r(y)).done(), fill: 'none', stroke: styled.paint.border, 'stroke-width': 1.2 });
        const x = span[1] - 9;
        w.leaf('path', {
          class: 'level-marker',
          d: pathBuilder().moveTo(r(x - 4), r(y - 8)).lineTo(r(x + 4), r(y - 8)).lineTo(r(x), r(y - 2)).close().done(),
          fill: 'none',
          stroke: styled.paint.border,
          'stroke-width': 1,
        });
      }
    }
    // Readings already placed, so later ones can step clear of them.
    const taken: { y: number; half: number }[] = [];
    const clearOf = (y: number, half: number) => {
      let at = y;
      for (let tries = 0; tries < 8; tries++) {
        const hit = taken.find((t) => Math.abs(t.y - at) < t.half + half);
        if (!hit) break;
        at = hit.y + hit.half + half + 1;
      }
      return at;
    };
    if (marks?.level && eq.level) {
      const h = levelPercent === undefined ? 0.5 : levelPercent / 100;
      const y = Math.max(topA + marks.level.height / 2 + 1, yAt(h) - 3 - marks.level.height / 2);
      taken.push({ y, half: marks.level.height / 2 });
      const span = wallAt(y);
      // Labels are placed by their centre: start the text just inside the left wall.
      if (span) w.label(marks.level, span[0] + 3 + marks.level.width / 2, y, { class: 'level-value', ...textOn(y) });
    }

    // Readings at their heights: a tick on the left wall and the value beside it.
    (eq.gradient ?? []).forEach((st, k) => {
      const label = marks?.stops[k];
      if (!label) return;
      const wanted = Math.min(bottomA - label.height / 2 - 1, Math.max(topA + label.height / 2 + 1, yAt(st.height)));
      const y = clearOf(wanted, label.height / 2);
      if (y > bottomA - label.height / 2) return; // no room left below: leave this reading out
      taken.push({ y, half: label.height / 2 });
      const span = wallAt(y);
      if (!span) return;
      const attrs = textOn(y);
      w.leaf('path', { class: 'gradient-tick', d: pathBuilder().moveTo(r(span[0]), r(y)).lineTo(r(span[0] + 4), r(y)).done(), stroke: attrs.fill as Paint['line'], 'stroke-width': 1 });
      w.label(label, span[0] + 6 + label.width / 2, y, { class: 'gradient-value', ...attrs });
    });
  };
}

function drawPart(w: SvgWriter, part: SymbolPart, eq: Equipment, look: StateLook, paint: Paint, extra: Attrs = {}, f = 1): void {
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
    'stroke-width': 1.4 / f,
    ...extra,
    ...(look.dashed ? { 'stroke-dasharray': DASH } : {}),
  });
}

/**
 * A breaker's blade: from the left terminal straight to the right one when it conducts, lifted
 * when it is open, half-lifted and dashed when its state is unknown.
 */
function drawBlade(w: SvgWriter, eq: Equipment, paint: Paint): void {
  const closed = breakerClosed(eq);
  const end = closed === true ? { x: 33.5, y: 14 } : closed === false ? { x: 31, y: 0 } : { x: 33, y: 7 };
  w.leaf('path', {
    class: `blade blade-${closed === true ? 'closed' : closed === false ? 'open' : 'unknown'}`,
    d: pathBuilder().moveTo(4, 14).lineTo(end.x, end.y).done(),
    fill: 'none',
    stroke: paint.border,
    'stroke-width': 2,
    'stroke-dasharray': closed === undefined ? DASH : undefined,
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
  // An actuated valve's body sits lower, to make room for the actuator above it.
  const dy = eq.actuated ? VALVE3_ACTUATOR_DROP : 0;
  w.leaf('circle', {
    class: 'ball',
    cx: BORE_CENTRE.x,
    cy: BORE_CENTRE.y + dy,
    r: BALL_RADIUS,
    fill: paint.bg,
    stroke: paint.border,
    'stroke-width': 1.4,
  });
  const ports = connectedPorts(eq.state);
  if (!ports || ports.size < 2 || boreProblem(eq)) return;
  const b = pathBuilder();
  for (const port of PORTS) if (ports.has(port)) b.moveTo(BORE_CENTRE.x, BORE_CENTRE.y + dy).lineTo(BORE_ENDS[port].x, BORE_ENDS[port].y + dy);
  w.leaf('path', { class: `bore bore-${eq.bore}`, d: b.done(), fill: 'none', stroke: paint.line, 'stroke-width': BORE_WIDTH });
}

/** ISA-5.1: function letters in the bubble's upper half, the loop number in the lower half. */
function drawBubble(w: SvgWriter, b: NonNullable<NodePlacement['labels']['bubble']>, node: Point, text: Attrs): void {
  const shift = b.size * 0.6;
  w.label(b.letters, node.x, node.y - shift, { class: 'instrument-letters', ...text, 'font-size': b.size, 'font-weight': 'bold' });
  if (b.loop.width > 0) w.label(b.loop, node.x, node.y + shift, { class: 'instrument-loop', ...text, 'font-size': b.size });
}

/** Tag (bold), name and state (italic), centred in a column on the placement's label side. */
function drawLabels(w: SvgWriter, layout: PidLayout, node: Point, place: NodePlacement, text: Attrs): void {
  const { labels, side } = place;
  const fs = layout.fontSize;
  let cx = node.x;
  let y = node.y - labels.height / 2;
  if (side === 'below') y = node.y + place.height / 2 + LABEL_GAP;
  else if (side === 'above') y = node.y - place.height / 2 - LABEL_GAP - labels.height;
  else cx = node.x + (side === 'right' ? 1 : -1) * (place.width / 2 + LABEL_GAP + labels.width / 2);
  const line = (l: MeasuredLabel | undefined, attrs: Parameters<SvgWriter['label']>[3]) => {
    if (!l) return;
    w.label(l, cx, y + l.height / 2, { ...text, ...attrs });
    y += l.height;
  };
  line(labels.tag, { 'font-size': fs, 'font-weight': 'bold' });
  line(labels.value, { class: 'instrument-value', 'font-size': fs, 'font-weight': 'bold' });
  line(labels.name, { 'font-size': fs - 2 });
  line(labels.state, { class: 'equipment-state', 'font-size': fs - 2, 'font-style': 'italic' });
}

/**
 * A 3-way valve's port C ends at the base of its triangle, 33 px from the body's centre; the
 * symbol's box can reach further on that side (room kept for an actuator opposite).
 */
function portDepth(layout: PidLayout, id: string, port: Port | undefined): number | undefined {
  const place = layout.placements.get(id);
  return port === 'C' && place ? 33 * place.scale : undefined;
}

/** Where a line meets coil `i` of `eq`, in diagram coordinates: its inlet or outlet nozzle. */
function coilNozzle(layout: PidLayout, eq: Equipment | undefined, i: number | undefined, end: 'inlet' | 'outlet'): Point | undefined {
  if (!eq || i === undefined || !eq.coils?.[i]) return undefined;
  const node = layout.nodes.get(eq.id);
  const place = layout.placements.get(eq.id);
  const shape = coilShape(eq.type, eq.coils[i], coilSide(layout, eq, i, 'in'), coilSide(layout, eq, i, 'out'));
  if (!node || !place || !shape) return undefined;
  const p = shape[end];
  return { x: node.x - place.width / 2 + p.x * place.scale, y: node.y - place.height / 2 + p.y * place.scale };
}

/** Heat exchanger coils inside a vessel, over its contents; each named one has a tooltip. */
function drawCoils(w: SvgWriter, eq: Equipment, layout: PidLayout, paint: Paint, f: number): void {
  eq.coils?.forEach((coil, i) => {
    const shape = coilShape(eq.type, coil, coilSide(layout, eq, i, 'in'), coilSide(layout, eq, i, 'out'));
    if (!shape) return;
    w.open('g', { class: `coil coil${i + 1}` });
    if (coil.name) {
      w.open('title');
      w.text(coil.name);
      w.close();
    }
    w.leaf('path', { d: toPath(shape.path), fill: 'none', stroke: paint.border, 'stroke-width': 1.6 / f });
    w.close();
  });
}

/** The wall a coil's inlet or outlet nozzle is on. */
function coilSide(layout: PidLayout, eq: Equipment, i: number, end: 'in' | 'out'): 'left' | 'right' {
  return layout.coilSides.get(coilKey(eq.id, i, end)) ?? eq.coils?.[i]?.side ?? 'left';
}

/** Where `p` lies along `path`: the index of the segment it is on, or -1. */
function along(path: readonly Point[], p: Point): number {
  for (let k = 0; k + 1 < path.length; k++) if (toSegment(p, path[k]!, path[k + 1]!) < 1) return k;
  return -1;
}

/**
 * Redraws a tee's lines so they all meet at its junction `j`: a line that passes `j` on its way
 * to the tee's layout position stops (or starts) at `j`; a line that leaves the tee's position
 * away from `j` gets the stretch from `j` added, so that stretch is drawn once, as part of it.
 */
function meetAt(routes: { s: Stream; drawn: Point[]; d: PathData }[], tee: string, j: Point): void {
  const copy = (p: Point): Point => ({ x: p.x, y: p.y });
  // Each line oriented from the tee outwards.
  const outward = routes.map((r) => (r.s.source === tee ? r.drawn.map(copy) : [...r.drawn].reverse().map(copy)));
  // The stretch from the junction back to the tee's position, from a line that passes it.
  let trunk: Point[] | undefined;
  for (const out of outward) {
    const k = along(out, j);
    if (k >= 0) {
      trunk = [copy(j), ...out.slice(0, k + 1).reverse()];
      break;
    }
  }
  if (!trunk) return;
  routes.forEach((r, i) => {
    const out = outward[i]!;
    const k = along(out, j);
    const next =
      k >= 0
        ? [copy(j), ...out.slice(k + 1)] // passes the junction: start there
        : [...trunk!.map(copy), ...out.slice(1)]; // leaves away from it: add the stretch from it
    const drawn = dedupe(next);
    r.drawn = r.s.source === tee ? drawn : drawn.reverse();
    r.d = polyline(r.drawn);
  });
}

/**
 * Two different lines must not run along the same column or row: where the layout put two runs
 * on one track over a stretch, the later run moves aside (each step by `LINE_GAP`) until it is
 * clear. Lines of one tee share their trunk on purpose, and a run that ends on a symbol stays,
 * so only inner runs move; the runs either side stretch with them and stay straight.
 */
function separateOverlaps(routes: { s: Stream; drawn: Point[]; d: PathData }[], byId: ReadonlyMap<string, Equipment>): void {
  const tees = (s: Stream) => [s.source, s.target].filter((id) => byId.get(id)?.type === 'tee');
  const shareTee = (a: Stream, b: Stream) => tees(a).some((t) => tees(b).includes(t));
  const overlap = (a0: Point, a1: Point, b0: Point, b1: Point): boolean => {
    const vertical = Math.abs(a0.x - a1.x) < 0.5 && Math.abs(b0.x - b1.x) < 0.5 && Math.abs(a0.x - b0.x) < 0.5;
    const horizontal = Math.abs(a0.y - a1.y) < 0.5 && Math.abs(b0.y - b1.y) < 0.5 && Math.abs(a0.y - b0.y) < 0.5;
    if (!vertical && !horizontal) return false;
    const p = vertical ? 'y' : 'x';
    const lo = Math.max(Math.min(a0[p], a1[p]), Math.min(b0[p], b1[p]));
    const hi = Math.min(Math.max(a0[p], a1[p]), Math.max(b0[p], b1[p]));
    return hi - lo > 1;
  };
  for (let round = 0; round < 6; round++) {
    let moved = false;
    routes.forEach((r, i) => {
      for (let k = 1; k + 2 < r.drawn.length; k++) {
        const [a0, a1] = [r.drawn[k]!, r.drawn[k + 1]!];
        const hit = routes.some((o, j) => {
          if (j >= i || shareTee(r.s, o.s)) return false;
          for (let m = 0; m + 1 < o.drawn.length; m++) if (overlap(a0, a1, o.drawn[m]!, o.drawn[m + 1]!)) return true;
          return false;
        });
        if (!hit) continue;
        if (Math.abs(a0.x - a1.x) < 0.5) {
          a0.x += LINE_GAP;
          a1.x += LINE_GAP;
        } else {
          a0.y += LINE_GAP;
          a1.y += LINE_GAP;
        }
        moved = true;
      }
    });
    if (!moved) break;
  }
  for (const r of routes) r.d = polyline(r.drawn);
}

/** How far from its centre along a side a symbol can take lines, keeping clear of its corners. */
function sideLimit(eq: Equipment, place: NodePlacement, across: boolean): number {
  const radius = symbolFor(eq).round;
  const round = radius === undefined ? undefined : radius * place.scale;
  const symV = (across ? place.height : place.width) / 2;
  const reach =
    round !== undefined
      ? round * 0.6
      : eq.type === 'instrument'
        ? symV / 2
        : CENTRED.has(eq.type)
          ? 0
          : Math.max(0, symV - CORNER);
  const limit = Math.max(reach, symV - Math.min(CORNER / 2, symV / 3));
  // On a round symbol the end must stay on the circle.
  return round !== undefined ? Math.min(limit, round - 2) : limit;
}

/**
 * Where lines meet a symbol when several share one of its sides: spread evenly around the
 * centre, ordered by where each heads once it leaves (the one going up takes the top point, the
 * one going left the left point), so they neither overlap nor cross. Tees join their lines on
 * purpose, and ports, coil nozzles and actuators have their own points: they are left alone.
 * Keys are `streamId:source` / `streamId:target`.
 */
function planSlots(
  model: PidModel,
  layout: PidLayout,
  byId: ReadonlyMap<string, Equipment>,
  mirrored: ReadonlySet<string>,
): Map<string, number> {
  type End = { key: string; pull: number };
  const groups = new Map<string, { eq: Equipment; across: boolean; ends: End[] }>();
  for (const s of model.streams) {
    const pts = layout.edges.get(s.id)?.points;
    if (!pts || pts.length < 2) continue;
    const sides = endSides(model.direction, s, byId, mirrored, layout.coilSides);
    for (const atEnd of [false, true]) {
      const eq = byId.get(atEnd ? s.target : s.source);
      const fixedEnd = atEnd ? s.targetCoil !== undefined || sides.target : s.sourceCoil !== undefined || sides.source;
      if (!eq || eq.type === 'tee' || fixedEnd) continue;
      const node = layout.nodes.get(eq.id);
      if (!node) continue;
      const k = atEnd ? pts.length - 1 : 0;
      const E = pts[k]!;
      const P = pts[atEnd ? k - 1 : 1]!;
      const Q = pts.length >= 3 ? pts[atEnd ? k - 2 : 2]! : P;
      const across = Math.abs(E.y - P.y) < 0.5;
      const U = (p: { x: number; y: number }) => (across ? p.x : p.y);
      const V = (p: { x: number; y: number }) => (across ? p.y : p.x);
      const sign = Math.sign(U(P) - U(node)) || 1;
      const id = `${eq.id}:${across ? 'h' : 'v'}:${sign}`;
      const group = groups.get(id) ?? { eq, across, ends: [] };
      group.ends.push({ key: `${s.id}:${atEnd ? 'target' : 'source'}`, pull: V(Q) });
      groups.set(id, group);
    }
  }
  const out = new Map<string, number>();
  for (const { eq, across, ends } of groups.values()) {
    if (ends.length < 2) continue;
    const node = layout.nodes.get(eq.id)!;
    const place = layout.placements.get(eq.id)!;
    const limit = sideLimit(eq, place, across);
    const centre = across ? node.y : node.x;
    const gap = Math.min(LINE_GAP, (2 * limit) / (ends.length - 1));
    ends.sort((a, b) => a.pull - b.pull);
    ends.forEach((e, n) => out.set(e.key, centre + (n - (ends.length - 1) / 2) * gap));
  }
  return out;
}

/** Compact symbols are met on their centre line; tall or wide ones anywhere near it. */
const CENTRED: ReadonlySet<EquipmentType> = new Set([
  'pump', 'compressor', 'exchanger', 'valve', 'valve3', 'feed', 'product', 'instrument', 'tee',
  'inverter', 'breaker', 'meter', 'grid', 'consumer',
]);
/** Keep stream ends this far from a symbol's corners. */
const CORNER = 20;
/** The least distance between two lines meeting one side of a symbol. */
const LINE_GAP = 8;
/** How far outside the box a stream turns to line up with the symbol. */
const STUB = 10;

/**
 * The layout ends a stream anywhere on the node's box, which is larger than the symbol so it can
 * hold the labels. Moves the end (`atEnd`) or the start of `pts` onto the symbol: straight on
 * when it already lines up, else with a jog just outside the box. A port end meets its port.
 */
function attach(
  pts: Point[],
  atEnd: boolean,
  layout: PidLayout,
  eq: Equipment | undefined,
  side: Side | undefined,
  /** An exact end on the symbol (a coil's nozzle), instead of one worked out from its shape. */
  fixed?: Point,
  /** How far from the centre the line ends, where the symbol's box reaches further (port C). */
  depthAt?: number,
  /** Where along the symbol's side this line meets it, when several share that side. */
  slot?: number,
): void {
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
  const radius = symbolFor(eq).round;
  const round = side || radius === undefined ? undefined : radius * place.scale;
  const squareInstrument = eq.type === 'instrument' && !round;
  const reach = round ? round * 0.6 : side ? 0 : squareInstrument ? symV / 2 : CENTRED.has(eq.type) ? 0 : Math.max(0, symV - CORNER);
  const v = fixed ? V(fixed) : (slot ?? Math.min(V(node) + reach, Math.max(V(node) - reach, V(E))));
  // Lines run into a tee's centre; a round symbol is met on its circle; anything else on its box.
  const depth = depthAt ?? (eq.type === 'tee' ? 0 : round ? Math.sqrt(round * round - (v - V(node)) ** 2) : symU);
  const end = fixed ?? at(U(node) + sign * depth, v);
  let tail: Point[];
  const Q = pts.length >= 3 ? pts[atEnd ? i - 2 : 2] : undefined;
  if (Math.abs(V(E) - v) < 0.5 && Math.abs(V(P) - v) < 0.5) tail = [end];
  else if (Q && Math.abs(V(P) - V(E)) < 0.5 && Math.abs(U(Q) - U(P)) < 0.5) {
    // The run in is straight and the bend before it turns across: move that bend to line the
    // run up with the symbol, instead of adding a jog at the end.
    pts[atEnd ? i - 1 : 1] = at(U(P), v);
    tail = [end];
  }
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
function bendAtTee(pts: Point[], atEnd: boolean, others: readonly Box[]): void {
  if (pts.length < 4) return;
  const at = (k: number) => pts[atEnd ? pts.length - 1 - k : k]!;
  const [tee, b, c, d] = [at(0), at(1), at(2), at(3)];
  const near = (p: number, q: number) => Math.abs(p - q) < 0.5;
  // The moved run lies in the tee's own column, where other nodes may sit: only move it there
  // when it passes none of them.
  const clear = (from: Point, to: Point) => !others.some((n) => crosses(from, to, n));
  if (near(tee.y, b.y) && near(b.x, c.x) && near(c.y, d.y)) {
    if (!clear(tee, { x: tee.x, y: c.y }) || !clear({ x: tee.x, y: c.y }, c)) return;
    b.x = tee.x;
    c.x = tee.x;
  } else if (near(tee.x, b.x) && near(b.y, c.y) && near(c.x, d.x)) {
    if (!clear(tee, { x: c.x, y: tee.y }) || !clear({ x: c.x, y: tee.y }, c)) return;
    b.y = tee.y;
    c.y = tee.y;
  }
}

type Box = { x: number; y: number; width: number; height: number };

/** Does the straight segment `a`–`b` pass through node box `n` (centre x/y)? */
function crosses(a: Point, b: Point, n: Box): boolean {
  const [x0, x1] = [Math.min(a.x, b.x), Math.max(a.x, b.x)];
  const [y0, y1] = [Math.min(a.y, b.y), Math.max(a.y, b.y)];
  return x0 < n.x + n.width / 2 && x1 > n.x - n.width / 2 && y0 < n.y + n.height / 2 && y1 > n.y - n.height / 2;
}

/**
 * A line number, P&ID style, where the layout kept room for it: above the stream tag box (or the
 * line) on a horizontal run, beside it on a vertical one.
 */
function drawLineNumber(
  w: SvgWriter,
  label: MeasuredLabel,
  pts: readonly Point[],
  at: Point,
  tag: { width: number; height: number } | undefined,
  ink: Attrs['fill'],
  fontSize: number,
): void {
  let vertical = false;
  for (let k = 0; k + 1 < pts.length; k++)
    if (toSegment(at, pts[k]!, pts[k + 1]!) < 2) {
      vertical = Math.abs(pts[k]!.x - pts[k + 1]!.x) < 0.5;
      break;
    }
  const attrs = { class: 'line-number', fill: ink, 'font-size': fontSize };
  if (vertical) w.label(label, at.x + (tag?.width ?? 0) / 2 + LINE_NUMBER_GAP + label.width / 2, at.y, attrs);
  else w.label(label, at.x, at.y - (tag?.height ?? 0) / 2 - LINE_NUMBER_GAP - label.height / 2, attrs);
}

/** The middle of the longest straight run of `pts`. */
function longestMiddle(pts: readonly Point[]): Point {
  let best = 0;
  let longest = -1;
  for (let k = 0; k + 1 < pts.length; k++) {
    const len = Math.hypot(pts[k + 1]!.x - pts[k]!.x, pts[k + 1]!.y - pts[k]!.y);
    if (len > longest) [best, longest] = [k, len];
  }
  return { x: (pts[best]!.x + pts[best + 1]!.x) / 2, y: (pts[best]!.y + pts[best + 1]!.y) / 2 };
}

/**
 * The points where three or more arms of these lines meet: real junctions. A line running
 * straight through a point counts as two arms (a pipe that just continues), so only a branch
 * leaving it, or lines meeting from three sides, makes a junction. Lines are orthogonal.
 */
export function junctions(paths: readonly (readonly Point[])[]): Point[] {
  const segs: [Point, Point][] = [];
  for (const path of paths) for (let k = 0; k + 1 < path.length; k++) segs.push([path[k]!, path[k + 1]!]);
  const near = (a: Point, b: Point) => Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1;
  const dir = (from: Point, to: Point) =>
    Math.abs(from.x - to.x) > Math.abs(from.y - to.y) ? (to.x > from.x ? 'E' : 'W') : to.y > from.y ? 'S' : 'N';
  const arms = (p: Point) => {
    const found = new Set<string>();
    for (const [a, b] of segs) {
      if (near(p, a)) found.add(dir(a, b));
      else if (near(p, b)) found.add(dir(b, a));
      else if (Math.abs(a.y - b.y) < 0.5 && Math.abs(p.y - a.y) < 1 && p.x > Math.min(a.x, b.x) && p.x < Math.max(a.x, b.x))
        found.add('E').add('W');
      else if (Math.abs(a.x - b.x) < 0.5 && Math.abs(p.x - a.x) < 1 && p.y > Math.min(a.y, b.y) && p.y < Math.max(a.y, b.y))
        found.add('N').add('S');
    }
    return found.size;
  };
  const out: Point[] = [];
  for (const p of segs.flat()) if (!out.some((q) => near(p, q)) && arms(p) >= 3) out.push(p);
  return out;
}

/** Distance from `p` to the segment `a`–`b`. */
function toSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = dx || dy ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * Where a stream label goes: where the layout put it when that is on the drawn route, else the
 * middle of the route's longest straight run. The layout can place a label for a route it then
 * changed (a forced port side), which would leave it floating beside the diagram.
 */
function onRoute(label: Point, pts: readonly Point[]): Point {
  for (let k = 0; k + 1 < pts.length; k++) if (toSegment(label, pts[k]!, pts[k + 1]!) < 2) return label;
  return longestMiddle(pts);
}

/** Drops points that repeat the one before them. */
function dedupe(pts: readonly Point[]): Point[] {
  return pts.filter((p, i) => i === 0 || Math.abs(p.x - pts[i - 1]!.x) > 0.01 || Math.abs(p.y - pts[i - 1]!.y) > 0.01);
}

/** A stream is blocked when either end is a valve port that is shut. */
function isBlocked(s: Stream, byId: Map<string, Equipment>): boolean {
  const at = (id: string, port: Stream['sourcePort']) => {
    const eq = byId.get(id);
    // A relief valve is closed in normal service: its lines stay solid. The valve itself still
    // shows closed (solid) or lifted (open).
    if (eq?.type === 'valve' && eq.valveKind === 'relief') return false;
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
