import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import { ONLY_PID, PidCard } from '../src/pid-card.js';
import type { HomeAssistant, HassEntity } from '../src/types.js';

const entity = (entity_id: string, state: string, attributes: Record<string, unknown> = {}, t = '2026-11-16T10:00:00Z'): HassEntity => ({
  entity_id, state, attributes, last_changed: t, last_updated: t,
});

const hass = (states: HassEntity[], darkMode = false): HomeAssistant => ({
  states: Object.fromEntries(states.map((e) => [e.entity_id, e])),
  themes: { darkMode, theme: 'default' },
  language: 'en',
  callService: () => {},
});

const CONTENT = `pid LR
  TT-101: instrument "Buffer temp"
  TV-101: valve "Steam valve"
  T-101: tank "Buffer"
  T-101 --- TT-101
  TT-101 -.-> TV-101
  TT-101 = \${round(states['sensor.buffer_temp'], 1)} °C
  TV-101 = \${attr('valve.steam', 'current_position')}
`;

function mount(config: Record<string, unknown>) {
  const card = document.createElement('pid-card') as PidCard;
  document.body.appendChild(card);
  card.setConfig({ type: 'custom:pid-card', ...config } as never);
  const rendered = () => new Promise<void>((resolve) => card.addEventListener('pid-card-rendered', () => resolve(), { once: true }));
  const svg = () => card.shadowRoot!.querySelector('.diagram')!.innerHTML;
  const error = () => card.shadowRoot!.querySelector<HTMLElement>('.error')!;
  return { card, rendered, svg, error };
}

describe('pid-card', () => {
  it('registers itself for the card picker', () => {
    expect(customElements.get('pid-card')).toBe(PidCard);
    expect(window.customCards?.some((c) => c.type === 'pid-card')).toBe(true);
  });

  it('requires content', () => {
    const card = document.createElement('pid-card') as PidCard;
    expect(() => card.setConfig({ type: 'custom:pid-card' } as never)).toThrow(/content/);
  });

  it('renders live entity values and re-renders when they change', async () => {
    const { card, rendered, svg } = mount({ content: CONTENT, title: 'Buffer' });
    let done = rendered();
    card.hass = hass([entity('sensor.buffer_temp', '42.46'), entity('valve.steam', 'open', { current_position: 35 })]);
    await done;
    expect(svg()).toContain('mermaid-pid');
    expect(svg()).toContain('42.5 °C');
    expect(svg()).toContain('35 % open');
    expect(card.shadowRoot!.querySelector('.card-header')!.textContent).toBe('Buffer');

    done = rendered();
    card.hass = hass([entity('sensor.buffer_temp', '47.0', {}, '2026-11-16T10:01:00Z'), entity('valve.steam', 'open', { current_position: 35 })]);
    await done;
    expect(svg()).toContain('47.0 °C');
  });

  it('ignores changes to entities the diagram does not read', async () => {
    const { card, rendered } = mount({ content: CONTENT });
    const base = [entity('sensor.buffer_temp', '42'), entity('valve.steam', 'open', { current_position: 35 })];
    const done = rendered();
    card.hass = hass(base);
    await done;
    let renders = 0;
    card.addEventListener('pid-card-rendered', () => renders++);
    card.hass = hass([...base, entity('light.kitchen', 'on', {}, '2026-11-16T11:00:00Z')]);
    await new Promise((r) => setTimeout(r, 50));
    expect(renders).toBe(0);
  });

  it('masks entity text that would break the syntax and shows it decoded', async () => {
    const { card, rendered, svg } = mount({ content: 'pid LR\n  PT-1: instrument "P" = ${states[\'sensor.p\']}\n' });
    const done = rendered();
    card.hass = hass([entity('sensor.p', 'fault (E3); see |log|')]);
    await done;
    expect(svg()).toContain('fault (E3); see |log|');
  });

  it('shows an unavailable sensor as unknown', async () => {
    const { card, rendered, svg } = mount({ content: CONTENT });
    const done = rendered();
    card.hass = hass([entity('valve.steam', 'unavailable')]); // sensor.buffer_temp missing entirely
    await done;
    expect(svg()).toContain('state-unknown');
  });

  it('draws P&IDs only, and says so for other Mermaid diagrams', async () => {
    const { card, rendered, svg, error } = mount({ content: 'flowchart LR\n  A[Pump ${states[\'switch.pump\']}] --> B' });
    const done = rendered();
    card.hass = hass([entity('switch.pump', 'on')]);
    await done;
    expect(svg()).toBe('');
    expect(error().hidden).toBe(false);
    expect(error().textContent).toBe(ONLY_PID);
    expect(ONLY_PID).toMatch(/P&ID diagrams only/);
  });

  it('keeps the last drawing and reports syntax errors', async () => {
    const { card, rendered, svg, error } = mount({ content: 'pid LR\n  A --> B\n' });
    let done = rendered();
    card.hass = hass([]);
    await done;
    const good = svg();
    card.setConfig({ type: 'custom:pid-card', content: 'pid LR\n  ???\n' });
    done = rendered();
    card.hass = hass([]);
    await done;
    expect(error().hidden).toBe(false);
    expect(error().textContent).toMatch(/Cannot read "\?\?\?"/);
    expect(svg()).toBe(good);
  });

  it('follows the Home Assistant theme in auto mode only', async () => {
    const auto = mount({ content: 'pid LR\n  A --> B\n' });
    let done = auto.rendered();
    auto.card.hass = hass([], true);
    await done;
    expect(auto.card.shadowRoot!.querySelector('.diagram')!.classList.contains('auto')).toBe(true);

    const fixed = mount({ content: 'pid LR\n  A --> B\n', theme: 'forest' });
    done = fixed.rendered();
    fixed.card.hass = hass([]);
    await done;
    expect(fixed.card.shadowRoot!.querySelector('.diagram')!.classList.contains('auto')).toBe(false);
  });

  it('draws mdi icons, fetching the pack once', async () => {
    const mdi = readFileSync(createRequire(import.meta.url).resolve('@iconify-json/mdi/icons.json'), 'utf8');
    const fetchMock = vi.fn(async (_url: RequestInfo | URL) => new Response(mdi, { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const { card, rendered, svg } = mount({ content: 'pid LR\n  PT-1: instrument = 3 bar\n  icon PT-1 mdi:gauge\n' });
      const done = rendered();
      card.hass = hass([]);
      await done;
      expect(svg()).toContain('custom-icon');
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(String(fetchMock.mock.calls[0]![0])).toContain('@iconify-json/mdi');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('switches classes from templates, so colours follow live values', async () => {
    const content = `pid LR
  classDef alarm fill:#ffcdd2,stroke:#d50000
  classDef ok fill:#e8f5e9,stroke:#2e7d32
  TT-1: instrument = \${states['sensor.t']} °C
  class TT-1 \${if(states['sensor.t'] > 60, 'alarm', 'ok')}
`;
    const { card, rendered, svg } = mount({ content });
    let done = rendered();
    card.hass = hass([entity('sensor.t', '45')]);
    await done;
    expect(svg()).toContain('class-ok');
    done = rendered();
    card.hass = hass([entity('sensor.t', '72', {}, '2026-11-16T10:05:00Z')]);
    await done;
    expect(svg()).toContain('class-alarm');
    expect(svg()).toContain('#d50000');
  });

  it('loads relative images from /local/, or from image_base', async () => {
    const content = 'pid LR\n  HP-1: block\n  image HP-1 assets/heat-pump.png\n  M-1: block\n  image M-1 /local/m.png\n';
    const a = mount({ content });
    let done = a.rendered();
    a.card.hass = hass([]);
    await done;
    expect(a.svg()).toContain('href="/local/assets/heat-pump.png"');
    expect(a.svg()).toContain('href="/local/m.png"');

    const b = mount({ content, image_base: '/local/pid/' });
    done = b.rendered();
    b.card.hass = hass([]);
    await done;
    expect(b.svg()).toContain('href="/local/pid/assets/heat-pump.png"');
  });

  it('switches a whole circuit with a class from a template', async () => {
    const content = `pid LR
  classDef flow stroke:#ef6c00
  classDef off stroke:#9e9e9e
  CV f1@--> P-1 f2@--> VV
  class f1,f2 \${if(is_state('switch.pump', 'on'), 'flow', 'off')}
`;
    const { card, rendered } = mount({ content });
    const stroke = (n: number) => card.shadowRoot!.querySelector(`[data-id="edge-s${n}"] path`)!.getAttribute('stroke');
    let done = rendered();
    card.hass = hass([entity('switch.pump', 'on')]);
    await done;
    expect([stroke(0), stroke(1)]).toEqual(['#ef6c00', '#ef6c00']);
    done = rendered();
    card.hass = hass([entity('switch.pump', 'off', {}, '2026-11-17T10:05:00Z')]);
    await done;
    expect([stroke(0), stroke(1)]).toEqual(['#9e9e9e', '#9e9e9e']);
  });
});
