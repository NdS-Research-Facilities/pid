import type { Dir } from '@mermaid-js/core/layout';

/** The equipment kinds a PFD knows how to draw. Anything else falls back to `block`. */
export const EQUIPMENT_TYPES = [
  'block', 'tank', 'vessel', 'drum', 'column', 'reactor', 'pump', 'compressor',
  'exchanger', 'valve', 'feed', 'product',
] as const;
export type EquipmentType = (typeof EQUIPMENT_TYPES)[number];

export interface Equipment {
  /** The equipment tag, e.g. `P-101`. */
  id: string;
  type: EquipmentType;
  /** Descriptive name, e.g. `Feed pump`. */
  name?: string;
  ast: string;
}

export interface StreamProperty {
  key: string;
  value: string;
}

/** One connection between two pieces of equipment. */
export interface Stream {
  id: string;
  source: string;
  target: string;
  /** The stream tag shown on the line, e.g. `1`. */
  label?: string;
  ast: string;
}

export interface PfdModel {
  direction: Dir;
  title?: string;
  /** Declaration order; equipment referenced only by a stream is added as a `block`. */
  equipment: Equipment[];
  streams: Stream[];
  /** Stream tag → its property table (`stream 1 { T: 25 °C, F: 1200 kg/h }`). */
  properties: Map<string, StreamProperty[]>;
}
