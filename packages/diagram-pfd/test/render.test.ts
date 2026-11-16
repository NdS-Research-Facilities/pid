import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createMermaid } from 'mermaid';
import { describe, expect, it } from 'vitest';
import { parsePfd, pfd } from '../src/index.js';

const example = readFileSync(new URL('../../../examples/distillation.mmd', import.meta.url), 'utf8');

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

describe('Mermaid v13 integration', () => {
  it('detects and renders a pfd to SVG', async () => {
    const mermaid = createMermaid();
    await mermaid.registerExternalDiagrams([pfd]);
    expect(mermaid.detectType(example)).toBe('pfd');
    const { svg } = await mermaid.render('pfd1', example);
    expect(svg).toContain('mermaid-pfd');
    for (const tag of ['T-101', 'P-101', 'C-101', '1200 kg/h']) expect(svg).toContain(tag);
    mkdirSync(new URL('../../../out/', import.meta.url), { recursive: true });
    writeFileSync(new URL('../../../out/distillation.svg', import.meta.url), svg);
  });
});
