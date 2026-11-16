import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createMermaid } from 'mermaid';
import { describe, expect, it } from 'vitest';
import { parsePfd, parseState, pfd } from '../src/index.js';

const examplesDir = new URL('../../../examples/', import.meta.url);
const read = (name: string) => readFileSync(new URL(name, examplesDir), 'utf8');
const example = read('distillation.mmd');

describe('parsePfd', () => {
  it('reads equipment, streams and stream properties', () => {
    const { model, diagnostics } = parsePfd(example);
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
    const { diagnostics } = parsePfd('pfd\n  X-1: spaceship\n  ???\n');
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
    const { model, diagnostics } = parsePfd(read('valves.mmd'));
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

describe('Mermaid v13 integration', () => {
  it('detects and renders a pfd to SVG', async () => {
    const mermaid = createMermaid();
    await mermaid.registerExternalDiagrams([pfd]);
    expect(mermaid.detectType(example)).toBe('pfd');
    const { svg } = await mermaid.render('pfd1', example);
    expect(svg).toContain('mermaid-pfd');
    for (const tag of ['T-101', 'P-101', 'C-101', '1200 kg/h']) expect(svg).toContain(tag);
  });

  it('renders every example, marking shut ports and blocked streams', async () => {
    const mermaid = createMermaid();
    await mermaid.registerExternalDiagrams([pfd]);
    const out = new URL('../../../out/', import.meta.url);
    mkdirSync(out, { recursive: true });
    for (const file of readdirSync(examplesDir).filter((f) => f.endsWith('.mmd') && !f.startsWith('.'))) {
      const { svg } = await mermaid.render(file.replace(/\W/g, '-'), read(file));
      writeFileSync(new URL(file.replace(/\.mmd$/, '.svg'), out), svg);
      if (file === 'valves.mmd') {
        expect(svg).toContain('port-C port-shut');
        expect(svg).toContain('state-closed');
        expect(svg.match(/stream stream-blocked/g)).toHaveLength(3); // V-102.C→, →V-103, V-103→
      }
    }
  });
});
