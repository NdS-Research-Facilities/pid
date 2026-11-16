import { PORTS, type Bore, type Equipment, type EquipmentState, type Port } from './model.js';

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

const CONDUCTING = new Set(['on', 'closed', 'close', 'true', 'connected']);
const ISOLATED = new Set(['off', 'open', 'opened', 'false', 'tripped', 'disconnected']);

/**
 * Is a breaker or isolator conducting? Electrical sense: `closed` / `on` conducts, `open` /
 * `off` / `tripped` isolates. Undefined when its state says neither.
 */
export function breakerClosed(eq: Equipment): boolean | undefined {
  const v = eq.state?.raw.trim().toLowerCase();
  if (v === undefined) return undefined;
  if (CONDUCTING.has(v)) return true;
  if (ISOLATED.has(v)) return false;
  return undefined;
}

/** An instrument's reading as written (`42.5 °C`), or `?` when Home Assistant has none. */
export function instrumentText(state: EquipmentState): string {
  return state.kind === 'unknown' ? '?' : state.raw;
}

/** The ports a 3-way valve's state connects: `open` is all three, `closed` none. */
export function connectedPorts(state: EquipmentState | undefined): ReadonlySet<Port> | undefined {
  if (!state) return undefined;
  if (state.kind === 'ports') return state.open;
  if (state.kind === 'position' && state.position === 0) return new Set();
  if (state.kind === 'position' && state.position === 100) return new Set(PORTS);
  return undefined;
}

const key = (ports: ReadonlySet<Port>) => PORTS.filter((p) => ports.has(p)).join('');

/** The port combinations each bore can make. */
const BORE_POSITIONS: Record<Bore, ReadonlySet<string>> = {
  L: new Set(['AC', 'BC', '']),
  T: new Set(['AB', 'AC', 'BC', 'ABC']),
};

/**
 * Why a 3-way valve's state is impossible for its bore (an L port joining A to B, a T port shut
 * off), or undefined when it is possible or unknown.
 */
export function boreProblem(eq: Equipment): string | undefined {
  if (eq.type !== 'valve3' || !eq.bore) return undefined;
  const ports = connectedPorts(eq.state);
  if (!ports || BORE_POSITIONS[eq.bore].has(key(ports))) return undefined;
  return `not possible on ${eq.bore === 'L' ? 'an' : 'a'} ${eq.bore}-port valve`;
}

/** The state line under a piece of equipment, with the reason when the state is impossible. */
export function equipmentStateText(eq: Equipment): string {
  const valve = eq.type === 'valve' || eq.type === 'valve3';
  // Only valves have positions: elsewhere a number is a reading (`PV-1 = 3.4` shows 3.4).
  const text = !valve && eq.state!.kind === 'position' ? eq.state!.raw : stateText(eq.state!);
  const problem = boreProblem(eq);
  return problem ? `${text}: ${problem}` : text;
}

/**
 * Is `port` of `eq` open? Undefined when the state does not say (no state, travelling, text).
 * A 2-way valve has one implicit port: `port` is ignored.
 */
export function portOpen(eq: Equipment, port: Port | undefined): boolean | undefined {
  const s = eq.state;
  if (!s) return undefined;
  if (eq.type === 'breaker') return breakerClosed(eq);
  if (eq.type === 'valve3') {
    // An impossible state says nothing reliable about the ports.
    const ports = boreProblem(eq) ? undefined : connectedPorts(s);
    if (!ports) return undefined;
    return port ? ports.has(port) : ports.size > 0;
  }
  if (eq.type !== 'valve') return undefined;
  if (s.kind === 'position') return s.position! > 0;
  if (s.kind === 'off') return false;
  if (s.kind === 'on') return true;
  return undefined;
}

const round = (n: number) => Math.round(n * 10) / 10;
