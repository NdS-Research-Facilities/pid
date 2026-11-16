import type { Equipment, EquipmentType, InstrumentLocation, Port, ValveKind } from './model.js';

export interface SymbolPart {
  tag: 'path' | 'circle' | 'rect';
  attrs: Record<string, string | number>;
  /** Filled with the node background (true) or drawn as a bare line (false). */
  fill: boolean;
  /** Always filled with the line colour (a globe valve's dot), whatever the state. */
  ink?: boolean;
  /** The 3-way valve port this part stands for: drawn solid when that port is shut. */
  port?: Port;
}

export interface SymbolDef {
  width: number;
  height: number;
  /** Drawn along the flow: turned a quarter when the diagram runs vertically. */
  turns?: boolean;
  /** A circle of this radius around the centre: lines may meet it off-centre. */
  round?: number;
  /** Parts in local coordinates, origin at the symbol's top-left corner. */
  parts: SymbolPart[];
}

const shape = (d: string): SymbolPart => ({ tag: 'path', attrs: { d }, fill: true });
const line = (d: string): SymbolPart => ({ tag: 'path', attrs: { d }, fill: false });

/** A capsule (vessel with two heads), vertical when h > w. */
function capsule(w: number, h: number): string {
  if (h >= w) {
    const r = w / 2;
    return `M0 ${r} A${r} ${r * 0.6} 0 0 1 ${w} ${r} V${h - r} A${r} ${r * 0.6} 0 0 1 0 ${h - r} Z`;
  }
  const r = h / 2;
  return `M${r} 0 H${w - r} A${r * 0.6} ${r} 0 0 1 ${w - r} ${h} H${r} A${r * 0.6} ${r} 0 0 1 ${r} 0 Z`;
}

/**
 * Simplified P&ID symbols, loosely after ISO 10628 / ISA 5.1. Sizes are in px; the layout adds
 * the tag label underneath.
 */
export const SYMBOLS: Record<EquipmentType, SymbolDef> = {
  block: { width: 80, height: 44, parts: [{ tag: 'rect', attrs: { x: 0, y: 0, width: 80, height: 44, rx: 3 }, fill: true }] },
  tank: { width: 64, height: 80, parts: [shape('M0 14 L32 0 L64 14 V80 H0 Z')] },
  vessel: { width: 50, height: 90, parts: [shape(capsule(50, 90))] },
  drum: { width: 100, height: 46, parts: [shape(capsule(100, 46))] },
  column: {
    width: 40,
    height: 150,
    parts: [
      shape(capsule(40, 150)),
      line([40, 60, 80, 100, 110].map((y, i) => (i % 2 ? `M0 ${y} H28` : `M12 ${y} H40`)).join(' ')),
    ],
  },
  reactor: {
    width: 64,
    height: 96,
    parts: [shape(capsule(64, 96)), line('M32 -8 V62 M20 62 H44 M20 58 V66 M44 58 V66')],
  },
  pump: {
    width: 48,
    height: 48,
    round: 22,
    parts: [{ tag: 'circle', attrs: { cx: 24, cy: 24, r: 22 }, fill: true }, line('M24 2 H46 M8 40 L2 48 H46 L40 40')],
  },
  compressor: { width: 60, height: 48, parts: [shape('M0 0 L60 12 V36 L0 48 Z')] },
  exchanger: {
    width: 56,
    height: 56,
    round: 26,
    parts: [{ tag: 'circle', attrs: { cx: 28, cy: 28, r: 26 }, fill: true }, line('M2 28 L12 28 L18 14 L28 42 L38 14 L44 28 L54 28')],
  },
  valve: { width: 36, height: 24, turns: true, parts: [shape('M0 0 L36 24 V0 L0 24 Z')] },
  // Ports A (left) and B (right) on the flow axis, C (the T's stem) below; the body's centre is
  // the symbol's centre so straight-through streams run through it.
  // Half as large again as a 2-way valve, so an L or T bore drawn inside stays readable.
  valve3: {
    width: 54,
    height: 66,
    turns: true,
    parts: [
      { ...shape('M0 15 L27 33 L0 51 Z'), port: 'A' },
      { ...shape('M54 15 L27 33 L54 51 Z'), port: 'B' },
      { ...shape('M27 33 L9 66 H45 Z'), port: 'C' },
    ],
  },
  instrument: { width: 42, height: 42, parts: [{ tag: 'circle', attrs: { cx: 21, cy: 21, r: 20 }, fill: true }] },
  // A tee: where branch lines join the pipe, marked with a connection dot.
  tee: { width: 8, height: 8, parts: [{ tag: 'circle', attrs: { cx: 4, cy: 4, r: 3.5 }, fill: false, ink: true }] },
  feed: { width: 70, height: 30, parts: [shape('M0 0 H55 L70 15 L55 30 H0 Z')] },
  product: { width: 70, height: 30, parts: [shape('M0 0 H55 L70 15 L55 30 H0 Z')] },
};

/** Instrument bubble diameter; the square of `dcs` and `plc` is the same size. */
export const BUBBLE = 42;
const R = BUBBLE / 2;
const circle: SymbolPart = { tag: 'circle', attrs: { cx: R, cy: R, r: R - 1 }, fill: true };
const square: SymbolPart = { tag: 'rect', attrs: { x: 0, y: 0, width: BUBBLE, height: BUBBLE }, fill: true };

/** ISA-5.1 instrument symbols by location. */
const INSTRUMENTS: Record<InstrumentLocation, SymbolDef> = {
  field: { width: BUBBLE, height: BUBBLE, round: R - 1, parts: [circle] },
  panel: { width: BUBBLE, height: BUBBLE, round: R - 1, parts: [circle, line(`M1 ${R} H${BUBBLE - 1}`)] },
  dcs: { width: BUBBLE, height: BUBBLE, parts: [square, { ...circle, fill: false }] },
  plc: { width: BUBBLE, height: BUBBLE, parts: [square, line(`M${R} 0 L${BUBBLE} ${R} L${R} ${BUBBLE} L0 ${R} Z`)] },
  computer: {
    width: BUBBLE,
    height: BUBBLE,
    parts: [shape(`M0 ${R} L${R / 2} 1 H${BUBBLE - R / 2} L${BUBBLE} ${R} L${BUBBLE - R / 2} ${BUBBLE - 1} H${R / 2} Z`)],
  },
};

const ink = (tag: 'circle' | 'rect', attrs: SymbolPart['attrs']): SymbolPart => ({ tag, attrs, fill: false, ink: true });

/** A valve body of `kind`, 36 × 24 with its top at `y`; the flow runs through its centre. */
function valveBody(kind: Exclude<ValveKind, 'relief'>, y: number): SymbolPart[] {
  const c = y + 12;
  const bow = shape(`M0 ${y} L36 ${y + 24} V${y} L0 ${y + 24} Z`);
  switch (kind) {
    case 'gate':
      return [bow];
    case 'globe':
      return [bow, ink('circle', { cx: 18, cy: c, r: 4 })];
    case 'ball':
      return [bow, { tag: 'circle', attrs: { cx: 18, cy: c, r: 6.5 }, fill: true }];
    case 'plug':
      return [bow, { tag: 'rect', attrs: { x: 14, y: c - 5, width: 8, height: 10 }, fill: true }];
    case 'butterfly':
      return [bow, line(`M18 ${y} V${y + 24}`), ink('circle', { cx: 18, cy: c, r: 3 })];
    case 'check':
      // Flow arrow against a seat: passes left to right only.
      return [shape(`M0 ${y + 2} L31 ${c} L0 ${y + 22} Z`), line(`M34 ${y} V${y + 24}`)];
  }
}

/**
 * A relief valve: inlet from the left, outlet down (the side a 3-way valve's C port uses), and
 * the spring above. The body sits at the centre so the inlet line runs straight in.
 */
const RELIEF_VALVE: SymbolDef = {
  width: 36,
  height: 44,
  turns: true,
  parts: [
    shape('M0 12 L18 22 L0 32 Z'),
    shape('M18 22 L6 44 H30 Z'),
    line('M18 22 V18 L12 16 L24 12 L12 8 L24 4 L18 2'),
  ],
};

/**
 * A valve of `kind`. A control valve (`actuated`) has a stem and a diaphragm actuator above
 * the body; the space below mirrors it, so the body stays at the symbol's centre on the line.
 */
export function valveSymbol(kind: ValveKind = 'gate', actuated = false): SymbolDef {
  if (kind === 'relief') return RELIEF_VALVE;
  if (!actuated) return { width: 36, height: 24, turns: true, parts: valveBody(kind, 0) };
  return {
    width: 36,
    height: 68,
    turns: true,
    parts: [...valveBody(kind, 22), line('M18 34 V12'), line('M6 12 A12 11 0 0 1 30 12 Z')],
  };
}

/** The symbol drawn for `eq`. A custom image or icon takes the symbol's place (no parts). */
export function symbolFor(eq: Pick<Equipment, 'type' | 'location' | 'actuated' | 'valveKind' | 'image' | 'icon'>): SymbolDef {
  if (eq.image) return { width: eq.image.width, height: eq.image.height, parts: [] };
  if (eq.icon) return { width: eq.icon.size, height: eq.icon.size, parts: [] };
  if (eq.type === 'instrument') return INSTRUMENTS[eq.location ?? 'field'];
  if (eq.type === 'valve') return valveSymbol(eq.valveKind, eq.actuated);
  return SYMBOLS[eq.type];
}

/**
 * An instrument tag split as ISA-5.1 draws it: the function letters (`TIC`) over the loop
 * number (`101`). Tags without a number keep everything on the first line.
 */
export function splitTag(tag: string): [letters: string, loop: string] {
  const m = /^([A-Za-z]+)[-\s]?(\d.*)$/.exec(tag);
  return m ? [m[1]!.toUpperCase(), m[2]!] : [tag, ''];
}

/**
 * The inside of a vessel, for gradients and levels: its liquid space from `top` to `bottom`
 * (symbol coordinates) and its width at each height. The SVG allowlist has no clip paths, so
 * fills are built from bands sized by `span`.
 */
export interface Interior {
  top: number;
  bottom: number;
  /** Left and right inner wall at height `y`, or undefined outside the vessel. */
  span(y: number): [number, number] | undefined;
}

/** A capsule's inside, matching `capsule(w, h)`: heads are elliptical arcs 0.6 r deep. */
function capsuleInterior(w: number, h: number): Interior {
  if (h >= w) {
    const r = w / 2;
    const depth = r * 0.6;
    return {
      top: r - depth,
      bottom: h - r + depth,
      span(y) {
        const off = y < r ? (r - y) / depth : y > h - r ? (y - (h - r)) / depth : 0;
        if (off > 1) return undefined;
        const half = r * Math.sqrt(1 - off * off);
        return [r - half, r + half];
      },
    };
  }
  const r = h / 2;
  const depth = r * 0.6;
  return {
    top: 0,
    bottom: h,
    span(y) {
      const off = (y - r) / r;
      if (Math.abs(off) > 1) return undefined;
      const bulge = depth * Math.sqrt(1 - off * off);
      return [r - bulge, w - r + bulge];
    },
  };
}

/** The inside of `type`, for those that can hold a gradient or level. A tank's roof is not liquid space. */
export function interiorOf(type: EquipmentType): Interior | undefined {
  switch (type) {
    case 'tank':
      return { top: 14, bottom: 80, span: (y) => (y >= 14 && y <= 80 ? [0, 64] : undefined) };
    case 'vessel':
      return capsuleInterior(50, 90);
    case 'drum':
      return capsuleInterior(100, 46);
    case 'column':
      return capsuleInterior(40, 150);
    case 'reactor':
      return capsuleInterior(64, 96);
    default:
      return undefined;
  }
}
