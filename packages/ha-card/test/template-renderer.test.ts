// pid-card's additions to the vendored template engine: `and` / `or` and `switch`.
// Upstream's own tests are in template-renderer.upstream.test.mjs.
import { describe, expect, it } from 'vitest';
import type { HomeAssistant } from '../src/types.js';
import { renderTemplate } from '../src/vendor/template-renderer.js';

const entity = (state: string, attributes: Record<string, unknown> = {}) => ({
  state,
  attributes,
  last_changed: '2026-11-19T12:00:00Z',
  last_updated: '2026-11-19T12:00:00Z',
});
const hass = {
  language: 'en',
  states: {
    'switch.pump': entity('on'),
    'switch.fan': entity('off'),
    'binary_sensor.burner': entity('on'),
    'binary_sensor.tap': entity('off'),
    'water_heater.boiler': entity('heat', { display_code: 0 }),
    'sensor.mode': entity('a<b>"c"'),
    'sensor.temp': entity('42.5'),
  },
} as unknown as HomeAssistant;
const r = (src: string) => renderTemplate(src, hass);

describe('and / or', () => {
  it('combines conditions, and before or', () => {
    expect(r("${is_state('switch.pump', 'on') and is_state('switch.fan', 'on')}")).toBe('false');
    expect(r("${is_state('switch.pump', 'on') or is_state('switch.fan', 'on')}")).toBe('true');
    // and binds tighter: true or (false and false)
    expect(r("${is_state('switch.pump', 'on') or is_state('switch.fan', 'on') and 0}")).toBe('true');
    expect(r("${(is_state('switch.pump', 'on') or 1) and is_state('switch.fan', 'on')}")).toBe('false');
  });

  it('sits below comparisons and arithmetic', () => {
    expect(r("${states['sensor.temp'] > 40 and states['sensor.temp'] < 50}")).toBe('true');
    expect(r("${states['sensor.temp'] + 10 > 60 or attr('water_heater.boiler', 'display_code') == 0}")).toBe('true');
  });

  it('works inside if, replacing nested ifs', () => {
    const src = "${if(is_state('binary_sensor.burner', 'on') and is_state('binary_sensor.tap', 'off'), 'hot', 'warm')}";
    expect(r(src)).toBe('hot');
  });

  it('stops once the outcome is known', () => {
    // The right side fails when evaluated (an unknown timestamp form), which would leave the
    // whole expression unfilled: skipped, it does not.
    expect(r("${timestamp('switch.pump', 'bogus')}")).toBe("${timestamp('switch.pump', 'bogus')}");
    expect(r("${0 and timestamp('switch.pump', 'bogus')}")).toBe('false');
    expect(r("${1 or timestamp('switch.pump', 'bogus')}")).toBe('true');
  });

  it('only takes whole words, and leaves expressions it cannot read alone', () => {
    expect(r("${is_state('switch.pump', 'on') andx 1}")).toBe("${is_state('switch.pump', 'on') andx 1}");
    expect(r("${is_state('switch.pump', 'on') and}")).toBe("${is_state('switch.pump', 'on') and}");
  });
});

describe('switch', () => {
  it('gives the result after the first matching case, else the default, else nothing', () => {
    expect(r("${switch(states['water_heater.boiler'], 'off', 'cold', 'heat', 'hot', 'warm')}")).toBe('hot');
    expect(r("${switch(states['switch.fan'], 'on', 'run', 'stop')}")).toBe('stop');
    expect(r("${switch(states['switch.fan'], 'on', 'run')}")).toBe('');
  });

  it('compares numbers as numbers', () => {
    expect(r("${switch(attr('water_heater.boiler', 'display_code'), 0, 'hot', 1, 'warm')}")).toBe('hot');
    expect(r("${switch(states['sensor.temp'], 42.5, 'yes', 'no')}")).toBe('yes');
  });

  it('fills in a quoted result that holds its own templates', () => {
    const src = `\${switch(states['switch.pump'], 'on', '\${if(attr("water_heater.boiler", "display_code") == 0, "hot", "warm")}', 'off')}`;
    expect(r(src)).toBe('hot');
  });

  it('masks entity text it returns, as every entity value', () => {
    expect(r("${switch(1, 1, states['sensor.mode'])}")).toBe('a#60;b#62;#quot;c#quot;');
  });

  it('needs a value and at least one case and result', () => {
    expect(r("${switch(states['switch.fan'], 'on')}")).toBe("${switch(states['switch.fan'], 'on')}");
  });
});

describe('the README example', () => {
  it('gives the same class with and as with nested ifs, for every burner and tap state', () => {
    const before = `\${if(is_state('binary_sensor.burner', 'on'), '\${if(is_state("binary_sensor.tap", "on"), "warm", "hot")}', 'warm')}`;
    const after = "${if(is_state('binary_sensor.burner', 'on') and is_state('binary_sensor.tap', 'off'), 'hot', 'warm')}";
    for (const burner of ['on', 'off'])
      for (const tap of ['on', 'off']) {
        const h = { ...hass, states: { ...hass.states, 'binary_sensor.burner': entity(burner), 'binary_sensor.tap': entity(tap) } } as unknown as HomeAssistant;
        expect(renderTemplate(after, h), `${burner}/${tap}`).toBe(renderTemplate(before, h));
      }
  });
});
