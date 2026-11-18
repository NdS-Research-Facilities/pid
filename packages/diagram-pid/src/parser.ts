import type { DiagramParseContext } from '@mermaid-js/core';
import type { AstNode, Diagnostic, ParseResult } from '@mermaid-js/core/parser-kit';
import type { Dir } from '@mermaid-js/core/layout';
import {
  EQUIPMENT_TYPES,
  INSTRUMENT_LOCATIONS,
  VALVE_KINDS,
  BORES,
  type ActuatorKind,
  type Bore,
  type Equipment,
  type EquipmentType,
  type InstrumentLocation,
  type LineKind,
  type PidModel,
  type Port,
  type GradientStop,
  type NozzleSide,
  type Level,
  type StreamProperty,
  type ValveKind,
} from './model.js';
import { parseState } from './state.js';

const HEADER = /^pid(?:\s+(LR|RL|TB|TD|BT))?\s*$/;
const TITLE = /^title\s+(.+)$/;
/** `TAG: type [variant] ["Name"] [= state]`; the variant is an instrument's location or a valve's kind. */
const EQUIPMENT = /^([A-Za-z][\w.-]*)\s*:\s*([A-Za-z][A-Za-z0-9]*)(?:\s+([A-Za-z]+))?(?:\s+"([^"]*)")?(?:\s*=(?![=>])\s*(.*))?$/;
/** `TAG = value`: a state line, kept apart from the drawing so templates touch only these. */
// The `=` must not start `==>` / `===`, which are power cables, not states.
const STATE = /^([A-Za-z][\w.-]*)\s*=(?![=>])\s*(.*)$/;
const CLASSDEF = /^classDef\s+([\w-]+(?:\s*,\s*[\w-]+)*)\s+(.+)$/;
// The class may be anything here: an unfilled template (`${if(…)}` outside Home Assistant) is
// ignored rather than an error, as linkStyle drops values it cannot use.
const CLASS = /^class\s+([A-Za-z][\w.-]*(?:\s*,\s*[A-Za-z][\w.-]*)*)\s+(.+)$/;
const CLASS_NAME = /^[\w-]+$/;
const STYLE = /^style\s+([A-Za-z][\w.-]*)\s+(.+)$/;
const IMAGE = /^image\s+([A-Za-z][\w.-]*)\s+(\S+)(?:\s+(\d+)(?:x(\d+))?)?$/;
const ICON = /^icon\s+([A-Za-z][\w.-]*)\s+([a-z0-9-]+:[a-z0-9-]+)(?:\s+(\d+))?$/i;
/** Default and largest size of a custom image or icon, px. */
const IMAGE_SIZE = 48;
const IMAGE_MAX = 240;
const LINK_STYLE = /^linkStyle\s+(default|[\w-]+(?:\s*,\s*[\w-]+)*)\s+(.+)$/;
/** `pipe <stream tag | A>B> <line number>`: the rest of the line is the number, quotes included. */
const PIPE = /^pipe\s+(\S+)\s+(.+)$/;
const GRADIENT = /^gradient\s+([A-Za-z][\w.-]*)\s+(.+)$/;
const GRADIENT_RANGE = /^gradient-range(?:\s+([A-Za-z][\w.-]*))?\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)$/;
const GRADIENT_MARKS = /^gradient-marks\s+(on|off)$/;
const ACTUATOR = /^actuator\s+([A-Za-z][\w.-]*)\s+(motor|diaphragm)$/;
/** `nozzle TAG id left|right|top|bottom ["Description"]` */
const NOZZLE = /^nozzle\s+([A-Za-z][\w.-]*)\s+([A-Za-z][\w-]*)\s+(left|right|top|bottom)(?:\s+"([^"]*)")?$/;
/** Equipment that has its own connection points, so takes no nozzles. */
const NO_NOZZLES = new Set(['tee', 'valve', 'valve3']);
const SIZE = /^size\s+([A-Za-z][\w.-]*)\s+(\d+(?:\.\d+)?)$/;
/** `coil TAG top|middle|bottom|@NN% [inlet wall [outlet wall]] ["Name"]` */
const COIL = /^coil\s+([A-Za-z][\w.-]*)\s+(top|middle|bottom|@\s*\d+(?:\.\d+)?\s*%)(?:\s+(left|right))?(?:\s+(left|right))?(?:\s+"([^"]*)")?$/;
const COIL_AT: Record<string, number> = { top: 0.8, middle: 0.5, bottom: 0.2 };
/** Equipment a coil can go in. */
export const COILABLE = new Set(['tank', 'vessel', 'drum', 'column', 'reactor']);
const LEVEL = /^level\s+([A-Za-z][\w.-]*)\s+(.+)$/;
/** A colour as a value: `#hex`, `rgb(…)`, `hsl(…)`; checked again when drawn. */
const COLOUR = /^(#[0-9a-f]{3,8}|(?:rgb|rgba|hsl|hsla)\([^)]*\))$/i;
const NUMBER = /^-?\d+(?:[.,]\d+)?/;
/** Equipment that can show a gradient or level. */
export const FILLABLE = new Set(['tank', 'vessel', 'drum', 'column', 'reactor', 'battery', 'collector']);
const STREAM_PROPS = /^stream\s+("[^"]*"|[^\s{]+)\s*\{(.*)\}$/;
const ID = /^[A-Za-z][\w.-]*$/;
/** A line operator with an optional `|label|` straight after it. */
/** A line operator, optionally named (`f1@-->`, as in Mermaid flowcharts), with an optional `|label|`. */
const LINK = /(?:\s+([A-Za-z][\w-]*)@|\s*)(-->|---|-\.->|-\.-|==>|===)(?:\|([^|]*)\|)?\s*/;
const LINK_KIND: Record<string, [LineKind, boolean]> = {
  '-->': ['process', true],
  '---': ['connection', false],
  '-.->': ['signal', true],
  '-.-': ['signal', false],
  '==>': ['electric', true],
  '===': ['electric', false],
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
  const coilLines: { id: string; start: number; end: number }[] = [];
  // `class` and `style` statements, in order: they can name lines written further down.
  const styling: { id: string; cls?: string; decls?: string[]; start: number; end: number }[] = [];
  const actuatorLines: { id: string; start: number; end: number }[] = [];
  const nozzleLines: { id: string; start: number; end: number }[] = [];
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
    } else if ((m = ACTUATOR.exec(line))) {
      const eq = touch(m[1]!, start, end);
      eq.actuator = m[2] as ActuatorKind;
      eq.actuated = true;
      actuatorLines.push({ id: m[1]!, start, end });
      continue;
    } else if ((m = NOZZLE.exec(line))) {
      const eq = touch(m[1]!, start, end);
      if ((eq.nozzles ?? []).some((n) => n.id === m![2])) error(`${m[1]} already has a nozzle "${m[2]}"`, start, end);
      else (eq.nozzles ??= []).push({ id: m[2]!, side: m[3] as NozzleSide, ...(m[4] !== undefined ? { label: decodeEntities(m[4]) } : {}) });
      nozzleLines.push({ id: m[1]!, start, end });
      continue;
    } else if ((m = SIZE.exec(line))) {
      const f = Number(m[2]);
      if (f < 0.5 || f > 3) error(`size ${m[1]} ${m[2]}: use a factor from 0.5 to 3`, start, end);
      else touch(m[1]!, start, end).size = f;
      continue;
    } else if ((m = COIL.exec(line))) {
      const where = m[2]!.replace(/\s/g, '');
      const height = where.startsWith('@') ? Math.min(1, Math.max(0, Number(where.slice(1, -1)) / 100)) : COIL_AT[where]!;
      const eq = touch(m[1]!, start, end);
      (eq.coils ??= []).push({
        height,
        ...(m[3] ? { side: m[3] as 'left' | 'right' } : {}),
        ...(m[4] ? { sideOut: m[4] as 'left' | 'right' } : {}),
        ...(m[5] !== undefined ? { name: decodeEntities(m[5]) } : {}),
      });
      coilLines.push({ id: m[1]!, start, end });
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
      // Resolved once every line is read: a named line takes it, anything else is equipment.
      const cls = m[2]!.trim();
      if (CLASS_NAME.test(cls)) for (const id of m[1]!.split(',')) styling.push({ id: id.trim(), cls, start, end });
      continue;
    } else if ((m = STYLE.exec(line))) {
      styling.push({ id: m[1]!, decls: declarations(m[2]!), start, end });
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
      // split with three capture groups: [id, name, op, label, id, name, op, label, id, ...]
      const parts = line.split(LINK);
      const ids = parts.filter((_, i) => i % 4 === 0).map((s) => s.trim());
      if (ids.some((id) => !ID.test(id))) {
        error('Expected tags around a line, e.g. "P-101 -->|2| E-101" or "TT-101 -.-> TIC-101"', start, end);
        continue;
      }
      for (let i = 0; i + 1 < ids.length; i++) {
        const name = parts[4 * i + 1];
        const [kind, arrow] = LINK_KIND[parts[4 * i + 2]!]!;
        const label = parts[4 * i + 3]?.trim() ? decodeEntities(parts[4 * i + 3]!.trim()) : undefined;
        const id = `s${model.streams.length}`;
        if (name && model.streams.some((o) => o.name === name)) error(`Two lines are named "${name}"`, start, end);
        // Endpoints are resolved after every declaration is read: `V-1.C` is a port only when
        // `V-1` is a 3-way valve, declared before or after the stream.
        model.streams.push({ id, kind, arrow, source: ids[i]!, target: ids[i + 1]!, label, ...(name ? { name } : {}), ast: `edge-${id}` });
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
    const resolve = (ref: string): [string, Port | undefined, number | undefined, string?] => {
      const m = /^(.+)\.([ABC])$/.exec(ref);
      if (m && byId.get(m[1]!)?.type === 'valve3') return [m[1]!, m[2] as Port, undefined];
      const n = /^(.+)\.([A-Za-z][\w-]*)$/.exec(ref);
      if (n && byId.get(n[1]!)?.nozzles && !/^coil\d+$/.test(n[2]!)) {
        if (byId.get(n[1]!)!.nozzles!.some((z) => z.id === n[2])) return [n[1]!, undefined, undefined, n[2]!];
        error(`${n[1]} has no nozzle "${n[2]}"`, start, end);
        return [n[1]!, undefined, undefined];
      }
      const c = /^(.+)\.coil(\d+)$/.exec(ref);
      if (c && byId.get(c[1]!)?.coils) {
        const n = Number(c[2]);
        const coils = byId.get(c[1]!)!.coils!;
        if (n >= 1 && n <= coils.length) return [c[1]!, undefined, n - 1];
        error(`${c[1]} has ${coils.length} coil${coils.length === 1 ? '' : 's'}: there is no coil${n}`, start, end);
        return [c[1]!, undefined, undefined];
      }
      return [touch(ref, start, end).id, undefined, undefined];
    };
    let coil: number | undefined;
    let nozzle: string | undefined;
    [s.source, s.sourcePort, coil, nozzle] = resolve(s.source);
    if (coil !== undefined) s.sourceCoil = coil;
    if (nozzle !== undefined) s.sourceNozzle = nozzle;
    [s.target, s.targetPort, coil, nozzle] = resolve(s.target);
    if (coil !== undefined) s.targetCoil = coil;
    if (nozzle !== undefined) s.targetNozzle = nozzle;
    const target = byId.get(s.target);
    const drivable = target?.type === 'valve3' || (target?.type === 'valve' && target.valveKind !== 'relief');
    if (s.kind === 'signal' && drivable) target!.actuated = true;
  });

  for (const z of nozzleLines) {
    const eq = byId.get(z.id)!;
    if (NO_NOZZLES.has(eq.type)) error(`${z.id} is a ${eq.type}: it has its own connection points, so takes no nozzles`, z.start, z.end);
  }
  for (const a of actuatorLines) {
    const eq = byId.get(a.id)!;
    const ok = eq.type === 'valve3' || (eq.type === 'valve' && eq.valveKind !== 'relief');
    if (!ok) error(`${a.id} is ${eq.type === 'valve' ? 'a relief valve' : `a ${eq.type}`}: actuators go on valves and 3-way valves`, a.start, a.end);
  }
  for (const c of coilLines) {
    const eq = byId.get(c.id)!;
    if (!COILABLE.has(eq.type)) error(`${c.id} is a ${eq.type}: coils go in ${[...COILABLE].join(', ')}`, c.start, c.end);
  }
  for (const f of fills) {
    const eq = byId.get(f.id)!;
    if (!FILLABLE.has(eq.type))
      error(`${f.id} is a ${eq.type}: gradient and level work on ${[...FILLABLE].join(', ')}`, f.start, f.end);
  }
  const named = new Map(model.streams.flatMap((s) => (s.name ? [[s.name, s] as const] : [])));
  for (const [name] of named)
    if (byId.has(name)) error(`"${name}" names both a line and a piece of equipment`, 0, 0);
  for (const st of styling) {
    const line = named.get(st.id);
    if (line) {
      if (st.cls) (line.classes ??= []).push(st.cls);
      if (st.decls) line.style = [...(line.style ?? []), ...st.decls];
      continue;
    }
    const eq = touch(st.id, st.start, st.end);
    if (st.cls) (eq.classes ??= []).push(st.cls);
    if (st.decls) eq.style = [...(eq.style ?? []), ...st.decls];
  }
  for (const ls of linkStyles) {
    if (ls.refs === 'default') {
      model.linkStyleDefault = [...(model.linkStyleDefault ?? []), ...ls.decls];
      continue;
    }
    for (const ref of ls.refs.split(',').map((r) => r.trim())) {
      // A number counts lines from 0 in the order they are written; a name is a line's own.
      const s = /^\d+$/.test(ref) ? model.streams[Number(ref)] : named.get(ref);
      if (s) s.style = [...(s.style ?? []), ...ls.decls];
      else if (/^\d+$/.test(ref)) error(`linkStyle ${ref}: there are ${model.streams.length} lines, numbered from 0`, ls.start, ls.end);
      else error(`linkStyle ${ref}: no line is named "${ref}"`, ls.start, ls.end);
    }
  }
  for (const p of pipes) {
    const ends = /^(.+)>(.+)$/.exec(p.ref);
    const matches = named.has(p.ref)
      ? [named.get(p.ref)!]
      : model.streams.filter((s) => (ends ? s.source === ends[1] && s.target === ends[2] : s.label === p.ref));
    if (!matches.length) error(`pipe ${p.ref}: no line named "${p.ref}", with stream tag "${p.ref}", or with ends "A>B"`, p.start, p.end);
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

