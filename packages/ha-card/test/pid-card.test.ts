import { describe, expect, it } from 'vitest';
import { PidCard } from '../src/pid-card.js';
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

  it('renders ordinary Mermaid diagrams too', async () => {
    const { card, rendered, svg } = mount({ content: 'flowchart LR\n  A[Pump ${states[\'switch.pump\']}] --> B' });
    const done = rendered();
    card.hass = hass([entity('switch.pump', 'on')]);
    await done;
    expect(svg()).toContain('Pump on');
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
});
