import { PORTS, type Equipment, type EquipmentState, type Port } from './model.js';

const OPEN = new Set(['open', 'opened']);
const CLOSED = new Set(['closed', 'close', 'shut']);
const ON = new Set(['on', 'running', 'true']);
const OFF = new Set(['off', 'stopped', 'false']);
const UNKNOWN = new Set(['', 'unknown', 'unavailable', 'none', 'null', 'undefined', 'nan']);

/**
 * Reads a state value as Home Assistant reports it: a valve's `open` / `closed` / `opening` /
 * `closing`, its `current_position` (0-100, `%` optional), a 3-way valve's connected ports
 * (`AB`, `AC`, `BC`, `ABC`, any order, `-` allowed: `A-C`), a switch's `on` / `off`, or
 * `unavailable` / `unknown`. Anything else is kept as text.
 */
export function parseState(value: string): EquipmentState {
  let raw = value.trim();
  if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) raw = raw.slice(1, -1);
  const v = raw.toLowerCase();
  const num = /^(-?\d+(?:\.\d+)?)\s*%?$/.exec(v);
  if (num) return { raw, kind: 'position', position: Math.min(100, Math.max(0, Number(num[1]))) };
  const ports = v.replace(/[-–>\s]/g, '');
  if (/^[abc]{2,3}$/.test(ports) && new Set(ports).size === ports.length)
    return { raw, kind: 'ports', open: new Set(ports.toUpperCase().split('') as Port[]) };
  if (OPEN.has(v)) return { raw, kind: 'position', position: 100 };
  if (CLOSED.has(v)) return { raw, kind: 'position', position: 0 };
  if (v === 'opening' || v === 'closing') return { raw, kind: v };
  if (ON.has(v)) return { raw, kind: 'on' };
  if (OFF.has(v)) return { raw, kind: 'off' };
  if (UNKNOWN.has(v)) return { raw, kind: 'unknown' };
  return { raw, kind: 'text' };
}

/** The short text shown under the equipment for its state. */
export function stateText(state: EquipmentState): string {
  switch (state.kind) {
    case 'position':
      return state.position === 0 ? 'closed' : state.position === 100 ? 'open' : `${round(state.position!)} % open`;
    case 'ports':
      return state.open!.size === 3 ? 'A–B–C' : PORTS.filter((p) => state.open!.has(p)).join('–');
    case 'unknown':
      return '?';
    default:
      return state.raw;
  }
}

/**
 * Is `port` of `eq` open? Undefined when the state does not say (no state, travelling, text).
 * A 2-way valve has one implicit port: `port` is ignored.
 */
export function portOpen(eq: Equipment, port: Port | undefined): boolean | undefined {
  const s = eq.state;
  if (!s) return undefined;
  if (eq.type === 'valve3') {
    if (s.kind === 'ports') return port ? s.open!.has(port) : s.open!.size > 0;
    if (s.kind === 'position' && (s.position === 0 || s.position === 100)) return s.position === 100;
    return undefined;
  }
  if (eq.type !== 'valve') return undefined;
  if (s.kind === 'position') return s.position! > 0;
  if (s.kind === 'off') return false;
  if (s.kind === 'on') return true;
  return undefined;
}

const round = (n: number) => Math.round(n * 10) / 10;
