import type { EquipmentType } from './model.js';

export interface SymbolPart {
  tag: 'path' | 'circle' | 'rect';
  attrs: Record<string, string | number>;
  /** Filled with the node background (true) or drawn as a bare line (false). */
  fill: boolean;
}

export interface SymbolDef {
  width: number;
  height: number;
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
 * Simplified PFD symbols, loosely after ISO 10628 / ISA 5.1. Sizes are in px; the layout adds
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
    parts: [{ tag: 'circle', attrs: { cx: 24, cy: 24, r: 22 }, fill: true }, line('M24 2 H46 M8 40 L2 48 H46 L40 40')],
  },
  compressor: { width: 60, height: 48, parts: [shape('M0 0 L60 12 V36 L0 48 Z')] },
  exchanger: {
    width: 56,
    height: 56,
    parts: [{ tag: 'circle', attrs: { cx: 28, cy: 28, r: 26 }, fill: true }, line('M2 28 L12 28 L18 14 L28 42 L38 14 L44 28 L54 28')],
  },
  valve: { width: 30, height: 20, parts: [shape('M0 0 L30 20 V0 L0 20 Z')] },
  feed: { width: 70, height: 30, parts: [shape('M0 0 H55 L70 15 L55 30 H0 Z')] },
  product: { width: 70, height: 30, parts: [shape('M0 0 H55 L70 15 L55 30 H0 Z')] },
};
