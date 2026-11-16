import type { Dir } from '@mermaid-js/core/layout';

/** The equipment kinds a P&ID knows how to draw. Anything else falls back to `block`. */
export const EQUIPMENT_TYPES = [
  'block', 'tank', 'vessel', 'drum', 'column', 'reactor', 'pump', 'compressor',
  'exchanger', 'valve', 'valve3', 'feed', 'product', 'instrument',
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
  /** A valve a signal line drives: drawn as a control valve with an actuator on top. */
  actuated?: boolean;
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
}
