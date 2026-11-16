import type { DiagramPlugin } from '@mermaid-js/core';
import { layoutPfd, type PfdLayout } from './layout.js';
import type { PfdModel } from './model.js';
import { detectPfd, parsePfd } from './parser.js';
import { renderPfd } from './render.js';

/** The PFD diagram plugin for Mermaid v13: `mermaid.registerExternalDiagrams([pfd])`. */
export const pfd: DiagramPlugin<PfdModel, PfdLayout> = {
  id: 'pfd',
  formats: ['svg'],
  layoutKind: 'graph',
  detector: (text) => detectPfd(text),
  parse: (text, ctx) => parsePfd(text, ctx),
  labels: (model) => [
    ...model.equipment.flatMap((e) => (e.name ? [e.id, e.name] : [e.id])),
    ...model.streams.flatMap((s) => (s.label ? [s.label] : [])),
  ],
  layout: (model, ctx) => layoutPfd(model, ctx),
  render: (model, layout, ctx, w) => renderPfd(model, layout, ctx, w),
};
