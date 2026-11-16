import type { Equipment, EquipmentType, InstrumentLocation, Port } from './model.js';

export interface SymbolPart {
  tag: 'path' | 'circle' | 'rect';
  attrs: Record<string, string | number>;
  /** Filled with the node background (true) or drawn as a bare line (false). */
  fill: boolean;
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
  valve3: {
    width: 36,
    height: 44,
    turns: true,
    parts: [
      { ...shape('M0 10 L18 22 L0 34 Z'), port: 'A' },
      { ...shape('M36 10 L18 22 L36 34 Z'), port: 'B' },
      { ...shape('M18 22 L6 44 H30 Z'), port: 'C' },
    ],
  },
  instrument: { width: 42, height: 42, parts: [{ tag: 'circle', attrs: { cx: 21, cy: 21, r: 20 }, fill: true }] },
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

/**
 * A control valve: the valve body with a stem and a diaphragm actuator above it. The space below
 * the body mirrors the actuator, so the body stays at the symbol's centre on the process line.
 */
const ACTUATED_VALVE: SymbolDef = {
  width: 36,
  height: 68,
  turns: true,
  parts: [
    shape('M0 22 L36 46 V22 L0 46 Z'),
    line('M18 34 V12'),
    line('M6 12 A12 11 0 0 1 30 12 Z'),
  ],
};

/** The symbol drawn for `eq`. */
export function symbolFor(eq: Pick<Equipment, 'type' | 'location' | 'actuated'>): SymbolDef {
  if (eq.type === 'instrument') return INSTRUMENTS[eq.location ?? 'field'];
  if (eq.type === 'valve' && eq.actuated) return ACTUATED_VALVE;
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
