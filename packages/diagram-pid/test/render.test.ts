import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { icons } from '@mermaid-js/plugin-icons';
import { createMermaid } from 'mermaid';
import { describe, expect, it } from 'vitest';
import { boreProblem, declarations, imageUrl, parsePid, parseState, pid } from '../src/index.js';

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
    expect(kinds).toEqual({ 'V-1': 'gate', 'V-2': 'globe', 'V-3': 'ball', 'V-4': 'plug', 'V-5': 'butterfly', 'V-6': 'check', 'PSV-1': 'relief', 'FV-7': 'globe' });
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
    expect(new Set(model.streams.map((s) => `${s.kind}${s.arrow ? '>' : ''}`))).toEqual(new Set(['process>', 'connection', 'signal>', 'signal']));
    expect(eq.some((e) => e.image) && eq.some((e) => e.icon) && eq.some((e) => e.classes) && eq.some((e) => e.style)).toBe(true);
    expect(model.streams.some((s) => s.lineNumber) && model.streams.some((s) => s.style) && model.linkStyleDefault).toBeTruthy();
    expect(model.streams[13]).toMatchObject({ source: 'HP-1', target: 'E-101' });
    expect(eq.find((e) => e.id === 'AT-106')?.name).toBe('pH (outlet)');
    expect(eq.some((e) => e.gradient) && eq.some((e) => e.level)).toBe(true);
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
