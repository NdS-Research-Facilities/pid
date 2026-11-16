import type { DiagramParseContext } from '@mermaid-js/core';
import type { AstNode, Diagnostic, ParseResult } from '@mermaid-js/core/parser-kit';
import type { Dir } from '@mermaid-js/core/layout';
import {
  EQUIPMENT_TYPES,
  INSTRUMENT_LOCATIONS,
  VALVE_KINDS,
  BORES,
  type Bore,
  type Equipment,
  type EquipmentType,
  type InstrumentLocation,
  type LineKind,
  type PidModel,
  type Port,
  type GradientStop,
  type Level,
  type StreamProperty,
  type ValveKind,
} from './model.js';
import { parseState } from './state.js';

const HEADER = /^pid(?:\s+(LR|RL|TB|TD|BT))?\s*$/;
const TITLE = /^title\s+(.+)$/;
/** `TAG: type [variant] ["Name"] [= state]`; the variant is an instrument's location or a valve's kind. */
const EQUIPMENT = /^([A-Za-z][\w.-]*)\s*:\s*([A-Za-z][A-Za-z0-9]*)(?:\s+([A-Za-z]+))?(?:\s+"([^"]*)")?(?:\s*=\s*(.*))?$/;
/** `TAG = value`: a state line, kept apart from the drawing so templates touch only these. */
const STATE = /^([A-Za-z][\w.-]*)\s*=\s*(.*)$/;
const CLASSDEF = /^classDef\s+([\w-]+(?:\s*,\s*[\w-]+)*)\s+(.+)$/;
const CLASS = /^class\s+([A-Za-z][\w.-]*(?:\s*,\s*[A-Za-z][\w.-]*)*)\s+([\w-]+)$/;
const STYLE = /^style\s+([A-Za-z][\w.-]*)\s+(.+)$/;
const IMAGE = /^image\s+([A-Za-z][\w.-]*)\s+(\S+)(?:\s+(\d+)(?:x(\d+))?)?$/;
const ICON = /^icon\s+([A-Za-z][\w.-]*)\s+([a-z0-9-]+:[a-z0-9-]+)(?:\s+(\d+))?$/i;
/** Default and largest size of a custom image or icon, px. */
const IMAGE_SIZE = 48;
const IMAGE_MAX = 240;
const LINK_STYLE = /^linkStyle\s+(default|\d+(?:\s*,\s*\d+)*)\s+(.+)$/;
/** `pipe <stream tag | A>B> <line number>`: the rest of the line is the number, quotes included. */
const PIPE = /^pipe\s+(\S+)\s+(.+)$/;
const GRADIENT = /^gradient\s+([A-Za-z][\w.-]*)\s+(.+)$/;
const GRADIENT_RANGE = /^gradient-range(?:\s+([A-Za-z][\w.-]*))?\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)$/;
const GRADIENT_MARKS = /^gradient-marks\s+(on|off)$/;
const LEVEL = /^level\s+([A-Za-z][\w.-]*)\s+(.+)$/;
/** A colour as a value: `#hex`, `rgb(…)`, `hsl(…)`; checked again when drawn. */
const COLOUR = /^(#[0-9a-f]{3,8}|(?:rgb|rgba|hsl|hsla)\([^)]*\))$/i;
const NUMBER = /^-?\d+(?:[.,]\d+)?/;
/** Equipment that can show a gradient or level. */
export const FILLABLE = new Set(['tank', 'vessel', 'drum', 'column', 'reactor']);
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
  const model: PidModel = {
    direction: 'LR',
    equipment: [],
    streams: [],
    properties: new Map(),
    classDefs: new Map(),
    gradientRange: [20, 70],
    gradientMarks: true,
  };
  const fills: { id: string; start: number; end: number }[] = [];
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
  // linkStyle and pipe can name lines declared after them: applied once every line is read.
  const linkStyles: { refs: string; decls: string[]; start: number; end: number }[] = [];
  const pipes: { ref: string; number: string; start: number; end: number }[] = [];
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
    const size = (v: string | undefined, fallback: number) => Math.min(IMAGE_MAX, Math.max(8, v ? Number(v) : fallback));
    if ((m = GRADIENT_RANGE.exec(line))) {
      const range: [number, number] = [Number(m[2]), Number(m[3])];
      if (range[0] === range[1]) error('gradient-range needs two different numbers', start, end);
      else if (m[1]) touch(m[1], start, end).gradientRange = range;
      else model.gradientRange = range;
      continue;
    } else if ((m = GRADIENT_MARKS.exec(line))) {
      model.gradientMarks = m[1] === 'on';
      continue;
    } else if ((m = GRADIENT.exec(line))) {
      touch(m[1]!, start, end).gradient = parseStops(decodeEntities(m[2]!));
      fills.push({ id: m[1]!, start, end });
      continue;
    } else if ((m = LEVEL.exec(line))) {
      touch(m[1]!, start, end).level = parseLevel(decodeEntities(m[2]!));
      fills.push({ id: m[1]!, start, end });
      continue;
    } else if ((m = LINK_STYLE.exec(line))) {
      linkStyles.push({ refs: m[1]!, decls: declarations(m[2]!), start, end });
      continue;
    } else if ((m = PIPE.exec(line))) {
      pipes.push({ ref: decodeEntities(m[1]!), number: decodeEntities(m[2]!.trim()), start, end });
      continue;
    } else if ((m = CLASSDEF.exec(line))) {
      for (const name of m[1]!.split(',')) model.classDefs.set(name.trim(), declarations(m[2]!));
      continue;
    } else if ((m = CLASS.exec(line))) {
      for (const id of m[1]!.split(',')) (touch(id.trim(), start, end).classes ??= []).push(m[2]!);
      continue;
    } else if ((m = STYLE.exec(line))) {
      const eq = touch(m[1]!, start, end);
      eq.style = [...(eq.style ?? []), ...declarations(m[2]!)];
      continue;
    } else if ((m = IMAGE.exec(line))) {
      const width = size(m[3], IMAGE_SIZE);
      touch(m[1]!, start, end).image = { url: m[2]!, width, height: size(m[4], width) };
      continue;
    } else if ((m = ICON.exec(line))) {
      touch(m[1]!, start, end).icon = { name: m[2]!.toLowerCase(), size: size(m[3], IMAGE_SIZE) };
      continue;
    }
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
      const [, id, type, variant, name, state] = m;
      const known = (EQUIPMENT_TYPES as readonly string[]).includes(type!.toLowerCase());
      if (!known) error(`Unknown equipment type "${type}". Known: ${EQUIPMENT_TYPES.join(', ')}`, start, end);
      const eq = touch(id!, start, end);
      eq.type = known ? (type!.toLowerCase() as EquipmentType) : 'block';
      if (variant !== undefined) {
        const v = variant.toLowerCase();
        if (eq.type === 'instrument') {
          if ((INSTRUMENT_LOCATIONS as readonly string[]).includes(v)) eq.location = v as InstrumentLocation;
          else error(`Unknown instrument location "${variant}". Known: ${INSTRUMENT_LOCATIONS.join(', ')}`, start, end);
        } else if (eq.type === 'valve') {
          if ((VALVE_KINDS as readonly string[]).includes(v)) eq.valveKind = v as ValveKind;
          else error(`Unknown valve kind "${variant}". Known: ${VALVE_KINDS.join(', ')}`, start, end);
        } else if (eq.type === 'valve3') {
          const bore = variant.toUpperCase();
          if ((BORES as readonly string[]).includes(bore)) eq.bore = bore as Bore;
          else error(`Unknown 3-way valve port "${variant}". Known: L, T`, start, end);
        } else {
          error(`Only instruments (location), valves (kind) and 3-way valves (L or T) take a variant; "${variant}" on a ${eq.type}`, start, end);
        }
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
    if (s.kind === 'signal' && target?.type === 'valve' && target.valveKind !== 'relief') target.actuated = true;
  });

  for (const f of fills) {
    const eq = byId.get(f.id)!;
    if (!FILLABLE.has(eq.type))
      error(`${f.id} is a ${eq.type}: gradient and level work on ${[...FILLABLE].join(', ')}`, f.start, f.end);
  }
  for (const ls of linkStyles) {
    if (ls.refs === 'default') {
      model.linkStyleDefault = [...(model.linkStyleDefault ?? []), ...ls.decls];
      continue;
    }
    for (const i of ls.refs.split(',').map(Number)) {
      const s = model.streams[i];
      if (s) s.style = [...(s.style ?? []), ...ls.decls];
      else error(`linkStyle ${i}: there are ${model.streams.length} lines, numbered from 0`, ls.start, ls.end);
    }
  }
  for (const p of pipes) {
    const ends = /^(.+)>(.+)$/.exec(p.ref);
    const matches = model.streams.filter((s) =>
      ends ? s.source === ends[1] && s.target === ends[2] : s.label === p.ref,
    );
    if (!matches.length) error(`pipe ${p.ref}: no line with stream tag "${p.ref}" or ends "A>B"`, p.start, p.end);
    for (const s of matches) s.lineNumber = p.number;
  }

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

/** A reading's number, if it starts with one (`62 °C`, `48,5`); else undefined (`unavailable`). */
function leadingNumber(text: string): number | undefined {
  const m = NUMBER.exec(text.trim());
  return m ? Number(m[0].replace(',', '.')) : undefined;
}

/**
 * `62 °C, 48 °C @50%, #1565c0`: top to bottom. A stop is a reading or a colour, optionally at a
 * height from the bottom (`@25%`); stops without one are spread evenly from top to bottom.
 */
export function parseStops(text: string): GradientStop[] {
  const parts = declarations(text);
  return parts.map((part, i) => {
    const at = /^(.*?)\s*@\s*(\d+(?:\.\d+)?)\s*%$/.exec(part);
    const raw = (at ? at[1]! : part).trim();
    const height = at ? Math.min(1, Math.max(0, Number(at[2]) / 100)) : parts.length === 1 ? 0.5 : 1 - i / (parts.length - 1);
    if (COLOUR.test(raw)) return { raw, color: raw, height };
    const value = leadingNumber(raw);
    return value === undefined ? { raw, height } : { raw, value, height };
  });
}

/** `73 %`, `73`, `73% #ffcc80`, `unavailable`. */
export function parseLevel(text: string): Level {
  const parts = text.trim().split(/\s+/);
  const color = parts.length > 1 && COLOUR.test(parts[parts.length - 1]!) ? parts.pop() : undefined;
  const raw = parts.join(' ');
  const value = leadingNumber(raw);
  return {
    raw,
    ...(value === undefined ? {} : { percent: Math.min(100, Math.max(0, value)) }),
    ...(color ? { color } : {}),
  };
}

/** Splits `fill:#f9f,stroke:rgb(1,2,3)` at the commas outside parentheses; drops a trailing `;`. */
export function declarations(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of text.trim().replace(/;$/, '')) {
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.filter(Boolean);
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

