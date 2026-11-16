import type { DiagramParseContext } from '@mermaid-js/core';
import type { AstNode, Diagnostic, ParseResult } from '@mermaid-js/core/parser-kit';
import type { Dir } from '@mermaid-js/core/layout';
import { EQUIPMENT_TYPES, type Equipment, type EquipmentType, type PfdModel, type StreamProperty } from './model.js';

const HEADER = /^pfd(?:\s+(LR|RL|TB|TD|BT))?\s*$/;
const TITLE = /^title\s+(.+)$/;
const EQUIPMENT = /^([A-Za-z][\w.-]*)\s*:\s*([A-Za-z]+)(?:\s+"([^"]*)")?$/;
const STREAM_PROPS = /^stream\s+("[^"]*"|[^\s{]+)\s*\{(.*)\}$/;
const ID = /^[A-Za-z][\w.-]*$/;
/** `-->` with an optional `|label|` straight after it. */
const ARROW = /\s*-->(?:\|([^|]*)\|)?\s*/;

/** True when the diagram text (front matter and comments removed) starts with `pfd`. */
export function detectPfd(text: string): boolean {
  return /^\s*pfd\b/.test(text);
}

export function parsePfd(text: string, ctx?: Pick<DiagramParseContext, 'preprocessed'>): ParseResult<PfdModel> {
  const model: PfdModel = { direction: 'LR', equipment: [], streams: [], properties: new Map() };
  const diagnostics: Diagnostic[] = [];
  const children: AstNode[] = [];
  const byId = new Map<string, Equipment>();
  const error = (message: string, start: number, end: number) =>
    diagnostics.push({ severity: 'error', code: 'PFD_SYNTAX', message, range: { start, end } });

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
        error('Expected "pfd" followed by an optional direction (LR, RL, TB, BT)', start, end);
        break;
      }
      model.direction = (m[1] === 'TD' ? 'TB' : (m[1] ?? 'LR')) as Dir;
      sawHeader = true;
      continue;
    }

    let m: RegExpExecArray | null;
    if ((m = TITLE.exec(line))) {
      model.title = m[1]!.trim();
    } else if ((m = STREAM_PROPS.exec(line))) {
      model.properties.set(unquote(m[1]!), parseProperties(m[2]!));
    } else if (line.includes('-->')) {
      const parts = line.split(ARROW);
      // split with one capture group: [id, label, id, label, id, ...]
      const ids = parts.filter((_, i) => i % 2 === 0).map((s) => s.trim());
      if (ids.some((id) => !ID.test(id))) {
        error('Expected equipment tags around "-->", e.g. "P-101 -->|2| E-101"', start, end);
        continue;
      }
      for (let i = 0; i + 1 < ids.length; i++) {
        const source = touch(ids[i]!, start, end).id;
        const target = touch(ids[i + 1]!, start, end).id;
        const label = parts[2 * i + 1]?.trim() || undefined;
        const id = `s${model.streams.length}`;
        model.streams.push({ id, source, target, label, ast: `edge-${id}` });
        children.push({ id: `edge-${id}`, type: 'stream', range: { start, end } });
      }
    } else if ((m = EQUIPMENT.exec(line))) {
      const [, id, type, name] = m;
      const known = (EQUIPMENT_TYPES as readonly string[]).includes(type!.toLowerCase());
      if (!known) error(`Unknown equipment type "${type}". Known: ${EQUIPMENT_TYPES.join(', ')}`, start, end);
      const eq = touch(id!, start, end);
      eq.type = known ? (type!.toLowerCase() as EquipmentType) : 'block';
      if (name !== undefined) eq.name = name;
    } else {
      error(`Cannot read "${line}"`, start, end);
    }
  }
  if (!sawHeader && diagnostics.length === 0) error('Expected "pfd"', 0, text.length);

  const ast: AstNode = { id: 'root', type: 'pfd', range: { start: 0, end: text.length }, children };
  return { model, ast, diagnostics, symbols: [], statements: [] };
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
      return i < 0 ? { key: '', value: p } : { key: p.slice(0, i).trim(), value: p.slice(i + 1).trim() };
    });
}
