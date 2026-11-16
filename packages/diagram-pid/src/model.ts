import type { Dir } from '@mermaid-js/core/layout';

/** The equipment kinds a P&ID knows how to draw. Anything else falls back to `block`. */
export const EQUIPMENT_TYPES = [
  'block', 'tank', 'vessel', 'drum', 'column', 'reactor', 'pump', 'compressor',
  'exchanger', 'valve', 'valve3', 'feed', 'product', 'instrument', 'tee',
] as const;
export type EquipmentType = (typeof EQUIPMENT_TYPES)[number];

/**
 * Where an instrument's function is, after ISA-5.1: `field` (a bare circle), `panel` (main control
 * panel, a line through the circle), `dcs` (shared display / control, circle in a square), `plc`
 * (programmable logic, diamond in a square), `computer` (hexagon).
 */
export const INSTRUMENT_LOCATIONS = ['field', 'panel', 'dcs', 'plc', 'computer'] as const;
export type InstrumentLocation = (typeof INSTRUMENT_LOCATIONS)[number];

/**
 * Valve kinds: `gate` (the plain bowtie, default), `globe`, `ball`, `plug`, `butterfly`,
 * `check` (non-return) and `relief` (an angle valve with a spring, discharging sideways).
 */
export const VALVE_KINDS = ['gate', 'globe', 'ball', 'plug', 'butterfly', 'check', 'relief'] as const;
export type ValveKind = (typeof VALVE_KINDS)[number];

export const BORES = ['L', 'T'] as const;
export type Bore = (typeof BORES)[number];

/**
 * Ports of a 3-way valve: `A` the inlet side, `B` the straight-through outlet, `C` the branch
 * (the stem of the T).
 */
export type Port = 'A' | 'B' | 'C';
export const PORTS: readonly Port[] = ['A', 'B', 'C'];

/**
 * Live equipment state, e.g. from Home Assistant: `V-101 = 45%`, `V-101 = closed`,
 * `V-102 = AC` (3-way valve with A and C connected).
 */
export interface EquipmentState {
  /** The value as written, trimmed. */
  raw: string;
  kind: 'position' | 'ports' | 'opening' | 'closing' | 'on' | 'off' | 'unknown' | 'text';
  /** 0 (closed) … 100 (fully open), for `position`. */
  position?: number;
  /** The connected ports, for `ports`; empty when closed. */
  open?: ReadonlySet<Port>;
}

export interface Equipment {
  /** The equipment tag, e.g. `P-101`. */
  id: string;
  type: EquipmentType;
  /** Descriptive name, e.g. `Feed pump`. */
  name?: string;
  state?: EquipmentState;
  /** Instruments only. */
  location?: InstrumentLocation;
  /** Valves only; `gate` when absent. */
  valveKind?: ValveKind;
  /**
   * 3-way valves only: the ball's bore. An `L` port joins the branch C to A or to B; a `T` port
   * also joins A to B, or all three. Absent: any combination is accepted and no bore is drawn.
   */
  bore?: Bore;
  /** A valve a signal line drives: drawn as a control valve with an actuator on top. */
  actuated?: boolean;
  /** `class TAG name`: classDef names applied in order, then `style` declarations on top. */
  classes?: string[];
  /** `style TAG fill:#fdd,stroke:#c00`: declarations as written. */
  style?: string[];
  /** `image TAG url [WxH]`: a picture drawn in place of the symbol. */
  image?: { url: string; width: number; height: number };
  /** `icon TAG pack:name [size]`: an Iconify icon (e.g. `mdi:thermometer`) in place of the symbol. */
  icon?: { name: string; size: number };
  /** `gradient TAG 62 °C, 48 °C, 31 °C`: the contents coloured from top to bottom. */
  gradient?: GradientStop[];
  /** `gradient-range TAG 20 70`: this vessel's colour scale, over the diagram's. */
  gradientRange?: [number, number];
  /** `level TAG 73 %`: the liquid level, filled from the bottom. */
  level?: Level;
  ast: string;
}

export interface StreamProperty {
  key: string;
  value: string;
}

/**
 * What a line carries: `process` piping (`-->`), an instrument's `connection` to the process
 * (`---`, a thin solid line), or an electrical `signal` (`-.->`, `-.-`, dashed).
 */
export type LineKind = 'process' | 'connection' | 'signal';

/** One point of a vessel's colour gradient: a reading on the colour scale, or a colour. */
export interface GradientStop {
  /** As written, for its mark: `62 °C`. */
  raw: string;
  /** The reading, when the stop starts with a number. */
  value?: number;
  /** A colour given instead of a reading (`#c62828`), checked when drawn. */
  color?: string;
  /** Height from the bottom, 0 … 1: `@25%`, else spread evenly from top to bottom. */
  height: number;
}

export interface Level {
  raw: string;
  /** 0 … 100; absent when the level is unknown (`unavailable`). */
  percent?: number;
  /** The liquid's colour without a gradient. */
  color?: string;
}

/** One line between two pieces of equipment or instruments, optionally at a port (`V-1.C`). */
export interface Stream {
  id: string;
  kind: LineKind;
  /** Drawn with an arrowhead at the target. */
  arrow: boolean;
  source: string;
  target: string;
  sourcePort?: Port;
  targetPort?: Port;
  /** The stream tag shown on the line, e.g. `1`. */
  label?: string;
  /** `pipe 1 2"-CW-101-A1`: the line number written along the pipe. */
  lineNumber?: string;
  /** `linkStyle 3 stroke:#c00`: style declarations as written. */
  style?: string[];
  ast: string;
}

export interface PidModel {
  direction: Dir;
  title?: string;
  /** Declaration order; equipment referenced only by a stream is added as a `block`. */
  equipment: Equipment[];
  streams: Stream[];
  /** Stream tag → its property table (`stream 1 { T: 25 °C, F: 1200 kg/h }`). */
  properties: Map<string, StreamProperty[]>;
  /** `classDef name decl,decl`: style declarations by class name. */
  classDefs: Map<string, string[]>;
  /** `linkStyle default decl,decl`: applied to every line before its own `linkStyle`. */
  linkStyleDefault?: string[];
  /** `gradient-range 20 70`: readings at or below the first are coldest, at or above the second hottest. */
  gradientRange: [number, number];
  /** `gradient-marks off` hides the readings drawn inside vessels. */
  gradientMarks: boolean;
}
