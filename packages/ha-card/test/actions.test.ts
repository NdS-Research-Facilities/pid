import { describe, expect, it } from 'vitest';
import { resolveActions, stateEntities } from '../src/actions.js';
import { PidCardEditor } from '../src/editor.js';
import { PidCard } from '../src/pid-card.js';
import type { HassEntity, HomeAssistant } from '../src/types.js';

const CONTENT = `pid LR
  TT-101: instrument "Flow" = \${states['sensor.flow_temp']} °C
  P-101: pump "Pump"
  T-101: tank "Tank"
  T-101 --> P-101
  T-101 --- TT-101
  P-101 = \${if(is_state('switch.pump', 'on'), 'on', 'off')}
  V-1 = \${calc(states['sensor.a'] + states['sensor.b'])}
`;

describe('actions', () => {
  it('finds the entity each state line reads, if it reads exactly one', () => {
    expect(Object.fromEntries(stateEntities(CONTENT))).toEqual({ 'TT-101': 'sensor.flow_temp', 'P-101': 'switch.pump' });
  });

  it('merges configured actions over automatic more-info, and drops none', () => {
    const actions = resolveActions(CONTENT, {
      'P-101': { action: 'toggle', entity: 'switch.pump' },
      'T-101': 'sensor.tank_level',
      'TT-101': { action: 'none' },
    });
    expect(Object.fromEntries(actions)).toEqual({
      'P-101': { action: 'toggle', entity: 'switch.pump' },
      'T-101': { action: 'more-info', entity: 'sensor.tank_level' },
    });
    expect(resolveActions(CONTENT, {}, false).size).toBe(0);
  });
});

const entity = (entity_id: string, state: string): HassEntity => ({ entity_id, state, attributes: {}, last_changed: '', last_updated: '' });
const hass: HomeAssistant = {
  states: { 'sensor.flow_temp': entity('sensor.flow_temp', '55'), 'switch.pump': entity('switch.pump', 'on') },
  themes: { darkMode: false, theme: 'default' },
  language: 'en',
  callService: () => {},
};

describe('clickable nodes', () => {
  async function card(config: Record<string, unknown>) {
    const el = document.createElement('pid-card') as PidCard;
    document.body.appendChild(el);
    el.setConfig({ type: 'custom:pid-card', content: CONTENT, ...config } as never);
    const done = new Promise((r) => el.addEventListener('pid-card-rendered', r, { once: true }));
    el.hass = hass;
    await done;
    const events: CustomEvent[] = [];
    el.addEventListener('hass-action', (e) => events.push(e as CustomEvent));
    const node = (tag: string) => el.shadowRoot!.querySelector(`[data-id="node-${tag}"]`)!;
    return { node, events };
  }

  it('marks actionable equipment and sends hass-action on click', async () => {
    const { node, events } = await card({ actions: { 'P-101': { action: 'toggle', entity: 'switch.pump' } } });
    expect(node('TT-101').classList.contains('clickable')).toBe(true);
    expect(node('TT-101').getAttribute('tabindex')).toBe('0');
    expect(node('T-101').classList.contains('clickable')).toBe(false);

    node('TT-101').querySelector('circle')!.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    node('P-101').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    node('T-101').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(events.map((e) => e.detail)).toEqual([
      { config: { entity: 'sensor.flow_temp', tap_action: { action: 'more-info', entity: 'sensor.flow_temp' } }, action: 'tap' },
      { config: { entity: 'switch.pump', tap_action: { action: 'toggle', entity: 'switch.pump' } }, action: 'tap' },
    ]);
    expect(events[0]!.bubbles && events[0]!.composed).toBe(true);
  });

  it('turns automatic more-info off', async () => {
    const { node } = await card({ auto_more_info: false });
    expect(node('TT-101').classList.contains('clickable')).toBe(false);
  });
});

describe('editor', () => {
  it('is the card config element and reports form changes as config-changed', () => {
    const editor = PidCard.getConfigElement() as PidCardEditor;
    expect(editor).toBeInstanceOf(PidCardEditor);
    editor.setConfig({ type: 'custom:pid-card', content: 'pid LR\n  A --> B\n', actions: { A: 'switch.a' } });
    editor.hass = hass;
    const form = editor.querySelector('ha-form') as HTMLElement & { data: Record<string, unknown>; schema: unknown[] };
    expect(form.data).toMatchObject({ content: 'pid LR\n  A --> B\n', theme: 'auto', auto_more_info: true });
    expect(form.schema.length).toBeGreaterThan(3);
    let changed: Record<string, unknown> | undefined;
    editor.addEventListener('config-changed', (e) => (changed = (e as CustomEvent).detail.config));
    form.dispatchEvent(new CustomEvent('value-changed', { detail: { value: { ...form.data, title: 'Plant' } } }));
    expect(changed).toMatchObject({ type: 'custom:pid-card', title: 'Plant', actions: { A: 'switch.a' } });
  });
});
