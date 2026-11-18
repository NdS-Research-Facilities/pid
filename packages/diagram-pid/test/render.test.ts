import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { icons } from '@mermaid-js/plugin-icons';
import { createMermaid } from 'mermaid';
import { describe, expect, it } from 'vitest';
import { boreProblem, declarations, imageUrl, junctions, parsePid, parseState, pid } from '../src/index.js';

const examplesDir = new URL('../../../examples/', import.meta.url);
const read = (name: string) => readFileSync(new URL(name, examplesDir), 'utf8');
const example = read('distillation.mmd');

describe('parsePid', () => {
  it('reads equipment, streams and stream properties', () => {
    const { model, diagnostics } = parsePid(example);
    expect(diagnostics).toEqual([]);
    expect(model.direction).toBe('LR');
    expect(model.title).toBe('Simple distillation');
    expect(model.equipment.map((e) => `${e.id}:${e.type}`)).toEqual([
      'F-1:feed', 'T-101:tank', 'P-101:pump', 'E-101:exchanger', 'C-101:column', 'D-1:product', 'B-1:product',
    ]);
    expect(model.streams.map((s) => `${s.source}>${s.target}|${s.label ?? ''}`)).toEqual([
      'F-1>T-101|', 'T-101>P-101|1', 'P-101>E-101|2', 'E-101>C-101|3', 'C-101>D-1|4', 'C-101>B-1|5',
    ]);
    expect(model.properties.get('1')).toEqual([
      { key: 'T', value: '25 °C' },
      { key: 'F', value: '1200 kg/h' },
    ]);
  });

  it('reports unknown equipment types and bad lines', () => {
    const { diagnostics } = parsePid('pid\n  X-1: spaceship\n  ???\n');
    expect(diagnostics.map((d) => d.message)).toEqual([
      expect.stringContaining('Unknown equipment type "spaceship"'),
      expect.stringContaining('Cannot read "???"'),
    ]);
  });
});

describe('equipment state', () => {
  it('reads Home Assistant valve states', () => {
    expect(parseState('closed')).toMatchObject({ kind: 'position', position: 0 });
    expect(parseState('open')).toMatchObject({ kind: 'position', position: 100 });
    expect(parseState('65')).toMatchObject({ kind: 'position', position: 65 });
    expect(parseState('42.5 %')).toMatchObject({ kind: 'position', position: 42.5 });
    expect(parseState('140')).toMatchObject({ kind: 'position', position: 100 });
    expect(parseState('opening')).toMatchObject({ kind: 'opening' });
    expect(parseState('unavailable')).toMatchObject({ kind: 'unknown' });
    expect(parseState('on')).toMatchObject({ kind: 'on' });
    expect(parseState('fault 3')).toMatchObject({ kind: 'text', raw: 'fault 3' });
  });

  it('reads 3-way valve port states', () => {
    for (const [v, ports] of [['AB', 'AB'], ['ca', 'AC'], ['B-C', 'BC'], ['ABC', 'ABC']] as const)
      expect([...parseState(v).open!].sort().join('')).toBe(ports);
    expect(parseState('AA').kind).toBe('text');
  });

  it('attaches streams to 3-way valve ports and states to equipment', () => {
    const { model, diagnostics } = parsePid(read('valves.mmd'));
    expect(diagnostics).toEqual([]);
    const v = model.equipment.find((e) => e.id === 'V-102')!;
    expect(v.type).toBe('valve3');
    expect([...v.state!.open!].sort().join('')).toBe('AB');
    expect(model.streams.map((s) => `${s.source}${s.sourcePort ? '.' + s.sourcePort : ''}>${s.target}${s.targetPort ? '.' + s.targetPort : ''}`)).toEqual([
      'T-101>V-101', 'V-101>P-101', 'P-101>V-102.A', 'V-102.B>E-101', 'E-101>T-102', 'V-102.C>T-102', 'T-102>V-103', 'V-103>D-1',
    ]);
    expect(model.equipment.some((e) => e.id.includes('.'))).toBe(false);
  });
});

describe('instruments', () => {
  it('reads instruments, their locations, values and line kinds', () => {
    const { model, diagnostics } = parsePid(read('instruments.mmd'));
    expect(diagnostics).toEqual([]);
    const tic = model.equipment.find((e) => e.id === 'TIC-101')!;
    expect(tic).toMatchObject({ type: 'instrument', location: 'dcs', name: 'Temp control' });
    expect(tic.state?.raw).toBe('SP 45 °C');
    expect(model.equipment.find((e) => e.id === 'TT-101')?.location).toBeUndefined();
    const kinds = model.streams.map((s) => `${s.source}${s.kind === 'process' ? '>' : s.kind === 'connection' ? '-' : '~'}${s.target}${s.arrow ? '' : '|'}`);
    expect(kinds).toContain('T-101-TT-101|');
    expect(kinds).toContain('TT-101~TIC-101');
    expect(kinds).toContain('TIC-101~TV-101');
    expect(kinds).toContain('S-1>TV-101');
  });

  it('rejects variants on other equipment and unknown locations or kinds', () => {
    const { diagnostics } = parsePid('pid\n  P-1: pump dcs\n  TT-1: instrument somewhere\n  V-1: valve tap\n  A -.- B');
    expect(diagnostics.map((d) => d.message)).toEqual([
      expect.stringContaining('Only instruments (location), valves (kind) and 3-way valves (L or T) take a variant'),
      expect.stringContaining('Unknown instrument location "somewhere"'),
      expect.stringContaining('Unknown valve kind "tap"'),
    ]);
  });
});

describe('valve kinds', () => {
  it('reads kinds, makes signalled valves control valves, but never a relief valve', () => {
    const { model, diagnostics } = parsePid(read('valve-types.mmd') + '\n  FIC-7 -.-> PSV-1\n');
    expect(diagnostics).toEqual([]);
    const kinds = Object.fromEntries(model.equipment.filter((e) => e.type === 'valve').map((e) => [e.id, e.valveKind]));
    expect(kinds).toEqual({ 'V-1': 'gate', 'V-2': 'globe', 'V-3': 'ball', 'V-4': 'plug', 'V-5': 'butterfly', 'V-6': 'check', 'PSV-1': 'relief', 'FV-7': 'globe', 'MV-8': 'ball' });
    expect(model.equipment.find((e) => e.id === 'FV-7')?.actuated).toBe(true);
    expect(model.equipment.find((e) => e.id === 'PSV-1')?.actuated).toBeUndefined();
    expect(model.equipment.find((e) => e.id === 'V-2')?.actuated).toBeUndefined();
  });
});

describe('3-way valve bores', () => {
  const valve = (bore: string, state: string) => {
    const { model, diagnostics } = parsePid(`pid\n  V: valve3 ${bore} = ${state}\n`);
    expect(diagnostics).toEqual([]);
    return model.equipment[0]!;
  };

  it('allows an L port to join C to A or B, or to shut', () => {
    for (const s of ['AC', 'BC', 'closed', 'ca']) expect(boreProblem(valve('L', s)), s).toBeUndefined();
    for (const s of ['AB', 'ABC', 'open']) expect(boreProblem(valve('L', s)), s).toMatch(/L-port/);
  });

  it('allows a T port any two ports or all three, but not to shut', () => {
    for (const s of ['AB', 'AC', 'BC', 'ABC', 'open']) expect(boreProblem(valve('T', s)), s).toBeUndefined();
    expect(boreProblem(valve('t', 'closed'))).toMatch(/T-port/);
  });

  it('accepts anything without a bore, and an unknown state with one', () => {
    expect(boreProblem(valve('', 'ABC'))).toBeUndefined();
    expect(boreProblem(valve('L', 'unavailable'))).toBeUndefined();
  });

  it('rejects other port letters', () => {
    expect(parsePid('pid\n  V: valve3 X\n').diagnostics[0]?.message).toMatch(/Unknown 3-way valve port "X"/);
  });
});

describe('tees', () => {
  it('reads tees as junctions on the pipe', () => {
    const { model, diagnostics } = parsePid(read('junctions.mmd'));
    expect(diagnostics).toEqual([]);
    expect(model.equipment.filter((e) => e.type === 'tee').map((e) => e.id)).toEqual(['J-1', 'J-2', 'J-3']);
    const from = (id: string) => model.streams.filter((s) => s.source === id).map((s) => s.target);
    expect(from('J-1')).toEqual(['FV-102', 'V-101', 'PT-101']);
  });
});

describe('custom styling', () => {
  it('reads classDef, class, style, image and icon', () => {
    const { model, diagnostics } = parsePid(read('custom-styling.mmd') + '\n  style TT-101 stroke-width:2px\n');
    expect(diagnostics).toEqual([]);
    expect(model.classDefs.get('alarm')).toEqual(['fill:#ffcdd2', 'stroke:#d50000', 'stroke-width:3px', 'color:#d50000', 'font-weight:bold']);
    const eq = (id: string) => model.equipment.find((e) => e.id === id)!;
    expect(eq('TT-102').classes).toEqual(['cold']);
    expect(eq('TT-104').classes).toEqual(['cold']);
    expect(eq('TT-101').style).toEqual(['stroke-width:2px']);
    expect(eq('HP-1').image).toEqual({ url: 'assets/heat-pump.png', width: 64, height: 64 });
    expect(eq('PT-103').icon).toEqual({ name: 'mdi:gauge-low', size: 40 });
    expect(pid.icons!(model)).toEqual(['mdi:gauge-low', 'mdi:snowflake-thermometer']);
  });

  it('joins relative image paths to pid.imageBase only', () => {
    const ctx = (imageBase?: string) => ({ config: { pid: { imageBase } } }) as never;
    expect(imageUrl('assets/heat-pump.png', ctx('/local/'))).toBe('/local/assets/heat-pump.png');
    expect(imageUrl('./pump.png', ctx('/local'))).toBe('/local/pump.png');
    expect(imageUrl('/local/pump.png', ctx('/local/'))).toBe('/local/pump.png');
    expect(imageUrl('https://example.org/p.png', ctx('/local/'))).toBe('https://example.org/p.png');
    expect(imageUrl('data:image/png;base64,AAAA', ctx('/local/'))).toBe('data:image/png;base64,AAAA');
    expect(imageUrl('assets/heat-pump.png', ctx())).toBe('assets/heat-pump.png');
  });

  it('splits declarations at commas outside parentheses', () => {
    expect(declarations('fill:rgb(1, 2, 3),stroke:#000;')).toEqual(['fill:rgb(1, 2, 3)', 'stroke:#000']);
  });
});

describe('line styles and numbers', () => {
  it('styles lines by index or default, and numbers them by tag or ends', () => {
    const { model, diagnostics } = parsePid(read('junctions.mmd') + '\n  linkStyle default stroke-dasharray:2 2\n');
    expect(diagnostics).toEqual([]);
    expect(model.streams[5]!.style).toEqual(['stroke:#1565c0', 'stroke-width:2.5px']);
    expect(model.streams[6]!.style).toEqual(['stroke:#1565c0', 'stroke-width:2.5px']);
    expect(model.linkStyleDefault).toEqual(['stroke-dasharray:2 2']);
    const numbered = Object.fromEntries(model.streams.filter((s) => s.lineNumber).map((s) => [`${s.source}>${s.target}`, s.lineNumber]));
    expect(numbered).toEqual({
      'T-101>P-101': '4"-P-101-A1',
      'P-101>J-1': '3"-P-102-A1',
      'J-1>V-101': '2"-P-104-A1',
      'E-101>D-1': '3"-P-103-A1',
    });
  });

  it('reports lines that do not exist', () => {
    const { diagnostics } = parsePid('pid\n  A --> B\n  linkStyle 3 stroke:#f00\n  pipe 9 1"-X\n');
    expect(diagnostics.map((d) => d.message)).toEqual([
      expect.stringContaining('linkStyle 3: there are 1 lines'),
      expect.stringContaining('pipe 9: no line'),
    ]);
  });
});

describe('all-capabilities example', () => {
  it('parses cleanly and uses every equipment type, valve kind, bore and instrument location', async () => {
    const { EQUIPMENT_TYPES, INSTRUMENT_LOCATIONS, VALVE_KINDS } = await import('../src/model.js');
    const { model, diagnostics } = parsePid(read('all-capabilities.mmd'));
    expect(diagnostics).toEqual([]);
    const eq = model.equipment;
    expect(new Set(eq.map((e) => e.type))).toEqual(new Set(EQUIPMENT_TYPES));
    expect(new Set(eq.flatMap((e) => (e.type === 'valve' ? [e.valveKind ?? 'gate'] : [])))).toEqual(new Set(VALVE_KINDS));
    expect(new Set(eq.flatMap((e) => (e.type === 'instrument' ? [e.location ?? 'field'] : [])))).toEqual(new Set(INSTRUMENT_LOCATIONS));
    expect(new Set(eq.flatMap((e) => (e.type === 'valve3' ? [e.bore ?? 'none'] : [])))).toEqual(new Set(['L', 'T', 'none']));
    expect(new Set(model.streams.map((s) => `${s.kind}${s.arrow ? '>' : ''}`))).toEqual(
      new Set(['process>', 'connection', 'signal>', 'signal', 'electric>', 'electric']),
    );
    expect(eq.some((e) => e.image) && eq.some((e) => e.icon) && eq.some((e) => e.classes) && eq.some((e) => e.style)).toBe(true);
    expect(model.streams.some((s) => s.lineNumber) && model.streams.some((s) => s.style) && model.linkStyleDefault).toBeTruthy();
    expect(model.streams[13]).toMatchObject({ source: 'HP-1', target: 'E-101', name: 'heat', classes: ['heating'] });
    expect(eq.find((e) => e.id === 'AT-106')?.name).toBe('pH (outlet)');
    expect(eq.some((e) => e.gradient) && eq.some((e) => e.level)).toBe(true);
    expect(eq.some((e) => e.coils) && model.streams.some((s) => s.targetCoil !== undefined) && eq.some((e) => e.size)).toBe(true);
    // The newer statements and their variants, so the example keeps showing all of them.
    const coils = eq.flatMap((e) => e.coils ?? []);
    expect(coils.some((c) => c.side) && coils.some((c) => ![0.2, 0.5, 0.8].includes(c.height))).toBe(true);
    expect(new Set(eq.flatMap((e) => (e.actuator ? [`${e.type}:${e.actuator}`] : [])))).toEqual(
      new Set(['valve:motor', 'valve:diaphragm', 'valve3:motor']),
    );
    expect(eq.some((e) => e.type === 'valve3' && e.actuated && !e.actuator)).toBe(true); // driven by a signal
    expect(new Set(eq.flatMap((e) => (e.state ? [e.state.kind] : [])))).toEqual(
      new Set(['position', 'ports', 'opening', 'closing', 'on', 'off', 'unknown', 'text']),
    );
    expect(eq.find((e) => e.type === 'breaker' && e.state?.raw === 'open')).toBeDefined();
    expect(eq.some((e) => e.gradient?.some((st) => st.color)) && eq.some((e) => e.gradientRange) && eq.some((e) => e.level?.color)).toBe(true);
    expect(eq.some((e) => e.nozzles?.some((z) => z.label)) && model.streams.some((s) => s.sourceNozzle) && model.streams.some((s) => s.targetNozzle)).toBe(true);
    expect(coils.some((c) => c.sideOut)).toBe(true);
  });
});

describe('solar and electrical', () => {
  it('reads power cables and keeps == apart from states', () => {
    const { model, diagnostics } = parsePid(read('solar.mmd'));
    expect(diagnostics).toEqual([]);
    const cables = model.streams.filter((s) => s.kind === 'electric').map((s) => `${s.source}${s.arrow ? '>' : '-'}${s.target}`);
    expect(cables).toEqual(['PV-1>Q-1', 'Q-1>INV-1', 'INV-1-BAT-1', 'INV-1>Q-2', 'Q-2>M-1', 'M-1>G-1', 'Q-2>H-1', 'Q-2>Q-3', 'Q-3>EV-1']);
    expect(model.equipment.find((e) => e.id === 'PV-1')?.state?.raw).toBe('3.4 kW');
    expect(model.equipment.find((e) => e.id === 'Q-2')?.state?.raw).toBe('closed');
  });

  it('reads breakers in the electrical sense: closed conducts', async () => {
    const { breakerClosed } = await import('../src/state.js');
    const b = (state: string) => parsePid(`pid\n  Q: breaker = ${state}\n`).model.equipment[0]!;
    expect(['closed', 'on', 'ON', 'connected'].map((v) => breakerClosed(b(v)))).toEqual([true, true, true, true]);
    expect(['open', 'off', 'tripped'].map((v) => breakerClosed(b(v)))).toEqual([false, false, false]);
    expect(breakerClosed(b('unavailable'))).toBeUndefined();
  });

  it('shows a number on other equipment as written, not as a valve position', () => {
    const { model } = parsePid('pid\n  PV-1: pv = 3.4\n');
    expect(model.equipment[0]!.state?.kind).toBe('position');
  });
});

describe('coil walls', () => {
  it('names the inlet and outlet walls separately, or both with one word', () => {
    const { model, diagnostics } = parsePid('pid\n  T: tank\n  coil T bottom left right "A"\n  coil T top right\n  coil T middle\n');
    expect(diagnostics).toEqual([]);
    expect(model.equipment[0]!.coils).toEqual([
      { height: 0.2, side: 'left', sideOut: 'right', name: 'A' },
      { height: 0.8, side: 'right' },
      { height: 0.5 },
    ]);
  });

  it('puts the inlet on the lower nozzle when asked, on one wall only', async () => {
    const { coilShape } = await import('../src/symbols.js');
    const coil = { height: 0.5 };
    const up = coilShape('tank', coil, 'right', 'right')!;
    const low = coilShape('tank', coil, 'right', 'right', true)!;
    expect(up.inlet.y).toBeLessThan(up.outlet.y);
    expect(low.inlet).toEqual(up.outlet);
    expect(low.outlet).toEqual(up.inlet);
    // Through the tank: the flag does not apply, both nozzles at mid-height.
    const through = coilShape('tank', coil, 'left', 'right', true)!;
    expect(through.inlet.y).toBe(through.outlet.y);
  });
});

describe('nozzles', () => {
  const src = `pid LR
  CV: block "Central heating"
  icon CV mdi:heat-pump 50
  nozzle CV n1 right "CH flow"
  nozzle CV n2 right "CH return"
  nozzle CV n3 left "DHW in"
  T: tank "Buffer"
  nozzle T top top "Vent"
  nozzle T a right
  nozzle T b right
  nozzle T c right
  nozzle T d right
  nozzle T e right
  CV.n1 --> R
  R --> CV.n2
  F --> CV.n3
  T.a --> X
  T.top --> V
`;

  it('reads nozzles and lines to them', () => {
    const { model, diagnostics } = parsePid(src);
    expect(diagnostics).toEqual([]);
    const cv = model.equipment.find((e) => e.id === 'CV')!;
    expect(cv.nozzles).toEqual([
      { id: 'n1', side: 'right', label: 'CH flow' },
      { id: 'n2', side: 'right', label: 'CH return' },
      { id: 'n3', side: 'left', label: 'DHW in' },
    ]);
    expect(model.streams.map((s) => `${s.source}${s.sourceNozzle ? '.' + s.sourceNozzle : ''}>${s.target}${s.targetNozzle ? '.' + s.targetNozzle : ''}`)).toEqual([
      'CV.n1>R', 'R>CV.n2', 'F>CV.n3', 'T.a>X', 'T.top>V',
    ]);
    expect(model.equipment.some((e) => e.id.includes('.'))).toBe(false);
  });

  it('reports duplicate and unknown nozzles, and nozzles on tees and valves', () => {
    const msgs = parsePid('pid\n  P: pump\n  nozzle P a left\n  nozzle P a right\n  P.zz --> Q\n  J: tee\n  nozzle J x left\n  V: valve\n  nozzle V y left\n').diagnostics.map((d) => d.message);
    expect(msgs).toEqual([
      expect.stringContaining('P already has a nozzle "a"'),
      expect.stringContaining('P has no nozzle "zz"'),
      expect.stringContaining('J is a tee: it has its own connection points'),
      expect.stringContaining('V is a valve: it has its own connection points'),
    ]);
  });

  it('draws stubs with descriptions, ends lines on them, and makes room', async () => {
    const mermaid = createMermaid();
    await mermaid.registerExternalDiagrams([pid]);
    const { svg } = await mermaid.render('nz', src);
    expect(svg.match(/class="nozzle nozzle-/g)).toHaveLength(9);
    expect(svg).toContain('<title>CH flow</title>');
    expect(svg.match(/class="nozzle-label"/g)).toHaveLength(4);
    // An icon with nozzles gets an outline to carry them.
    expect(svg).toContain('class="nozzle-frame"');
    // Each line to a nozzle ends on its stub's outer end.
    const stubs = [...svg.matchAll(/class="nozzle nozzle-(\w+)"[\s\S]*?<path d="M[^L]*L(-?[\d.]+),(-?[\d.]+)"/g)].map((m) => ({ id: m[1]!, x: +m[2]!, y: +m[3]! }));
    const ends = [...svg.matchAll(/<g class="stream [^"]*" data-id="edge-(s\d+)"[^>]*>\s*<path d="([^"]+)"/g)].map((m) => {
      const p = [...m[2]!.matchAll(/[ML]\s*(-?[\d.]+)[ ,](-?[\d.]+)/g)].map((q) => ({ x: +q[1]!, y: +q[2]! }));
      return [p[0]!, p[p.length - 1]!];
    });
    const on = (id: string) => {
      const st = stubs.find((z) => z.id === id)!;
      return ends.some((e) => e.some((p) => Math.abs(p.x - st.x) < 1 && Math.abs(p.y - st.y) < 1));
    };
    for (const id of ['n1', 'n2', 'n3', 'a', 'top']) expect(on(id), id).toBe(true);
  });

  it('grows a symbol whose side has more nozzles than room', async () => {
    const { layoutPid } = await import('../src/layout.js');
    void layoutPid;
    const { model } = parsePid(src);
    const t = model.equipment.find((e) => e.id === 'T')!;
    // Five nozzles on the right need (5 + 1) × 18 px; a plain tank is 80 px tall.
    expect(t.nozzles!.filter((z) => z.side === 'right')).toHaveLength(5);
    const mermaid = createMermaid();
    await mermaid.registerExternalDiagrams([pid]);
    const { svg } = await mermaid.render('nz2', src);
    const scale = /data-id="node-T"[^>]*>\s*<g transform="[^"]*scale\(([\d.]+)/.exec(svg);
    expect(Number(scale?.[1])).toBeCloseTo((6 * 18) / 80, 2);
  });
});

describe('line classes', () => {
  const src = `pid LR
  classDef flow stroke:#ef6c00,stroke-width:2.5px
  classDef back stroke:#5b8fd0
  class f1,f2 flow
  CV f1@--> T-1 f2@--> P-1 --> VV
  VV r1@--> CV
  V: valve = closed
  CV b1@--> V
  class r1 back
  class b1 flow
  style f2 stroke-dasharray:4 2
  linkStyle r1 stroke-width:3px
  pipe f1 22mm-CV-01
  class P-1 flow
`;

  it('names lines with ID@ and applies class, style, linkStyle and pipe by name', () => {
    const { model, diagnostics } = parsePid(src);
    expect(diagnostics).toEqual([]);
    const line = (name: string) => model.streams.find((s) => s.name === name)!;
    expect(model.streams.map((s) => s.name ?? '-')).toEqual(['f1', 'f2', '-', 'r1', 'b1']);
    expect(line('f1')).toMatchObject({ source: 'CV', target: 'T-1', classes: ['flow'], lineNumber: '22mm-CV-01' });
    expect(line('f2')).toMatchObject({ classes: ['flow'], style: ['stroke-dasharray:4 2'] });
    expect(line('r1')).toMatchObject({ classes: ['back'], style: ['stroke-width:3px'] });
    // A class naming something that is not a line still goes to equipment.
    expect(model.equipment.find((e) => e.id === 'P-1')?.classes).toEqual(['flow']);
    expect(model.equipment.some((e) => ['f1', 'f2', 'r1', 'b1'].includes(e.id))).toBe(false);
  });

  it('ignores a class that is an unfilled template, keeping the classes before it', () => {
    const { model, diagnostics } = parsePid(
      "pid\n  classDef warm stroke:#ef6c00\n  A k1@--> B\n  class k1 warm\n  class k1 ${if(is_state('switch.p', 'on'), 'hot', 'off')}\n",
    );
    expect(diagnostics).toEqual([]);
    expect(model.streams[0]!.classes).toEqual(['warm']);
  });

  it('reports duplicate names, names shared with equipment, and unknown names', () => {
    const msgs = parsePid('pid\n  A x@--> B\n  B x@--> C\n  C A@--> D\n  linkStyle nope stroke:#f00\n').diagnostics.map((d) => d.message);
    expect(msgs).toEqual([
      expect.stringContaining('Two lines are named "x"'),
      expect.stringContaining('"A" names both a line and a piece of equipment'),
      expect.stringContaining('linkStyle nope: no line is named "nope"'),
    ]);
  });

  it('draws a line in its class, its own style over the class, and blocking over both', async () => {
    const mermaid = createMermaid();
    await mermaid.registerExternalDiagrams([pid]);
    const { svg } = await mermaid.render('lc', src);
    const path = (id: string) => new RegExp(`data-id="edge-${id}"[^>]*>\\s*<path ([^>]*)>`).exec(svg)![1]!;
    expect(svg).toMatch(/class="stream process class-flow" data-id="edge-s0"/);
    expect(path('s0')).toContain('stroke="#ef6c00"');
    expect(path('s0')).toContain('stroke-width="2.5px"');
    expect(path('s1')).toContain('stroke-dasharray="4 2"'); // own style on top of the class
    expect(path('s3')).toContain('stroke="#5b8fd0"');
    expect(path('s3')).toContain('stroke-width="3px"'); // own linkStyle over the class
    expect(path('s4')).toContain('stroke-opacity="0.55"'); // into a closed valve: still blocked
    expect(path('s4')).toContain('stroke-dasharray="4 3"');
  });
});

describe('tee dots', () => {
  it('finds junctions: three or more arms, a straight run counting as two', () => {
    // A trunk from the left that splits 40 px further on: up and right.
    const trunk = [{ x: 0, y: 50 }, { x: 40, y: 50 }, { x: 40, y: 0 }];
    const branch = [{ x: 0, y: 50 }, { x: 100, y: 50 }];
    expect(junctions([trunk, branch])).toEqual([{ x: 40, y: 50 }]);
    // A pipe that just continues through a point is not a junction.
    expect(junctions([[{ x: 0, y: 0 }, { x: 50, y: 0 }], [{ x: 50, y: 0 }, { x: 100, y: 0 }]])).toEqual([]);
    // Three lines meeting at one point from three sides is.
    expect(junctions([[{ x: 0, y: 0 }, { x: 50, y: 0 }], [{ x: 50, y: 0 }, { x: 100, y: 0 }], [{ x: 50, y: 0 }, { x: 50, y: 40 }]])).toEqual([{ x: 50, y: 0 }]);
  });
});

/** Pairs of different lines in `svg` running along the same column or row (a tee's trunk excepted). */
function overlappingLines(svg: string): string[] {
  const lines = [...svg.matchAll(/<g class="stream [^"]*" data-id="edge-(s\d+)"[^>]*>\s*<path d="([^"]+)"/g)].map((m) => ({
    id: m[1]!,
    pts: [...m[2]!.matchAll(/[ML]\s*(-?[\d.]+)[ ,](-?[\d.]+)/g)].map((p) => ({ x: +p[1]!, y: +p[2]! })),
  }));
  const dots = [...svg.matchAll(/class="tee-dot" cx="([\d.]+)" cy="([\d.]+)"/g)].map((m) => ({ x: +m[1]!, y: +m[2]! }));
  const found: string[] = [];
  for (let i = 0; i < lines.length; i++)
    for (let j = i + 1; j < lines.length; j++)
      for (let a = 0; a + 1 < lines[i]!.pts.length; a++)
        for (let b = 0; b + 1 < lines[j]!.pts.length; b++) {
          const [a0, a1, b0, b1] = [lines[i]!.pts[a]!, lines[i]!.pts[a + 1]!, lines[j]!.pts[b]!, lines[j]!.pts[b + 1]!];
          const v = Math.abs(a0.x - a1.x) < 0.5 && Math.abs(b0.x - b1.x) < 0.5 && Math.abs(a0.x - b0.x) < 0.5;
          const h = Math.abs(a0.y - a1.y) < 0.5 && Math.abs(b0.y - b1.y) < 0.5 && Math.abs(a0.y - b0.y) < 0.5;
          if (!v && !h) continue;
          const p = v ? 'y' : 'x';
          const lo = Math.max(Math.min(a0[p], a1[p]), Math.min(b0[p], b1[p]));
          const hi = Math.min(Math.max(a0[p], a1[p]), Math.max(b0[p], b1[p]));
          if (hi - lo <= 1) continue;
          const trunk = dots.some((d) => (v ? Math.abs(d.x - a0.x) < 1 && d.y >= lo - 1 && d.y <= hi + 1 : Math.abs(d.y - a0.y) < 1 && d.x >= lo - 1 && d.x <= hi + 1));
          if (!trunk) found.push(`${lines[i]!.id}/${lines[j]!.id}`);
        }
  return found;
}

/** Small steps in lines: a short (< 15 px) turn between two parallel runs. There should be none. */
function bumps(svg: string): string[] {
  const found: string[] = [];
  for (const m of svg.matchAll(/<g class="stream [^"]*" data-id="edge-(s\d+)"[^>]*>\s*<path d="([^"]+)"/g)) {
    const p = [...m[2]!.matchAll(/[ML]\s*(-?[\d.]+)[ ,](-?[\d.]+)/g)].map((q) => ({ x: +q[1]!, y: +q[2]! }));
    for (let k = 1; k + 2 < p.length; k++) {
      const [a, b, c, d] = [p[k - 1]!, p[k]!, p[k + 1]!, p[k + 2]!];
      const len = Math.hypot(c.x - b.x, c.y - b.y);
      const flat = (u: typeof a, w: typeof a) => Math.abs(u.y - w.y) < 0.5;
      const upright = (u: typeof a, w: typeof a) => Math.abs(u.x - w.x) < 0.5;
      const bump =
        (flat(a, b) && flat(c, d) && upright(b, c) && Math.abs(a.y - d.y) > 0.5) ||
        (upright(a, b) && upright(c, d) && flat(b, c) && Math.abs(a.x - d.x) > 0.5);
      if (len > 0.5 && len < 15 && bump) found.push(`${m[1]}:${Math.round(len)}px`);
    }
  }
  return found;
}

/** Line ends at a tee's layout position where that tee's dot is elsewhere: there should be none. */
function staleTeeEnds(svg: string): string[] {
  const tees = [...svg.matchAll(/class="equipment tee[^"]*" data-id="node-([^"]+)"[^>]*>\s*<g transform="translate\(([\d.]+),([\d.]+)\)"/g)].map(
    (m) => ({ id: m[1]!, x: +m[2]! + 4, y: +m[3]! + 4 }),
  );
  const dots = [...svg.matchAll(/class="tee-dot" cx="([\d.]+)" cy="([\d.]+)"/g)].map((m) => ({ x: +m[1]!, y: +m[2]! }));
  const ends = [...svg.matchAll(/<g class="stream [^"]*" data-id="edge-(s\d+)"[^>]*>\s*<path d="([^"]+)"/g)].flatMap((m) => {
    const p = [...m[2]!.matchAll(/[ML]\s*(-?[\d.]+)[ ,](-?[\d.]+)/g)].map((q) => ({ x: +q[1]!, y: +q[2]! }));
    return [{ id: m[1]!, ...p[0]! }, { id: m[1]!, ...p[p.length - 1]! }];
  });
  const near = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1;
  return tees.filter((t) => !dots.some((d) => near(d, t))).flatMap((t) => ends.filter((e) => near(e, t)).map((e) => `${e.id}@${t.id}`));
}

/** Every tee dot in `svg` sits where three or more line arms meet. */
function dotsOnJunctions(svg: string): { dots: number; off: string[] } {
  const dots = [...svg.matchAll(/class="tee-dot" cx="([\d.]+)" cy="([\d.]+)"/g)].map((m) => ({ x: +m[1]!, y: +m[2]! }));
  const paths = [...svg.matchAll(/<g class="stream [^"]*"[^>]*>\s*<path d="([^"]+)"/g)].map((m) =>
    [...m[1]!.matchAll(/[ML]\s*(-?[\d.]+)[ ,](-?[\d.]+)/g)].map((p) => ({ x: +p[1]!, y: +p[2]! })),
  );
  const found = junctions(paths);
  const off = dots.filter((d) => !found.some((j) => Math.abs(j.x - d.x) < 1 && Math.abs(j.y - d.y) < 1)).map((d) => `${d.x},${d.y}`);
  return { dots: dots.length, off };
}

describe('actuators', () => {
  it('puts motors and diaphragms on 2- and 3-way valves, and signals on 3-way valves', () => {
    const { model, diagnostics } = parsePid(read('valve-types.mmd'));
    expect(diagnostics).toEqual([]);
    const eq = (id: string) => model.equipment.find((e) => e.id === id)!;
    expect(eq('MV-8')).toMatchObject({ actuated: true, actuator: 'motor' });
    expect(eq('V3-9')).toMatchObject({ actuated: true, actuator: 'motor' });
    expect(eq('V3-10')).toMatchObject({ actuated: true });
    expect(eq('V3-10').actuator).toBeUndefined(); // signal-driven: a diaphragm
    expect(eq('V-1').actuated).toBeUndefined();
  });

  it('refuses actuators on other equipment and relief valves', () => {
    const msgs = parsePid('pid\n  P: pump\n  R: valve relief\n  actuator P motor\n  actuator R motor\n').diagnostics.map((d) => d.message);
    expect(msgs).toEqual([
      expect.stringContaining('P is a pump: actuators go on valves and 3-way valves'),
      expect.stringContaining('R is a relief valve: actuators go on valves and 3-way valves'),
    ]);
  });

  it('lands a signal on a 3-way valve on its actuator, opposite port C', async () => {
    const { endSides } = await import('../src/layout.js');
    const { model } = parsePid(read('valve-types.mmd'));
    const byId = new Map(model.equipment.map((e) => [e.id, e]));
    const signal = model.streams.find((s) => s.source === 'XIC-10')!;
    expect(endSides('LR', signal, byId).target).toBe('top');
    expect(endSides('LR', signal, byId, new Set(['V3-10'])).target).toBe('bottom');
    expect(endSides('TB', signal, byId).target).toBe('right');
  });
});

describe('coils and size', () => {
  it('reads coils, their heights, walls and names, and lines to them', () => {
    const { model, diagnostics } = parsePid(read('coils.mmd'));
    expect(diagnostics).toEqual([]);
    const t = model.equipment.find((e) => e.id === 'T-1')!;
    expect(t.coils).toEqual([
      { height: 0.2, name: 'Solar coil' },
      { height: 0.5, name: 'Heat pump coil' },
      { height: 0.8, side: 'right', name: 'Hot water coil' },
    ]);
    const at = (s: { source: string; sourceCoil?: number; target: string; targetCoil?: number }) =>
      `${s.source}${s.sourceCoil !== undefined ? `.coil${s.sourceCoil + 1}` : ''}>${s.target}${s.targetCoil !== undefined ? `.coil${s.targetCoil + 1}` : ''}`;
    expect(model.streams.map(at)).toEqual(['SC-1>P-1', 'P-1>T-1.coil1', 'T-1.coil1>R-1', 'HP-1>T-1.coil2', 'T-1.coil2>R-2', 'F-1>T-1.coil3', 'T-1.coil3>D-1']);
    expect(model.equipment.some((e) => e.id.includes('.coil'))).toBe(false);
    expect(parsePid('pid\n  T: tank\n  coil T @35%\n').model.equipment[0]!.coils).toEqual([{ height: 0.35 }]);
  });

  it('reports coils that do not exist or cannot be', () => {
    const msgs = parsePid('pid\n  T: tank\n  P: pump\n  coil T bottom\n  coil P top\n  X --> T.coil2\n  size T 9\n').diagnostics.map((d) => d.message);
    expect(msgs).toEqual([
      expect.stringContaining('size T 9: use a factor from 0.5 to 3'),
      expect.stringContaining('T has 1 coil: there is no coil2'),
      expect.stringContaining('P is a pump: coils go in tank, vessel, drum, column, reactor'),
    ]);
  });

  it('grows vessels with coils, and takes size', async () => {
    const { scaleOf } = await import('../src/symbols.js');
    const eq = (src: string) => parsePid(`pid\n  T: tank\n${src}`).model.equipment[0]!;
    expect(scaleOf(eq(''))).toBe(1);
    expect(scaleOf(eq('  coil T top\n'))).toBe(1.25);
    expect(scaleOf(eq('  coil T top\n  coil T bottom\n'))).toBe(1.5);
    expect(scaleOf(eq('  coil T top\n  coil T middle\n  coil T bottom\n'))).toBe(1.8);
    expect(scaleOf(eq('  coil T top\n  size T 2.2\n'))).toBe(2.2);
  });
});

describe('gradients and levels', () => {
  it('reads stops top to bottom, heights, colours and unknown readings', async () => {
    const { parseStops, parseLevel } = await import('../src/parser.js');
    expect(parseStops('64 °C, 52 °C, 38 °C')).toEqual([
      { raw: '64 °C', value: 64, height: 1 },
      { raw: '52 °C', value: 52, height: 0.5 },
      { raw: '38 °C', value: 38, height: 0 },
    ]);
    expect(parseStops('61 °C @90%, #1565c0, unavailable @10%')).toEqual([
      { raw: '61 °C', value: 61, height: 0.9 },
      { raw: '#1565c0', color: '#1565c0', height: 0.5 },
      { raw: 'unavailable', height: 0.1 },
    ]);
    expect(parseStops('47 °C')).toEqual([{ raw: '47 °C', value: 47, height: 0.5 }]);
    // Stops are separated by commas, so readings use a decimal point (as Home Assistant states do).
    expect(parseStops('rgb(1, 2, 3), 48.5 °C')).toMatchObject([{ color: 'rgb(1, 2, 3)' }, { value: 48.5 }]);
    expect(parseLevel('73 %')).toEqual({ raw: '73 %', percent: 73 });
    expect(parseLevel('140 #ffb74d')).toEqual({ raw: '140', percent: 100, color: '#ffb74d' });
    expect(parseLevel('unavailable')).toEqual({ raw: 'unavailable' });
  });

  it('reads ranges and marks, and refuses fills on equipment without an inside', () => {
    const { model, diagnostics } = parsePid(read('gradients.mmd'));
    expect(diagnostics).toEqual([]);
    expect(model.gradientRange).toEqual([20, 70]);
    expect(model.equipment.find((e) => e.id === 'T-8')?.gradientRange).toEqual([35, 60]);
    expect(parsePid(read('gradients-no-marks.mmd')).model).toMatchObject({ gradientMarks: false, gradientRange: [15, 65] });
    const bad = parsePid('pid\n  P-1: pump\n  level P-1 50 %\n  gradient-range 5 5\n').diagnostics.map((d) => d.message);
    expect(bad).toEqual([
      expect.stringContaining('gradient-range needs two different numbers'),
      expect.stringContaining('P-1 is a pump: gradient and level work on tank, vessel, drum, column, reactor'),
    ]);
  });

  it('maps readings onto the colour scale, either way round', async () => {
    const { scaleColour } = await import('../src/render.js');
    expect(scaleColour(20, [20, 70])).toEqual([0x15, 0x65, 0xc0]);
    expect(scaleColour(70, [20, 70])).toEqual([0xc6, 0x28, 0x28]);
    expect(scaleColour(99, [20, 70])).toEqual([0xc6, 0x28, 0x28]);
    expect(scaleColour(20, [70, 20])).toEqual([0xc6, 0x28, 0x28]);
  });
});

describe('Mermaid v13 integration', () => {
  it('detects and renders a pid to SVG', async () => {
    const mermaid = createMermaid();
    await mermaid.registerExternalDiagrams([pid]);
    expect(mermaid.detectType(example)).toBe('pid');
    const { svg } = await mermaid.render('pid1', example);
    expect(svg).toContain('mermaid-pid');
    for (const tag of ['T-101', 'P-101', 'C-101', '1200 kg/h']) expect(svg).toContain(tag);
  });

  it('renders every example, marking shut ports and blocked streams', async () => {
    const mermaid = createMermaid();
    await mermaid.registerExternalDiagrams([pid, icons]);
    mermaid.registerIconPacks([{ name: 'mdi', loader: () => import('@iconify-json/mdi/icons.json').then((m) => m.default) }]);
    const out = new URL('../../../out/', import.meta.url);
    mkdirSync(out, { recursive: true });
    for (const file of readdirSync(examplesDir).filter((f) => f.endsWith('.mmd') && !f.startsWith('.'))) {
      const { svg } = await mermaid.render(file.replace(/\W/g, '-'), read(file));
      writeFileSync(new URL(file.replace(/\.mmd$/, '.svg'), out), svg);
      if (file === 'instruments.mmd') {
        expect(svg).toContain('instrument-letters');
        for (const t of ['TIC', 'FQI', '42.5 °C', 'SP 45 °C', '1284 m³']) expect(svg).toContain(t);
        expect(svg).toMatch(/class="equipment instrument state-unknown"/); // PT-103 unavailable
        expect(svg.match(/class="stream signal"/g)).toHaveLength(2);
        expect(svg.match(/class="stream connection"/g)).toHaveLength(4);
      }
      // No two different lines drawn on top of each other, and no small steps in any line.
      expect(overlappingLines(svg), file).toEqual([]);
      expect(bumps(svg), file).toEqual([]);
      if (read(file).includes(': tee')) {
        // Tee dots mark where the lines actually join, never a straight run.
        const { dots, off } = dotsOnJunctions(svg);
        expect(dots, file).toBeGreaterThan(0);
        expect(off, file).toEqual([]);
        // …and the tee's lines start or end at the dot, so a line's colour changes there.
        expect(staleTeeEnds(svg), file).toEqual([]);
      }
      if (file === 'valve-types.mmd') {
        // PSV-1 is closed, as relief valves are in service: its lines stay solid.
        const psvLines = svg.match(/<g class="stream process[^"]*" data-id="edge-s1[56]"/g) ?? [];
        expect(psvLines).toHaveLength(2);
        expect(psvLines.join('')).not.toContain('stream-blocked');
        expect(svg).toMatch(/class="equipment valve state-closed"/);
      }
      // No two different lines drawn on top of each other, and no small steps in any line.
      expect(overlappingLines(svg), file).toEqual([]);
      expect(bumps(svg), file).toEqual([]);
      if (read(file).includes(': tee')) {
        // Tee dots mark where the lines actually join, never a straight run.
        const { dots, off } = dotsOnJunctions(svg);
        expect(dots, file).toBeGreaterThan(0);
        expect(off, file).toEqual([]);
        // …and the tee's lines start or end at the dot, so a line's colour changes there.
        expect(staleTeeEnds(svg), file).toEqual([]);
      }
      if (file === 'valve-types.mmd') {
        // Three motors: MV-8, V3-9, and the M glyph is drawn as a path inside each circle.
        expect(svg.match(/data-id="node-(MV-8|V3-9)"/g)).toHaveLength(2);
      }
      if (file === 'home-heating.mmd') {
        // The real installation: 20 named pipes, CV's four described nozzles, three tees. Outside
        // Home Assistant the live classes are not filled in, so only the fixed ones apply.
        expect(svg).not.toContain('stream electric');
        expect(svg.match(/class="stream process/g)).toHaveLength(20);
        expect(svg.match(/class="stream process class-warm"/g)).toHaveLength(7);
        expect(svg.match(/class="stream process( stream-blocked)? class-return"/g)).toHaveLength(8);
        expect(svg.match(/class="nozzle nozzle-n\d"/g)).toHaveLength(4);
        for (const label of ['CH flow', 'CH return', 'DHW in', 'DHW out']) expect(svg).toContain(`<title>${label}</title>`);
        expect(svg.match(/class="tee-dot"/g)!.length).toBeGreaterThanOrEqual(3);
      }
      if (file === 'coils.mmd') {
        expect(svg.match(/class="coil coil\d"/g)).toHaveLength(3);
        expect(svg).toContain('<title>Solar coil</title>');
        expect(svg).toContain('scale(1.8,1.8)');
      }
      if (file === 'solar.mmd') {
        expect(svg.match(/class="stream electric/g)).toHaveLength(9);
        expect(svg.match(/class="stream electric stream-blocked"/g)).toHaveLength(2); // around the open Q-3
        expect(svg.match(/class="blade blade-closed"/g)).toHaveLength(2);
        expect(svg.match(/class="blade blade-open"/g)).toHaveLength(1);
        expect(svg).toContain('stroke="#ef6c00"');
        expect(svg).toContain('3.4 kW');
      }
      if (file === 'gradients.mmd') {
        expect(svg.match(/class="equipment [a-z]+ has-gradient/g)!.length).toBe(9);
        expect(svg.match(/class="level"/g)).toHaveLength(6); // T-6, T-7, T-8, V-1, D-1, R-1; T-9's is unknown
        expect(svg).toContain('62 %');
        expect(svg.match(/<g class="fill"/g)).toHaveLength(13); // every vessel with a gradient or level (T-9 empty)
        expect(svg.split('<g class="fill">').slice(1).join('').match(/<rect /g)!.length).toBeGreaterThan(300);
      }
      if (file === 'gradients-no-marks.mmd') {
        expect(svg).not.toContain('gradient-value');
        expect(svg).not.toContain('level-value');
        expect(svg).toContain('class="level"');
      }
      if (file === 'custom-styling.mmd') {
        expect(svg).toContain('class-alarm');
        expect(svg).toContain('#d50000');
        expect(svg).toContain('stroke-width="3px"');
        expect(svg).toMatch(/<image class="custom-image" href="assets\/heat-pump.png"/);
        expect(svg.match(/class="custom-icon"/g)).toHaveLength(2);
      }
      if (file === 'junctions.mmd') {
        expect(svg.match(/class="line-number"/g)).toHaveLength(4);
        expect(svg).toContain('4&quot;-P-101-A1');
        expect(svg).toContain('stroke="#1565c0"');
        expect(svg.match(/class="equipment tee"/g)).toHaveLength(3);
        // Tees carry no labels, and lines into a tee have no arrowhead: 13 lines, 8 arrowheads
        // (3 into tees, 2 instrument connections without one).
        expect(svg).not.toContain('>J-1<');
        expect(svg.match(/class="stream /g)).toHaveLength(13);
      }
      if (file === 'three-way-valves.mmd') {
        expect(svg.match(/class="bore bore-L"/g)).toHaveLength(2);
        expect(svg.match(/class="bore bore-T"/g)).toHaveLength(2);
        expect(svg).toContain('state-invalid');
        expect(svg).toContain('not possible on an L-port valve');
      }
      if (file === 'valves.mmd') {
        expect(svg).toContain('port-C port-shut');
        expect(svg).toContain('state-closed');
        expect(svg.match(/stream process stream-blocked/g)).toHaveLength(3); // V-102.C→, →V-103, V-103→
      }
    }
  });
});
