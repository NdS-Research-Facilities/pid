import type { DiagramParseContext } from '@mermaid-js/core';
import type { AstNode, Diagnostic, ParseResult } from '@mermaid-js/core/parser-kit';
import type { Dir } from '@mermaid-js/core/layout';
import {
  EQUIPMENT_TYPES,
  INSTRUMENT_LOCATIONS,
  type Equipment,
  type EquipmentType,
  type InstrumentLocation,
  type LineKind,
  type PidModel,
  type Port,
  type StreamProperty,
} from './model.js';
import { parseState } from './state.js';

const HEADER = /^pid(?:\s+(LR|RL|TB|TD|BT))?\s*$/;
const TITLE = /^title\s+(.+)$/;
/** `TAG: type [location] ["Name"] [= state]` */
const EQUIPMENT = /^([A-Za-z][\w.-]*)\s*:\s*([A-Za-z][A-Za-z0-9]*)(?:\s+([A-Za-z]+))?(?:\s+"([^"]*)")?(?:\s*=\s*(.*))?$/;
/** `TAG = value`: a state line, kept apart from the drawing so templates touch only these. */
const STATE = /^([A-Za-z][\w.-]*)\s*=\s*(.*)$/;
const STREAM_PROPS = /^stream\s+("[^"]*"|[^\s{]+)\s*\{(.*)\}$/;
const ID = /^[A-Za-z][\w.-]*$/;
/** A line operator with an optional `|label|` straight after it. */
const LINK = /\s*(-->|---|-\.->|-\.-)(?:\|([^|]*)\|)?\s*/;
const LINK_KIND: Record<string, [LineKind, boolean]> = {
  '-->': ['process', true],
  '---': ['connection', false],
  '-.->': ['signal', true],
  '-.-': ['signal', false],
};

/** True when the diagram text (front matter and comments removed) starts with `pid`. */
export function detectPid(text: string): boolean {
  return /^\s*pid\b/.test(text);
}

export function parsePid(text: string, ctx?: Pick<DiagramParseContext, 'preprocessed'>): ParseResult<PidModel> {
  const model: PidModel = { direction: 'LR', equipment: [], streams: [], properties: new Map() };
  const diagnostics: Diagnostic[] = [];
  const children: AstNode[] = [];
  const byId = new Map<string, Equipment>();
  const error = (message: string, start: number, end: number) =>
    diagnostics.push({ severity: 'error', code: 'PID_SYNTAX', message, range: { start, end } });

  const touch = (id: string, start: number, end: number): Equipment => {
    let eq = byId.get(id);
    if (!eq) {
      eq = { id, type: 'block', ast: `node-${id}` };
      byId.set(id, eq);
      model.equipment.push(eq);
      children.push({ id: eq.ast, type: 'equipment', range: { start, end } });
    }
    return eq;
  };

  const ranges: { start: number; end: number }[] = [];
  let offset = ctx?.preprocessed.bodyStart ?? 0;
  let sawHeader = false;
  for (const raw of text.slice(offset).split('\n')) {
    const lineStart = offset;
    offset += raw.length + 1;
    const lead = raw.length - raw.trimStart().length;
    const line = raw.trim();
    if (!line || line.startsWith('%%')) continue;
    const start = lineStart + lead;
    const end = start + line.length;

    if (!sawHeader) {
      const m = HEADER.exec(line);
      if (!m) {
        error('Expected "pid" followed by an optional direction (LR, RL, TB, BT)', start, end);
        break;
      }
      model.direction = (m[1] === 'TD' ? 'TB' : (m[1] ?? 'LR')) as Dir;
      sawHeader = true;
      continue;
    }

    let m: RegExpExecArray | null;
    if ((m = TITLE.exec(line))) {
      model.title = decodeEntities(m[1]!.trim());
    } else if ((m = STREAM_PROPS.exec(line))) {
      model.properties.set(decodeEntities(unquote(m[1]!)), parseProperties(m[2]!));
    } else if ((m = STATE.exec(line))) {
      touch(m[1]!, start, end).state = parseState(decodeEntities(m[2]!));
    } else if (LINK.test(line)) {
      // split with two capture groups: [id, op, label, id, op, label, id, ...]
      const parts = line.split(LINK);
      const ids = parts.filter((_, i) => i % 3 === 0).map((s) => s.trim());
      if (ids.some((id) => !ID.test(id))) {
        error('Expected tags around a line, e.g. "P-101 -->|2| E-101" or "TT-101 -.-> TIC-101"', start, end);
        continue;
      }
      for (let i = 0; i + 1 < ids.length; i++) {
        const [kind, arrow] = LINK_KIND[parts[3 * i + 1]!]!;
        const label = parts[3 * i + 2]?.trim() ? decodeEntities(parts[3 * i + 2]!.trim()) : undefined;
        const id = `s${model.streams.length}`;
        // Endpoints are resolved after every declaration is read: `V-1.C` is a port only when
        // `V-1` is a 3-way valve, declared before or after the stream.
        model.streams.push({ id, kind, arrow, source: ids[i]!, target: ids[i + 1]!, label, ast: `edge-${id}` });
        children.push({ id: `edge-${id}`, type: 'stream', range: { start, end } });
        ranges.push({ start, end });
      }
    } else if ((m = EQUIPMENT.exec(line))) {
      const [, id, type, location, name, state] = m;
      const known = (EQUIPMENT_TYPES as readonly string[]).includes(type!.toLowerCase());
      if (!known) error(`Unknown equipment type "${type}". Known: ${EQUIPMENT_TYPES.join(', ')}`, start, end);
      const eq = touch(id!, start, end);
      eq.type = known ? (type!.toLowerCase() as EquipmentType) : 'block';
      if (location !== undefined) {
        const loc = location.toLowerCase();
        if (eq.type !== 'instrument') error(`Only instruments take a location; "${location}" on a ${eq.type}`, start, end);
        else if (!(INSTRUMENT_LOCATIONS as readonly string[]).includes(loc))
          error(`Unknown instrument location "${location}". Known: ${INSTRUMENT_LOCATIONS.join(', ')}`, start, end);
        else eq.location = loc as InstrumentLocation;
      }
      if (name !== undefined) eq.name = decodeEntities(name);
      if (state !== undefined) eq.state = parseState(decodeEntities(state));
    } else {
      error(`Cannot read "${line}"`, start, end);
    }
  }
  if (!sawHeader && diagnostics.length === 0) error('Expected "pid"', 0, text.length);

  model.streams.forEach((s, i) => {
    const { start, end } = ranges[i]!;
    const resolve = (ref: string): [string, Port | undefined] => {
      const m = /^(.+)\.([ABC])$/.exec(ref);
      if (m && byId.get(m[1]!)?.type === 'valve3') return [m[1]!, m[2] as Port];
      return [touch(ref, start, end).id, undefined];
    };
    [s.source, s.sourcePort] = resolve(s.source);
    [s.target, s.targetPort] = resolve(s.target);
    const target = byId.get(s.target);
    if (s.kind === 'signal' && target?.type === 'valve') target.actuated = true;
  });

  const ast: AstNode = { id: 'root', type: 'pid', range: { start: 0, end: text.length }, children };
  return { model, ast, diagnostics, symbols: [], statements: [] };
}

const NAMED: Record<string, string> = { quot: '"', amp: '&', lt: '<', gt: '>', nbsp: '\u00a0', apos: "'" };

/**
 * Decodes Mermaid entity codes (`#40;`, `#quot;`), which Home Assistant cards use to mask
 * characters in entity values that would otherwise read as syntax.
 */
export function decodeEntities(s: string): string {
  return s.replace(/#(\d+|[a-z]+);/gi, (m, code: string) =>
    /^\d+$/.test(code) ? String.fromCodePoint(Number(code)) : (NAMED[code.toLowerCase()] ?? m),
  );
}

function unquote(s: string): string {
  return s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s;
}

function parseProperties(body: string): StreamProperty[] {
  return body
    .split(/[,;]/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const i = p.indexOf(':');
      const [key, value] = i < 0 ? ['', p] : [p.slice(0, i).trim(), p.slice(i + 1).trim()];
      return { key: decodeEntities(key), value: decodeEntities(value) };
    });
}

