import type { DiagramPlugin } from '@mermaid-js/core';
import { layoutPid, type PidLayout } from './layout.js';
import type { PidModel } from './model.js';
import { detectPid, parsePid } from './parser.js';
import { renderPid } from './render.js';

/** The P&ID diagram plugin for Mermaid v13: `mermaid.registerExternalDiagrams([pid])`. */
export const pid: DiagramPlugin<PidModel, PidLayout> = {
  id: 'pid',
  formats: ['svg'],
  // `pid.imageBase`: prefixed to relative image paths (`image HP-1 heat-pump.png`); a Home
  // Assistant card sets `/local/`, where config/www is served.
  configDefaults: { imageBase: '' },
  layoutKind: 'graph',
  detector: (text) => detectPid(text),
  parse: (text, ctx) => parsePid(text, ctx),
  labels: (model) => [
    ...model.equipment.flatMap((e) => (e.name ? [e.id, e.name] : [e.id])),
    ...model.streams.flatMap((s) => (s.label ? [s.label] : [])),
  ],
  // Icon packs load only for diagrams that name them (`icon TT-1 mdi:thermometer`).
  icons: (model) => [...new Set(model.equipment.flatMap((e) => (e.icon ? [e.icon.name] : [])))],
  layout: (model, ctx) => layoutPid(model, ctx),
  render: (model, layout, ctx, w) => renderPid(model, layout, ctx, w),
};
